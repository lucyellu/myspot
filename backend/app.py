"""myspot FastAPI app.

Run with:
    python -m backend.app           # one-shot startup
    uvicorn backend.app:app --reload --host 127.0.0.1 --port 7777
"""
import asyncio
import json
import os
import threading
from pathlib import Path  # noqa

from fastapi import FastAPI, HTTPException, Query, Request, Body, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .config import (
    HOST, PORT, FRONTEND_DIR, GENS_DIR, ASSETS_DIR, SUNO_LIBRARY, EXPORTS_DIR,
    secret_source, reload_env,
)
from .db import init_db
from .library import full_reindex
from .ai import (
    tool_status,
    generate_image as ai_generate_image,
    enhance_prompt as ai_enhance_prompt,
    animate_image as ai_animate_image,
    auto_text_model, auto_image_tool, auto_video_tool,
)
from .ai.queue import queue as job_queue
from .ai.queue import build_default_prompt
from .ai import inspire as inspire_mod
from .render import render_slideshow, have_ffmpeg


app = FastAPI(title="myspot", version="0.1.0")
_db_lock = threading.Lock()
_conn = init_db()


def _row(r):
    return dict(r) if r is not None else None


def _rows(rs):
    return [dict(r) for r in rs]


# Add CORS on the extension endpoints since Chrome extensions call from a
# different origin. Browsers send the Origin header for fetch from MV3
# service workers; we echo it back permissively for localhost-only deployments.
@app.middleware("http")
async def _ext_cors(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/extension/"):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.options("/api/extension/{rest:path}")
async def _ext_options(rest: str):
    return JSONResponse({}, headers={
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    })


def _safe_path(p: str | None) -> str | None:
    if not p:
        return None
    return str(p).replace("\\", "/")


# ----------------------------- Channels -----------------------------

@app.get("/api/channels")
def list_channels():
    rows = _conn.execute(
        """SELECT account, COUNT(*) AS song_count,
                  SUM(CASE WHEN jpg_path IS NOT NULL THEN 1 ELSE 0 END) AS with_cover
           FROM songs GROUP BY account ORDER BY song_count DESC"""
    ).fetchall()
    return _rows(rows)


# ----------------------------- Songs --------------------------------

@app.get("/api/songs")
def list_songs(
    account: str | None = None,
    q: str | None = None,
    tag: str | None = None,
    limit: int = Query(60, ge=1, le=500),
    offset: int = Query(0, ge=0),
    sort: str = Query("recent", regex="^(recent|title|version|popular|liked|gens|recent_played)$"),
):
    where = []
    args: list = []
    if account:
        where.append("s.account = ?")
        args.append(account)
    if q:
        # Match title/base_title/genre LIKE OR lyric FTS, dedupe via UNION-via-subquery
        where.append(
            "(s.title LIKE ? OR s.base_title LIKE ? OR s.genre LIKE ? "
            "OR s.id IN (SELECT song_id FROM lyric_fts WHERE lyric_fts MATCH ?))"
        )
        like = f"%{q}%"
        args.extend([like, like, like, _fts_query(q)])
    if tag:
        clause, params = _tag_clause(tag)
        if clause:
            where.append(clause)
            args.extend(params)

    order = {
        "recent": "s.id DESC",
        "title": "s.base_title ASC, s.version ASC",
        "version": "s.version DESC, s.id DESC",
        "popular": "play_count DESC, s.id DESC",
        "liked": "s.liked DESC, s.id DESC",
        "gens": "gens_count DESC, s.id DESC",
        "recent_played": "last_played_at DESC NULLS LAST, s.id DESC",
    }[sort]

    sql = f"""
        SELECT s.id, s.title, s.base_title, s.version, s.account, s.genre, s.bpm,
               s.duration, s.suno_date, s.jpg_path, s.suno_id IS NOT NULL AS has_cache,
               s.liked,
               (SELECT COUNT(*) FROM lyric_lines ll WHERE ll.song_id = s.id) AS lyric_count,
               (SELECT COUNT(*) FROM play_history ph WHERE ph.song_id = s.id) AS play_count,
               (SELECT MAX(played_at) FROM play_history ph WHERE ph.song_id = s.id) AS last_played_at,
               (SELECT COUNT(*) FROM gens g WHERE g.song_id = s.id AND g.status='completed') AS gens_count
        FROM songs s
        {"WHERE " + " AND ".join(where) if where else ""}
        ORDER BY {order}
        LIMIT ? OFFSET ?
    """
    args.extend([limit, offset])
    rows = _conn.execute(sql, args).fetchall()

    count_sql = f"SELECT COUNT(*) FROM songs s {'WHERE ' + ' AND '.join(where) if where else ''}"
    total = _conn.execute(count_sql, args[:-2] if where else []).fetchone()[0]

    return {"items": _rows(rows), "total": total, "limit": limit, "offset": offset}


# Smart-playlist tag definitions. Each is a list of LIKE patterns matched
# against song.title (case-insensitive via SQLite LIKE default). Patterns are
# ORed together; a song matches a tag if any pattern hits.
#
# Patterns use SQLite LIKE wildcards (% = any). We bracket key words with
# spaces / parens / brackets / dashes so a song like "Live at Madison" hits
# but "Olive Branch" does not. All patterns are lowercase to leverage LIKE's
# default ASCII case-insensitivity in SQLite.
_TAG_PATTERNS = {
    "live": [
        "% live %", "% live", "live %",        # word boundaries around "live"
        "%(live%)%", "%[live%]%",                # "(live)", "[live]"
        "% live at %", "% live in %", "% live from %",
        "%concert%", "%performance%",
    ],
    "acoustic":     ["%acoustic%", "%(acoustic)%", "%unplugged%"],
    "remix":        ["%remix%", "%(remix)%", "%(rmx)%"],
    "instrumental": ["%instrumental%", "%(instrumental)%", "%(inst)%"],
    "demo":         ["%demo%", "%(demo)%"],
    "cover":        ["% cover %", "% cover", "%(cover)%", "%covered by%"],
    "remastered":   ["%remaster%", "%(remaster%)%"],
}


def _tag_clause(tag: str):
    """Return (sql_clause, params) for a smart-playlist tag, or (None, []) if
    the tag isn't known. The clause filters by title only — using lyrics or
    genre would surface too many false positives (e.g. lyrics mentioning
    'live' on songs that are studio recordings)."""
    pats = _TAG_PATTERNS.get(tag.lower())
    if not pats:
        return (None, [])
    placeholders = " OR ".join(["LOWER(s.title) LIKE ?"] * len(pats))
    return (f"({placeholders})", [p.lower() for p in pats])


@app.get("/api/smart-tags")
def smart_tag_counts():
    """Return per-tag counts so the side drawer can show how many songs each
    smart playlist contains."""
    out = []
    for name in _TAG_PATTERNS:
        clause, params = _tag_clause(name)
        if not clause:
            continue
        n = _conn.execute(
            f"SELECT COUNT(*) FROM songs s WHERE {clause}", params
        ).fetchone()[0]
        out.append({"tag": name, "n": n})
    out.sort(key=lambda r: -r["n"])
    return out


def _fts_query(q: str) -> str:
    """Sanitize a user query for sqlite FTS5: tokenize on whitespace, quote each
    term, OR them together, allow prefix on the last term. Avoids syntax errors
    on user input like 'don't' or 'a-b'."""
    terms = [t for t in q.replace('"', " ").split() if t.strip()]
    if not terms:
        return ""
    quoted = [f'"{t}"' for t in terms]
    quoted[-1] = quoted[-1] + "*"
    return " OR ".join(quoted)


@app.get("/api/songs/{song_id}")
def get_song(song_id: int):
    song = _conn.execute(
        """SELECT s.id, s.suno_id, s.title, s.base_title, s.version, s.artist, s.account,
                  s.genre, s.bpm, s.prompt, s.duration, s.mp3_path, s.jpg_path, s.txt_path,
                  s.wav_path, s.mid_path, s.suno_date, s.indexed_at, s.liked,
                  (SELECT COUNT(*) FROM play_history ph WHERE ph.song_id = s.id) AS play_count,
                  (SELECT MAX(played_at) FROM play_history ph WHERE ph.song_id = s.id) AS last_played_at
           FROM songs s WHERE s.id = ?""",
        (song_id,),
    ).fetchone()
    if song is None:
        raise HTTPException(404, "song not found")
    s = dict(song)

    s["lyrics"] = _rows(
        _conn.execute(
            "SELECT idx, text, section FROM lyric_lines WHERE song_id=? ORDER BY idx",
            (song_id,),
        ).fetchall()
    )

    s["derivatives"] = _rows(
        _conn.execute(
            """SELECT s2.id, s2.title, s2.version, r.kind, s2.jpg_path
               FROM relationships r JOIN songs s2 ON s2.id = r.child_id
               WHERE r.parent_id = ? ORDER BY s2.version""",
            (song_id,),
        ).fetchall()
    )
    s["sources"] = _rows(
        _conn.execute(
            """SELECT s2.id, s2.title, s2.version, r.kind, s2.jpg_path
               FROM relationships r JOIN songs s2 ON s2.id = r.parent_id
               WHERE r.child_id = ? ORDER BY s2.version""",
            (song_id,),
        ).fetchall()
    )

    s["gens"] = _rows(
        _conn.execute(
            """SELECT id, kind, tool, prompt, file_path, status, created_at
               FROM gens WHERE song_id=? ORDER BY id DESC""",
            (song_id,),
        ).fetchall()
    )

    note = _conn.execute(
        "SELECT body FROM notes WHERE song_id=?", (song_id,)
    ).fetchone()
    s["note"] = note["body"] if note else ""

    return s


@app.get("/api/songs/{song_id}/related")
def related_songs(song_id: int, limit: int = Query(20, ge=1, le=100)):
    s = _conn.execute(
        "SELECT account, base_title, version FROM songs WHERE id=?", (song_id,)
    ).fetchone()
    if s is None:
        raise HTTPException(404, "song not found")

    siblings = _conn.execute(
        """SELECT id, title, version, account, jpg_path, duration, 'sibling' AS reason
           FROM songs WHERE account=? AND base_title=? AND id != ?
           ORDER BY version""",
        (s["account"], s["base_title"], song_id),
    ).fetchall()

    same_account = _conn.execute(
        """SELECT id, title, version, account, jpg_path, duration, 'channel' AS reason
           FROM songs WHERE account=? AND base_title != ? AND id != ?
           ORDER BY id DESC LIMIT ?""",
        (s["account"], s["base_title"], song_id, max(0, limit - len(siblings))),
    ).fetchall()

    items = _rows(siblings) + _rows(same_account)
    return items[:limit]


# ----------------------------- Sortability + plays + likes ----------

@app.post("/api/songs/{song_id}/like")
def toggle_like(song_id: int):
    row = _conn.execute("SELECT liked FROM songs WHERE id=?", (song_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "song not found")
    new_val = 0 if row["liked"] else 1
    with _db_lock:
        _conn.execute("UPDATE songs SET liked=? WHERE id=?", (new_val, song_id))
    return {"id": song_id, "liked": bool(new_val)}


@app.post("/api/songs/{song_id}/play")
def record_play(song_id: int, payload: dict = Body({})):
    """Frontend should call this when audio actually plays.

    Body: {ms_played?: int}. ms_played is total milliseconds the user listened
    to before navigating away or pausing — frontend should send the final value.
    Each call inserts one row in play_history.
    """
    row = _conn.execute("SELECT id FROM songs WHERE id=?", (song_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "song not found")
    ms_played = (payload or {}).get("ms_played")
    if ms_played is not None:
        try: ms_played = int(ms_played)
        except (TypeError, ValueError): ms_played = None
    with _db_lock:
        _conn.execute(
            "INSERT INTO play_history(song_id, ms_played) VALUES(?,?)",
            (song_id, ms_played),
        )
    return {"ok": True}


@app.get("/api/songs/{song_id}/plays")
def song_plays(song_id: int):
    row = _conn.execute(
        """SELECT COUNT(*) AS plays, MAX(played_at) AS last,
                  COALESCE(SUM(ms_played), 0) AS total_ms
           FROM play_history WHERE song_id = ?""",
        (song_id,),
    ).fetchone()
    return dict(row) if row else {"plays": 0, "last": None, "total_ms": 0}


@app.get("/api/top-songs")
def top_songs(
    by: str = Query("popular", regex="^(popular|liked|gens|recent_played)$"),
    limit: int = Query(20, ge=1, le=200),
    account: str | None = None,
):
    """Curated top lists. Equivalent to /api/songs?sort=... but defaults to
    sensible paged result and excludes never-played items for popular/recent_played."""
    where = []
    args: list = []
    if account:
        where.append("s.account = ?")
        args.append(account)

    base = """
        SELECT s.id, s.title, s.base_title, s.version, s.account, s.genre, s.bpm,
               s.duration, s.jpg_path, s.liked,
               (SELECT COUNT(*) FROM play_history ph WHERE ph.song_id = s.id) AS play_count,
               (SELECT MAX(played_at) FROM play_history ph WHERE ph.song_id = s.id) AS last_played_at,
               (SELECT COUNT(*) FROM gens g WHERE g.song_id = s.id AND g.status='completed') AS gens_count
        FROM songs s
    """
    if by == "popular":
        where.append("(SELECT COUNT(*) FROM play_history ph WHERE ph.song_id = s.id) > 0")
        order = "play_count DESC, s.id DESC"
    elif by == "liked":
        where.append("s.liked = 1")
        order = "s.id DESC"
    elif by == "gens":
        where.append("(SELECT COUNT(*) FROM gens g WHERE g.song_id = s.id AND g.status='completed') > 0")
        order = "gens_count DESC, s.id DESC"
    else:  # recent_played
        where.append("(SELECT MAX(played_at) FROM play_history ph WHERE ph.song_id = s.id) IS NOT NULL")
        order = "last_played_at DESC, s.id DESC"

    sql = base + (" WHERE " + " AND ".join(where) if where else "") + f" ORDER BY {order} LIMIT ?"
    args.append(limit)
    rows = _conn.execute(sql, args).fetchall()
    return _rows(rows)


# ----------------------------- Notes --------------------------------

@app.put("/api/songs/{song_id}/notes")
def put_note(song_id: int, payload: dict = Body(...)):
    body = (payload or {}).get("body", "")
    with _db_lock:
        _conn.execute(
            """INSERT INTO notes(song_id, body, updated_at)
               VALUES(?, ?, datetime('now'))
               ON CONFLICT(song_id) DO UPDATE SET
                 body=excluded.body, updated_at=excluded.updated_at""",
            (song_id, body),
        )
    return {"ok": True}


# ----------------------------- Prompts ------------------------------

@app.get("/api/prompts")
def list_prompts(q: str | None = None, category: str | None = None, tag: str | None = None):
    where = []
    args: list = []
    if q:
        where.append("(name LIKE ? OR template LIKE ? OR category LIKE ? OR tags LIKE ?)")
        like = f"%{q}%"
        args.extend([like, like, like, like])
    if category:
        where.append("category = ?")
        args.append(category)
    if tag:
        where.append("tags LIKE ?")
        args.append(f"%{tag.lower()}%")
    sql = f"""SELECT id, name, category, tags, template, default_vars_json,
                     use_count, last_used_at, created_at
              FROM prompts
              {'WHERE ' + ' AND '.join(where) if where else ''}
              ORDER BY use_count DESC, name"""
    rows = _conn.execute(sql, args).fetchall()
    return _rows(rows)


@app.get("/api/prompts/categories")
def prompt_categories():
    rows = _conn.execute(
        "SELECT category, COUNT(*) AS n FROM prompts WHERE category IS NOT NULL GROUP BY category ORDER BY n DESC"
    ).fetchall()
    return _rows(rows)


_PROMPT_TAG_KEYWORDS = [
    # Cinematographers / directors
    "wes anderson", "stanley kubrick", "wong kar-wai", "denis villeneuve",
    "roger deakins", "emmanuel lubezki", "christopher doyle", "darren aronofsky",
    "spike jonze", "michel gondry", "david fincher", "lana wachowski",
    "hayao miyazaki", "satoshi kon", "akira kurosawa",
    # Music video / film aesthetics
    "mtv early 90s", "y2k aesthetic", "vaporwave", "synthwave", "lofi",
    "a24 indie", "hyperpop", "bladerunner", "matrix",
    # Film stocks / cameras
    "polaroid", "super 8mm", "16mm film", "35mm film", "vhs", "iphone vertical",
    "dslr", "drone overhead", "go pro",
    # Concert / live moods
    "outdoor concert", "stadium lights", "underground rave", "festival rave",
    "live performance", "casual photo", "professional party photographer",
    # Lighting / palette
    "neon noir", "golden hour", "dawn light", "dusk", "rain-slicked",
    "moody", "ethereal", "cinematic", "dreamy", "atmospheric",
]


def _auto_extract_tags(template: str) -> list[str]:
    """Find any of the curated keywords inside the template (case-insensitive)."""
    tl = (template or "").lower()
    found = []
    for kw in _PROMPT_TAG_KEYWORDS:
        if kw in tl:
            found.append(kw)
    return found


def _auto_name_from_template(template: str) -> str:
    """If user didn't give a name, use the first ~40 chars of template stripped clean."""
    t = (template or "").strip()
    # Pull first sentence-ish, strip newlines
    head = t.split("\n", 1)[0].split(".", 1)[0]
    head = " ".join(head.split())[:48]
    if not head:
        head = "Untitled prompt"
    # Make unique-ish by appending a short random suffix
    import secrets
    return f"{head} ({secrets.token_hex(2)})"


@app.post("/api/prompts")
def create_prompt(payload: dict = Body(...)):
    template = (payload.get("template") or "").strip()
    if not template:
        raise HTTPException(400, "template required")
    name = (payload.get("name") or "").strip()
    if not name:
        name = _auto_name_from_template(template)
    category = (payload.get("category") or "").strip() or None
    # Tags: prefer user-provided, else auto-extract
    raw_tags = payload.get("tags")
    if isinstance(raw_tags, list):
        tags = ",".join(t.strip().lower() for t in raw_tags if t and t.strip())
    elif isinstance(raw_tags, str) and raw_tags.strip():
        tags = ",".join(t.strip().lower() for t in raw_tags.split(",") if t.strip())
    else:
        tags = ",".join(_auto_extract_tags(template))
    tags = tags or None
    default_vars = json.dumps(payload.get("default_vars") or {})

    with _db_lock:
        _conn.execute(
            """INSERT INTO prompts(name, category, tags, template, default_vars_json) VALUES(?,?,?,?,?)
               ON CONFLICT(name) DO UPDATE SET
                 category=excluded.category,
                 tags=excluded.tags,
                 template=excluded.template,
                 default_vars_json=excluded.default_vars_json""",
            (name, category, tags, template, default_vars),
        )
    return {"ok": True, "name": name, "tags": tags.split(",") if tags else []}


@app.get("/api/prompt-tags")
def list_prompt_tags():
    """Curated tag chips for the Generate tab — cinematographers, aesthetics,
    cameras, concert moods. Click a chip to append it to the prompt."""
    return {
        "Cinematographers / directors": [
            "Wes Anderson", "Stanley Kubrick", "Wong Kar-wai",
            "Denis Villeneuve", "Roger Deakins", "Emmanuel Lubezki",
            "Christopher Doyle", "David Fincher", "Spike Jonze",
            "Michel Gondry", "Hayao Miyazaki", "Satoshi Kon",
        ],
        "Music video / film aesthetics": [
            "MTV early 90s", "y2k aesthetic", "vaporwave", "synthwave",
            "A24 indie film", "lofi", "hyperpop visual", "bladerunner neon",
            "dreamcore", "weirdcore", "anime opening sequence",
        ],
        "Camera / film stock": [
            "polaroid", "super 8mm", "16mm film", "35mm film",
            "VHS tape", "iphone vertical", "DSLR shallow DOF",
            "drone overhead", "GoPro POV", "disposable camera flash",
        ],
        "Concert / live": [
            "outdoor concert", "festival rave", "underground rave",
            "stadium lights", "casual phone footage", "professional party photographer",
            "live performance from stage", "crowd surfing POV",
        ],
        "Lighting / mood": [
            "neon noir", "golden hour", "dawn light", "dusk",
            "rain-slicked streets", "moody", "ethereal", "cinematic",
            "dreamy soft focus", "atmospheric haze",
        ],
    }


@app.post("/api/prompts/{prompt_id}/used")
def mark_prompt_used(prompt_id: int):
    with _db_lock:
        _conn.execute(
            """UPDATE prompts SET use_count=use_count+1, last_used_at=datetime('now')
               WHERE id=?""",
            (prompt_id,),
        )
    return {"ok": True}


@app.delete("/api/prompts/{prompt_id}")
def delete_prompt(prompt_id: int):
    with _db_lock:
        _conn.execute("DELETE FROM prompts WHERE id=?", (prompt_id,))
    return {"ok": True}


# ----------------------------- Gens (manual upload) -----------------

@app.get("/api/songs/{song_id}/gens")
def list_gens(song_id: int):
    rows = _conn.execute(
        """SELECT id, kind, tool, prompt, file_path, status, created_at
           FROM gens WHERE song_id=? ORDER BY id DESC""",
        (song_id,),
    ).fetchall()
    return _rows(rows)


@app.post("/api/songs/{song_id}/gens/upload")
async def create_gen_upload(
    song_id: int,
    tool: str = Query("manual"),
    kind: str = Query("image"),
    prompt: str = Query(""),
    file: UploadFile = File(...),
):
    s = _conn.execute("SELECT id FROM songs WHERE id=?", (song_id,)).fetchone()
    if s is None:
        raise HTTPException(404, "song not found")

    GENS_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "blob").suffix.lower() or ".bin"
    safe = "".join(c for c in (file.filename or "") if c.isalnum() or c in "._-")[:60] or "gen"
    out = GENS_DIR / f"song{song_id}_{int(asyncio.get_event_loop().time()*1000)}_{safe}"
    if not out.suffix:
        out = out.with_suffix(suffix)
    contents = await file.read()
    out.write_bytes(contents)

    with _db_lock:
        cur = _conn.execute(
            """INSERT INTO gens(song_id, kind, tool, prompt, file_path, status)
               VALUES(?,?,?,?,?,?)""",
            (song_id, kind, tool, prompt, str(out).replace("\\", "/"), "completed"),
        )
        gen_id = cur.lastrowid

    return {"id": gen_id, "file_path": str(out)}


# ----------------------------- AI tooling ---------------------------

def _song_for_ai(song_id: int) -> dict:
    s = _conn.execute(
        """SELECT id, title, genre, bpm, prompt FROM songs WHERE id=?""",
        (song_id,),
    ).fetchone()
    if not s:
        raise HTTPException(404, "song not found")
    out = dict(s)
    out["lyrics"] = _rows(
        _conn.execute(
            "SELECT idx, text, section FROM lyric_lines WHERE song_id=? ORDER BY idx LIMIT 16",
            (song_id,),
        ).fetchall()
    )
    return out


@app.get("/api/health")
def health():
    tools = tool_status()
    # Annotate where each key came from (or None if unconfigured)
    key_map = {
        "claude": "ANTHROPIC_API_KEY",
        "deepseek": "DEEPSEEK_API_KEY",
        "gemini-text": "GEMINI_API_KEY",
        "nano-banana": "GEMINI_API_KEY",
        "grok": "XAI_API_KEY",
        "inspire": "GEMINI_API_KEY",
        "hf-flux": "HF_TOKEN",
        "hf-ltx-video": "HF_TOKEN",
    }
    for tool, info in tools.items():
        info["source"] = secret_source(key_map.get(tool, ""))
    return {
        "tools": tools,
        "ffmpeg": have_ffmpeg(),
        "queue_running": job_queue.is_running(),
    }


@app.post("/api/reload-env")
def reload_env_endpoint():
    """Re-read .env from disk so newly-pasted keys take effect without
    restarting the server. The AI tool modules also read on each call,
    so a fresh value will be picked up immediately after this returns."""
    cache = reload_env()
    return {"ok": True, "loaded_keys": sorted(cache.keys())}


@app.post("/api/songs/{song_id}/enhance-prompt")
def api_enhance_prompt(song_id: int, payload: dict = Body({})):
    song = _song_for_ai(song_id)
    seed = (payload or {}).get("seed", "")
    model = (payload or {}).get("model", "deepseek")
    image_prompt = (payload or {}).get("image_prompt") or None
    return ai_enhance_prompt(model, song, user_seed=seed, image_prompt=image_prompt)


@app.post("/api/songs/{song_id}/inspire/url")
def api_inspire_url(song_id: int, payload: dict = Body(...)):
    song = _song_for_ai(song_id)
    url = (payload or {}).get("url", "")
    seed = (payload or {}).get("seed") or None
    return inspire_mod.inspire_from_url(url, song=song, user_seed=seed)


@app.post("/api/songs/{song_id}/inspire/upload")
async def api_inspire_upload(
    song_id: int,
    seed: str = Query(""),
    file: UploadFile = File(...),
):
    song = _song_for_ai(song_id)
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty upload")
    return inspire_mod.inspire_from_image_bytes(data, song=song, user_seed=seed or None)


@app.post("/api/inspire/asset/{asset_id}")
def api_inspire_asset(asset_id: int, payload: dict = Body({})):
    """Use an already-indexed asset from myspot/assets/ as the inspiration source."""
    asset = _conn.execute(
        "SELECT id, kind, file_path FROM assets WHERE id=?", (asset_id,)
    ).fetchone()
    if asset is None:
        raise HTTPException(404, "asset not found")
    if asset["kind"] != "image":
        raise HTTPException(400, "asset is not an image")
    song = None
    if (payload or {}).get("song_id"):
        song = _song_for_ai(int(payload["song_id"]))
    seed = (payload or {}).get("seed") or None
    try:
        with open(asset["file_path"], "rb") as f:
            data = f.read()
    except OSError as e:
        raise HTTPException(500, f"asset read failed: {e}")
    return inspire_mod.inspire_from_image_bytes(data, song=song, user_seed=seed)


@app.post("/api/songs/{song_id}/gens/generate")
def gen_sync(song_id: int, payload: dict = Body(...)):
    """Synchronously call a tool and persist the resulting gen."""
    tool = (payload or {}).get("tool", "")
    prompt = (payload or {}).get("prompt") or ""
    aspect = (payload or {}).get("aspect", "square")
    if not tool:
        raise HTTPException(400, "tool required")
    s = _song_for_ai(song_id)
    if not prompt:
        excerpt = " / ".join(l["text"] for l in (s.get("lyrics") or [])[:8])
        prompt = build_default_prompt(s, excerpt)

    with _db_lock:
        cur = _conn.execute(
            """INSERT INTO gens(song_id, kind, tool, prompt, status)
               VALUES(?,?,?,?,?)""",
            (song_id, "image", tool, prompt, "running"),
        )
        gen_id = cur.lastrowid

    result = ai_generate_image(tool, prompt, song_id, aspect=aspect)

    with _db_lock:
        if "error" in result:
            _conn.execute(
                "UPDATE gens SET status='failed', error=? WHERE id=?",
                (result["error"], gen_id),
            )
            return {"id": gen_id, "error": result["error"]}
        _conn.execute(
            "UPDATE gens SET status='completed', file_path=?, model_version=? WHERE id=?",
            (result["file_path"], result.get("model_version"), gen_id),
        )
    return {"id": gen_id, "file_path": result["file_path"], "tool": tool}


@app.post("/api/songs/{song_id}/gens/enqueue")
def gen_enqueue(song_id: int, payload: dict = Body(...)):
    tool = (payload or {}).get("tool", "")
    if not tool:
        raise HTTPException(400, "tool required")
    s = _conn.execute("SELECT id FROM songs WHERE id=?", (song_id,)).fetchone()
    if not s:
        raise HTTPException(404, "song not found")
    gen_id = job_queue.enqueue(_conn, song_id, tool)
    job_queue.start()
    return {"gen_id": gen_id, "tool": tool, "status": "pending"}


@app.post("/api/batch")
def batch_fill(payload: dict = Body(...)):
    """Enqueue jobs for every song that lacks a completed gen of the given tool.

    Body: {tool: 'nano-banana'|'grok', account?: str, limit?: int}
    """
    tool = (payload or {}).get("tool", "")
    if not tool:
        raise HTTPException(400, "tool required")
    account = (payload or {}).get("account")
    limit = int((payload or {}).get("limit", 50))

    where = ["NOT EXISTS (SELECT 1 FROM gens g WHERE g.song_id=s.id AND g.tool=? AND g.status='completed')"]
    args: list = [tool]
    if account:
        where.append("s.account=?")
        args.append(account)
    sql = f"SELECT s.id FROM songs s WHERE {' AND '.join(where)} ORDER BY s.id LIMIT ?"
    args.append(limit)
    rows = _conn.execute(sql, args).fetchall()

    enqueued = []
    for r in rows:
        gen_id = job_queue.enqueue(_conn, r["id"], tool)
        enqueued.append({"song_id": r["id"], "gen_id": gen_id})
    job_queue.start()
    return {"enqueued": len(enqueued), "items": enqueued}


@app.get("/api/jobs")
def list_jobs(
    status: str | None = None,
    limit: int = Query(60, ge=1, le=500),
):
    where = []
    args: list = []
    if status:
        where.append("j.status = ?")
        args.append(status)
    sql = f"""SELECT j.id, j.song_id, s.title, j.tool, j.status, j.error,
                     j.created_at, j.started_at, j.finished_at,
                     j.gen_id, g.file_path
              FROM jobs j JOIN songs s ON s.id=j.song_id
              LEFT JOIN gens g ON g.id=j.gen_id
              {'WHERE ' + ' AND '.join(where) if where else ''}
              ORDER BY j.id DESC LIMIT ?"""
    args.append(limit)
    rows = _conn.execute(sql, args).fetchall()
    summary = _rows(
        _conn.execute(
            "SELECT status, COUNT(*) AS n FROM jobs GROUP BY status"
        ).fetchall()
    )
    return {"items": _rows(rows), "summary": summary}


@app.delete("/api/jobs")
def clear_completed_jobs():
    with _db_lock:
        _conn.execute("DELETE FROM jobs WHERE status IN ('completed','failed')")
    return {"ok": True}


# ----------------------------- Export -------------------------------

@app.post("/api/songs/{song_id}/auto")
def auto_pipeline(song_id: int, payload: dict = Body({})):
    """One-click cheapest-free pipeline:
        1. Enhance prompt via best available text model (Gemini free → DeepSeek paid)
        2. Generate N images via best available image tool (Pollinations always)
        3. Optionally animate first image via best available video tool

    Body: {count?: int (default 4), animate?: bool (default false), seed?: str}
    """
    song = _song_for_ai(song_id)
    count = max(1, min(8, int((payload or {}).get("count", 4))))
    animate = bool((payload or {}).get("animate", False))
    user_seed = (payload or {}).get("seed", "")

    out = {"steps": [], "image_gen_ids": [], "video_gen_id": None}

    # Step 1: enhance prompt
    text_model = auto_text_model()
    img_tool = auto_image_tool()
    if not img_tool:
        return {"error": "No image tool available. Pollinations should always work — check network."}

    if text_model:
        enhance_result = ai_enhance_prompt(text_model, song, user_seed=user_seed)
        if "error" in enhance_result:
            out["steps"].append({"step": "enhance", "model": text_model, "error": enhance_result["error"]})
            prompt_text = song.get("prompt") or song["title"]
        else:
            prompt_text = enhance_result["prompt"]
            out["steps"].append({"step": "enhance", "model": enhance_result.get("model_version", text_model), "ok": True})
    else:
        # Fallback: build basic prompt from song meta
        excerpt = " / ".join(l["text"] for l in (song.get("lyrics") or [])[:6])
        prompt_text = f'A cinematic music video frame for "{song["title"]}". Genre: {song.get("genre") or "unspecified"}. Mood: {excerpt or "atmospheric"}. 16:9, painterly.'
        out["steps"].append({"step": "enhance", "skipped": "no text model"})

    out["prompt"] = prompt_text

    # Step 2: generate N images in parallel via the picked tool
    out["steps"].append({"step": "image-gen", "tool": img_tool, "count": count})
    for _ in range(count):
        with _db_lock:
            cur = _conn.execute(
                """INSERT INTO gens(song_id, kind, tool, prompt, status)
                   VALUES(?,?,?,?,?)""",
                (song_id, "image", img_tool, prompt_text, "running"),
            )
            gen_id = cur.lastrowid
        result = ai_generate_image(img_tool, prompt_text, song_id)
        with _db_lock:
            if "error" in result:
                _conn.execute(
                    "UPDATE gens SET status='failed', error=? WHERE id=?",
                    (result["error"], gen_id),
                )
            else:
                _conn.execute(
                    "UPDATE gens SET status='completed', file_path=?, model_version=? WHERE id=?",
                    (result["file_path"], result.get("model_version"), gen_id),
                )
                out["image_gen_ids"].append(gen_id)

    # Step 3: optional animate
    if animate and out["image_gen_ids"]:
        vid_tool = auto_video_tool()
        if vid_tool:
            src_id = out["image_gen_ids"][0]
            src_row = _conn.execute(
                "SELECT file_path FROM gens WHERE id=?", (src_id,)
            ).fetchone()
            if src_row and src_row["file_path"] and Path(src_row["file_path"]).exists():
                with open(src_row["file_path"], "rb") as f:
                    img_bytes = f.read()
                with _db_lock:
                    cur = _conn.execute(
                        """INSERT INTO gens(song_id, kind, tool, prompt, parent_gen_id, status)
                           VALUES(?,?,?,?,?,?)""",
                        (song_id, "video", vid_tool, prompt_text, src_id, "running"),
                    )
                    vid_gen_id = cur.lastrowid
                vresult = ai_animate_image(vid_tool, img_bytes, prompt_text, song_id)
                with _db_lock:
                    if "error" in vresult:
                        _conn.execute(
                            "UPDATE gens SET status='failed', error=? WHERE id=?",
                            (vresult["error"], vid_gen_id),
                        )
                        out["steps"].append({"step": "animate", "tool": vid_tool, "error": vresult["error"]})
                    else:
                        _conn.execute(
                            "UPDATE gens SET status='completed', file_path=?, model_version=? WHERE id=?",
                            (vresult["file_path"], vresult.get("model_version"), vid_gen_id),
                        )
                        out["video_gen_id"] = vid_gen_id
                        out["steps"].append({"step": "animate", "tool": vid_tool, "ok": True})
        else:
            out["steps"].append({"step": "animate", "skipped": "no HF_TOKEN — use Kling handoff manually"})

    return out


@app.post("/api/gens/{gen_id}/animate")
def animate_gen(gen_id: int, payload: dict = Body({})):
    """Image-to-video on a completed image gen. Adds a new gen of kind=video."""
    src = _conn.execute(
        "SELECT id, song_id, kind, file_path, prompt FROM gens WHERE id=?", (gen_id,)
    ).fetchone()
    if src is None:
        raise HTTPException(404, "gen not found")
    if src["kind"] != "image":
        raise HTTPException(400, "can only animate image gens")
    if not src["file_path"] or not Path(src["file_path"]).exists():
        raise HTTPException(404, "source image file missing")

    tool = (payload or {}).get("tool", "hf-ltx-video")
    motion_prompt = (payload or {}).get("prompt") or src["prompt"] or "subtle ambient motion, drift, atmospheric"

    with open(src["file_path"], "rb") as f:
        img_bytes = f.read()

    with _db_lock:
        cur = _conn.execute(
            """INSERT INTO gens(song_id, kind, tool, prompt, parent_gen_id, status)
               VALUES(?,?,?,?,?,?)""",
            (src["song_id"], "video", tool, motion_prompt, gen_id, "running"),
        )
        new_gen_id = cur.lastrowid

    result = ai_animate_image(tool, img_bytes, motion_prompt, src["song_id"])
    with _db_lock:
        if "error" in result:
            _conn.execute(
                "UPDATE gens SET status='failed', error=? WHERE id=?",
                (result["error"], new_gen_id),
            )
            return {"id": new_gen_id, "error": result["error"]}
        _conn.execute(
            "UPDATE gens SET status='completed', file_path=?, model_version=? WHERE id=?",
            (result["file_path"], result.get("model_version"), new_gen_id),
        )
    return {"id": new_gen_id, "file_path": result["file_path"], "tool": tool, "kind": "video"}


@app.post("/api/songs/{song_id}/export")
def export_song(song_id: int):
    s = _conn.execute(
        "SELECT id, mp3_path, duration FROM songs WHERE id=?", (song_id,)
    ).fetchone()
    if s is None:
        raise HTTPException(404, "song not found")
    gens = _rows(
        _conn.execute(
            """SELECT id, kind, file_path FROM gens
               WHERE song_id=? AND status='completed' AND file_path IS NOT NULL
                     AND tool != 'export'
               ORDER BY id""",
            (song_id,),
        ).fetchall()
    )
    result = render_slideshow(song_id, s["mp3_path"], s["duration"] or 0, gens)

    # If render succeeded, register the MP4 as a gen so it shows in the media tray
    # under Gens (output) and can be picked / deleted like any other clip.
    if "file_path" in result and result.get("file_path"):
        with _db_lock:
            cur = _conn.execute(
                """INSERT INTO gens(song_id, kind, tool, prompt, file_path, status)
                   VALUES(?,?,?,?,?,?)""",
                (song_id, "video", "export", f"slideshow render of {result.get('visuals_used', 0)} clips",
                 result["file_path"], "completed"),
            )
            result["gen_id"] = cur.lastrowid
    return result


@app.get("/media/export/{song_id}")
def media_export(song_id: int):
    out = EXPORTS_DIR / f"song_{song_id}.mp4"
    if not out.exists():
        raise HTTPException(404, "export not yet rendered")
    return FileResponse(out, media_type="video/mp4", filename=f"song_{song_id}.mp4")


@app.post("/api/songs/{song_id}/gens/from_asset/{asset_id}")
def attach_asset_as_gen(song_id: int, asset_id: int):
    """Reuse an existing asset (image/video) as a song's visual without copying it."""
    song = _conn.execute("SELECT id FROM songs WHERE id=?", (song_id,)).fetchone()
    asset = _conn.execute(
        "SELECT id, kind, file_path FROM assets WHERE id=?", (asset_id,)
    ).fetchone()
    if not song:
        raise HTTPException(404, "song not found")
    if not asset:
        raise HTTPException(404, "asset not found")
    with _db_lock:
        cur = _conn.execute(
            """INSERT INTO gens(song_id, kind, tool, prompt, file_path, status)
               VALUES(?,?,?,?,?,?)""",
            (song_id, asset["kind"], "asset", "", asset["file_path"], "completed"),
        )
        gen_id = cur.lastrowid
    return {"id": gen_id, "file_path": asset["file_path"]}


@app.delete("/api/gens/{gen_id}")
def delete_gen(gen_id: int):
    row = _conn.execute("SELECT file_path FROM gens WHERE id=?", (gen_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "gen not found")
    fp = row["file_path"]
    with _db_lock:
        _conn.execute("DELETE FROM gens WHERE id=?", (gen_id,))
    if fp and Path(fp).exists():
        try:
            Path(fp).unlink()
        except OSError:
            pass
    return {"ok": True}


# ----------------------------- Assets -------------------------------

@app.get("/api/assets")
def list_assets(
    folder: str | None = None,
    kind: str | None = None,
    limit: int = Query(120, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    where = []
    args: list = []
    if folder:
        where.append("folder = ?")
        args.append(folder)
    if kind:
        where.append("kind = ?")
        args.append(kind)
    sql = f"""SELECT id, kind, file_path, folder, width, height, duration, phash
              FROM assets {'WHERE ' + ' AND '.join(where) if where else ''}
              ORDER BY id DESC LIMIT ? OFFSET ?"""
    args.extend([limit, offset])
    rows = _conn.execute(sql, args).fetchall()
    total = _conn.execute(
        f"SELECT COUNT(*) FROM assets {'WHERE ' + ' AND '.join(where) if where else ''}",
        args[:-2] if where else [],
    ).fetchone()[0]
    return {"items": _rows(rows), "total": total}


@app.get("/api/asset_folders")
def asset_folders():
    rows = _conn.execute(
        "SELECT folder, COUNT(*) AS n FROM assets GROUP BY folder ORDER BY n DESC"
    ).fetchall()
    out = _rows(rows)
    # Inject synthetic "_gens" folder so the sidebar can offer the gens output dir
    gens_n = _conn.execute(
        "SELECT COUNT(*) FROM gens WHERE status='completed' AND file_path IS NOT NULL"
    ).fetchone()[0]
    out.insert(0, {"folder": "_gens", "n": gens_n, "synthetic": True})
    return out


@app.get("/api/gens_browse")
def gens_browse(
    limit: int = Query(120, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Browse all completed gens across all songs — used by the media tray."""
    rows = _conn.execute(
        """SELECT g.id, g.song_id, s.title AS song_title, g.kind, g.tool,
                  g.file_path, g.created_at, g.prompt
           FROM gens g JOIN songs s ON s.id = g.song_id
           WHERE g.status='completed' AND g.file_path IS NOT NULL
           ORDER BY g.id DESC LIMIT ? OFFSET ?""",
        (limit, offset),
    ).fetchall()
    total = _conn.execute(
        "SELECT COUNT(*) FROM gens WHERE status='completed' AND file_path IS NOT NULL"
    ).fetchone()[0]
    return {"items": _rows(rows), "total": total}


# ----------------------------- Media serving ------------------------

def _under(p: str, allowed_dirs: list[Path]) -> bool:
    try:
        rp = Path(p).resolve()
    except OSError:
        return False
    for d in allowed_dirs:
        try:
            rp.relative_to(d.resolve())
            return True
        except ValueError:
            continue
    return False


_MEDIA_ROOTS = [SUNO_LIBRARY, ASSETS_DIR, GENS_DIR, EXPORTS_DIR]


@app.get("/media/audio/{song_id}")
def media_audio(song_id: int):
    row = _conn.execute("SELECT mp3_path FROM songs WHERE id=?", (song_id,)).fetchone()
    if row is None or not row["mp3_path"]:
        raise HTTPException(404, "audio not found")
    if not _under(row["mp3_path"], _MEDIA_ROOTS):
        raise HTTPException(403, "forbidden")
    return FileResponse(row["mp3_path"], media_type="audio/mpeg")


@app.get("/media/cover/{song_id}")
def media_cover(song_id: int):
    row = _conn.execute("SELECT jpg_path FROM songs WHERE id=?", (song_id,)).fetchone()
    if row is None or not row["jpg_path"]:
        raise HTTPException(404, "cover not found")
    if not _under(row["jpg_path"], _MEDIA_ROOTS):
        raise HTTPException(403, "forbidden")
    return FileResponse(row["jpg_path"])


@app.get("/media/asset/{asset_id}")
def media_asset(asset_id: int):
    row = _conn.execute("SELECT file_path, kind FROM assets WHERE id=?", (asset_id,)).fetchone()
    if row is None or not row["file_path"]:
        raise HTTPException(404, "asset not found")
    if not _under(row["file_path"], _MEDIA_ROOTS):
        raise HTTPException(403, "forbidden")
    return FileResponse(row["file_path"])


@app.get("/media/gen/{gen_id}")
def media_gen(gen_id: int):
    row = _conn.execute("SELECT file_path FROM gens WHERE id=?", (gen_id,)).fetchone()
    if row is None or not row["file_path"]:
        raise HTTPException(404, "gen not found")
    if not _under(row["file_path"], _MEDIA_ROOTS):
        raise HTTPException(403, "forbidden")
    return FileResponse(row["file_path"])


# ----------------------------- Maintenance --------------------------

_reindex_state = {"running": False, "last_result": None}


def _reindex_runner():
    _reindex_state["running"] = True
    try:
        _reindex_state["last_result"] = full_reindex(verbose=False)
    finally:
        _reindex_state["running"] = False


@app.post("/api/reindex")
def reindex_endpoint():
    if _reindex_state["running"]:
        return {"ok": False, "running": True, "message": "reindex already in progress"}
    threading.Thread(target=_reindex_runner, daemon=True).start()
    return {"ok": True, "running": True}


@app.get("/api/reindex/status")
def reindex_status():
    return _reindex_state


@app.get("/api/stats")
def stats():
    g = _conn.execute
    return {
        "songs": g("SELECT COUNT(*) FROM songs").fetchone()[0],
        "lyric_lines": g("SELECT COUNT(*) FROM lyric_lines").fetchone()[0],
        "relationships": g("SELECT COUNT(*) FROM relationships").fetchone()[0],
        "assets": g("SELECT COUNT(*) FROM assets").fetchone()[0],
        "gens": g("SELECT COUNT(*) FROM gens").fetchone()[0],
        "accounts": g("SELECT COUNT(DISTINCT account) FROM songs").fetchone()[0],
        "with_cache": g("SELECT COUNT(*) FROM songs WHERE suno_id IS NOT NULL").fetchone()[0],
    }


# ----------------------------- Chrome extension bridge --------------

_extension_state = {"current_song_id": None, "set_at": None}


@app.post("/api/extension/current-song-set")
def ext_set_current_song(payload: dict = Body(...)):
    """Frontend tells the backend which song is currently open. The Chrome
    extension reads this to pick the attach target for right-click image sends."""
    sid = (payload or {}).get("song_id")
    if sid is None:
        _extension_state["current_song_id"] = None
        _extension_state["set_at"] = None
        return {"ok": True, "cleared": True}
    try: sid = int(sid)
    except (TypeError, ValueError): raise HTTPException(400, "song_id must be int or null")
    row = _conn.execute("SELECT id FROM songs WHERE id=?", (sid,)).fetchone()
    if row is None:
        raise HTTPException(404, "song not found")
    _extension_state["current_song_id"] = sid
    import datetime as _dt
    _extension_state["set_at"] = _dt.datetime.utcnow().isoformat()
    return {"ok": True, "song_id": sid}


@app.get("/api/extension/current-song")
def ext_get_current_song():
    sid = _extension_state.get("current_song_id")
    if not sid:
        return {"song": None}
    song = _conn.execute(
        "SELECT id, title, base_title, version, account FROM songs WHERE id=?",
        (sid,),
    ).fetchone()
    return {"song": _row(song), "set_at": _extension_state.get("set_at")}


@app.post("/api/extension/import-image")
async def ext_import_image(payload: dict = Body(...)):
    """Fetch an image (or video) URL and save it. If attach_to_current is true
    AND a current song is set, attach as a gen on that song. Otherwise save as
    a gen with kind=image and song_id=<current_song_id or 0> for browse-only."""
    url = (payload or {}).get("url", "").strip()
    if not url or not url.startswith(("http://", "https://")):
        raise HTTPException(400, "url required (http/https)")
    attach = bool((payload or {}).get("attach_to_current", False))
    source_url = (payload or {}).get("source_url")

    import httpx
    try:
        with httpx.Client(timeout=60, follow_redirects=True,
                          headers={"User-Agent": "myspot-extension/0.1"}) as c:
            r = c.get(url)
            r.raise_for_status()
            data = r.content
            ct = (r.headers.get("content-type") or "").split(";")[0]
    except httpx.HTTPStatusError as e:
        return {"error": f"Fetch HTTP {e.response.status_code}"}
    except Exception as e:
        return {"error": f"Fetch failed: {type(e).__name__}: {e}"}

    if not data or len(data) < 256:
        return {"error": f"Empty/invalid response (size={len(data)})"}

    is_video = ct.startswith("video/") or url.lower().endswith((".mp4", ".webm", ".mov"))
    is_image = ct.startswith("image/") or url.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))
    if not (is_image or is_video):
        return {"error": f"URL did not return image/video (ct={ct})"}

    kind = "video" if is_video else "image"
    suffix = "." + (ct.split("/")[1] if "/" in ct else ("mp4" if is_video else "jpg"))
    suffix = suffix.replace(".jpeg", ".jpg")[:5]
    if suffix not in (".jpg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov"):
        suffix = ".bin"

    GENS_DIR.mkdir(parents=True, exist_ok=True)
    import time as _time
    target_song_id = _extension_state.get("current_song_id") if attach else None
    fname = f"song{target_song_id or 0}_{int(_time.time()*1000)}_extension{suffix}"
    out = GENS_DIR / fname
    out.write_bytes(data)
    out_path = str(out).replace("\\", "/")

    result = {"ok": True, "file_path": out_path, "kind": kind, "size": len(data)}

    if attach and target_song_id:
        with _db_lock:
            cur = _conn.execute(
                """INSERT INTO gens(song_id, kind, tool, prompt, file_path, status)
                   VALUES(?,?,?,?,?,?)""",
                (target_song_id, kind, "extension", source_url or "", out_path, "completed"),
            )
            gen_id = cur.lastrowid
        result["attached_to_song_id"] = target_song_id
        result["gen_id"] = gen_id
    else:
        # Index as a free-floating asset under a synthetic _extension folder so
        # it shows up in the media tray.
        with _db_lock:
            cur = _conn.execute(
                """INSERT INTO assets(kind, file_path, folder)
                   VALUES(?,?,?)""",
                (kind, out_path, "_extension"),
            )
            asset_id = cur.lastrowid
        result["asset_id"] = asset_id

    return result


# ----------------------------- SSE stub -----------------------------

@app.get("/api/events")
async def events():
    async def gen():
        yield ": connected\n\n"
        while True:
            await asyncio.sleep(15)
            yield ": ping\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")


# ----------------------------- Frontend -----------------------------

if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
def index():
    idx = FRONTEND_DIR / "index.html"
    if not idx.exists():
        return JSONResponse(
            {"error": "frontend not built", "hint": "frontend/index.html missing"},
            status_code=503,
        )
    return FileResponse(idx)


@app.on_event("startup")
def _startup():
    job_queue.start()


@app.on_event("shutdown")
def _shutdown():
    job_queue.stop()


def main():
    import uvicorn
    uvicorn.run("backend.app:app", host=HOST, port=PORT, reload=False)


if __name__ == "__main__":
    main()
