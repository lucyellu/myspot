"""Indexes suno_library/<account>/ track triplets and assets/ media into SQLite."""
import os
import time
from pathlib import Path

from mutagen.mp3 import MP3
from PIL import Image
import imagehash

from .config import SUNO_LIBRARY, ASSETS_DIR
from .db import init_db, tx
from .sunosync_cache import SunoSyncCache
from .sunometa_db import SunoMetaDB
from .lyrics import parse_lyrics_file
from .derivatives import split_version, build_relationships


AUDIO_EXTS = {".mp3"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".mov", ".avi"}


def _try_mp3_duration(mp3_path: Path) -> float | None:
    try:
        return float(MP3(str(mp3_path)).info.length)
    except Exception:
        return None


def _try_phash(img_path: Path) -> str | None:
    try:
        with Image.open(img_path) as im:
            im.thumbnail((256, 256))
            return str(imagehash.phash(im))
    except Exception:
        return None


def _try_image_dims(img_path: Path) -> tuple[int | None, int | None]:
    try:
        with Image.open(img_path) as im:
            return im.width, im.height
    except Exception:
        return None, None


def index_suno_library(conn, cache: SunoSyncCache, meta_db: SunoMetaDB | None = None, *, verbose: bool = True) -> dict:
    """Walk SUNO_LIBRARY/<account>/*.mp3 and upsert into songs + lyric_lines.

    Existing rows are updated (not duplicated) by mp3_path uniqueness.
    Returns counts dict.
    """
    if not SUNO_LIBRARY.exists():
        return {"songs": 0, "lyrics": 0, "skipped": 0, "error": "library_missing"}

    inserted = 0
    updated = 0
    lyric_count = 0
    skipped = 0
    t0 = time.time()

    existing_paths = {
        row["mp3_path"]: row["id"]
        for row in conn.execute("SELECT id, mp3_path FROM songs")
    }

    with tx(conn):
        for account_dir in sorted(p for p in SUNO_LIBRARY.iterdir() if p.is_dir()):
            account = account_dir.name
            for mp3_file in account_dir.iterdir():
                if mp3_file.suffix.lower() not in AUDIO_EXTS:
                    continue
                if not mp3_file.is_file():
                    continue
                stem = mp3_file.stem
                jpg = mp3_file.with_suffix(".jpg")
                txt = mp3_file.with_suffix(".txt")
                wav = mp3_file.with_suffix(".wav")
                mid = mp3_file.with_suffix(".mid")

                base_title, version = split_version(stem)
                cache_entry = cache.lookup(mp3_file.name) or {}
                duration = (
                    cache_entry.get("duration") or _try_mp3_duration(mp3_file)
                )
                genre = SunoSyncCache.normalize_genre(cache_entry.get("genre"))
                bpm = SunoSyncCache.parse_bpm(cache_entry.get("bpm"))
                prompt = cache_entry.get("prompt") or None
                suno_id = cache_entry.get("id") or None
                artist = cache_entry.get("artist") or None
                suno_date = cache_entry.get("date") or None
                title = cache_entry.get("title") or stem

                # Enrich with live Suno API metadata if available
                meta_entry = (meta_db.lookup(suno_id) if meta_db and suno_id else None) or {}
                suno_play_count   = meta_entry.get("play_count")
                suno_upvote_count = meta_entry.get("upvote_count")
                suno_is_liked     = meta_entry.get("is_liked")
                suno_model        = meta_entry.get("model_name") or None
                suno_style        = meta_entry.get("style") or None
                suno_video_url    = meta_entry.get("video_url") or None

                mp3_path_str = str(mp3_file).replace("\\", "/")
                jpg_path_str = str(jpg).replace("\\", "/") if jpg.exists() else None
                txt_path_str = str(txt).replace("\\", "/") if txt.exists() else None
                wav_path_str = str(wav).replace("\\", "/") if wav.exists() else None
                mid_path_str = str(mid).replace("\\", "/") if mid.exists() else None

                fields = (
                    suno_id, title, base_title, version, artist, account, genre,
                    bpm, prompt, duration, mp3_path_str, jpg_path_str, txt_path_str,
                    wav_path_str, mid_path_str, suno_date,
                    suno_play_count, suno_upvote_count, suno_is_liked,
                    suno_model, suno_style, suno_video_url,
                )

                if mp3_path_str in existing_paths:
                    song_id = existing_paths[mp3_path_str]
                    conn.execute(
                        """UPDATE songs SET
                            suno_id=?, title=?, base_title=?, version=?, artist=?,
                            account=?, genre=?, bpm=?, prompt=?, duration=?,
                            mp3_path=?, jpg_path=?, txt_path=?, wav_path=?,
                            mid_path=?, suno_date=?,
                            suno_play_count=?, suno_upvote_count=?, suno_is_liked=?,
                            suno_model=?, suno_style=?, suno_video_url=?
                           WHERE id=?""",
                        fields + (song_id,),
                    )
                    updated += 1
                else:
                    cur = conn.execute(
                        """INSERT INTO songs(
                            suno_id, title, base_title, version, artist,
                            account, genre, bpm, prompt, duration,
                            mp3_path, jpg_path, txt_path, wav_path,
                            mid_path, suno_date,
                            suno_play_count, suno_upvote_count, suno_is_liked,
                            suno_model, suno_style, suno_video_url
                           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        fields,
                    )
                    song_id = cur.lastrowid
                    inserted += 1

                if txt_path_str:
                    rows = parse_lyrics_file(txt)
                    if rows:
                        conn.execute("DELETE FROM lyric_lines WHERE song_id=?", (song_id,))
                        conn.execute("DELETE FROM lyric_fts WHERE song_id=?", (song_id,))
                        conn.executemany(
                            "INSERT INTO lyric_lines(song_id, idx, text, section) VALUES(?,?,?,?)",
                            [(song_id, i, t, sec) for (i, t, sec) in rows],
                        )
                        conn.executemany(
                            "INSERT INTO lyric_fts(text, song_id) VALUES(?,?)",
                            [(t, song_id) for (_, t, _) in rows],
                        )
                        lyric_count += len(rows)

                if verbose and (inserted + updated) % 200 == 0:
                    print(f"  ... {inserted + updated} songs ({inserted} new)")

    return {
        "songs_inserted": inserted,
        "songs_updated": updated,
        "lyric_lines": lyric_count,
        "skipped": skipped,
        "elapsed_sec": round(time.time() - t0, 2),
    }


def rebuild_relationships(conn) -> int:
    rows = conn.execute(
        "SELECT id, account, base_title, version, title FROM songs"
    ).fetchall()
    songs = [dict(r) for r in rows]
    rels = build_relationships(songs)
    with tx(conn):
        conn.execute("DELETE FROM relationships")
        if rels:
            conn.executemany(
                "INSERT OR IGNORE INTO relationships(parent_id, child_id, kind) VALUES(?,?,?)",
                rels,
            )
    return len(rels)


def index_assets(conn, *, verbose: bool = True) -> dict:
    """Walk ASSETS_DIR and index each image/video file.

    Folder = first subdir under assets/ (used as a tag-ish grouping).
    """
    if not ASSETS_DIR.exists():
        return {"assets": 0, "error": "assets_missing"}

    inserted = 0
    updated = 0
    skipped = 0
    t0 = time.time()

    existing = {
        row["file_path"]: row["id"]
        for row in conn.execute("SELECT id, file_path FROM assets")
    }

    with tx(conn):
        for path in ASSETS_DIR.rglob("*"):
            if not path.is_file():
                continue
            ext = path.suffix.lower()
            if ext in IMAGE_EXTS:
                kind = "image"
            elif ext in VIDEO_EXTS:
                kind = "video"
            else:
                skipped += 1
                continue

            rel = path.relative_to(ASSETS_DIR)
            folder = rel.parts[0] if len(rel.parts) > 1 else "_root"
            file_path_str = str(path).replace("\\", "/")

            width = height = None
            phash = None
            duration = None
            if kind == "image":
                width, height = _try_image_dims(path)
                phash = _try_phash(path)

            if file_path_str in existing:
                conn.execute(
                    """UPDATE assets SET kind=?, folder=?, width=?, height=?,
                        duration=?, phash=? WHERE id=?""",
                    (kind, folder, width, height, duration, phash, existing[file_path_str]),
                )
                updated += 1
            else:
                conn.execute(
                    """INSERT INTO assets(kind, file_path, folder, width, height, duration, phash)
                       VALUES(?,?,?,?,?,?,?)""",
                    (kind, file_path_str, folder, width, height, duration, phash),
                )
                inserted += 1
            if verbose and (inserted + updated) % 200 == 0:
                print(f"  ... {inserted + updated} assets")

    return {
        "assets_inserted": inserted,
        "assets_updated": updated,
        "skipped": skipped,
        "elapsed_sec": round(time.time() - t0, 2),
    }


def full_reindex(verbose: bool = True) -> dict:
    conn = init_db()
    cache = SunoSyncCache()
    cache_loaded = cache.load()
    meta_db = SunoMetaDB()
    meta_loaded = meta_db.load()
    if verbose:
        print(f"[cache] loaded={cache_loaded} entries={cache.entry_count}")
        print(f"[suno_meta] loaded={meta_loaded} entries={meta_db.entry_count}")
        print(f"[suno_library] scanning {SUNO_LIBRARY}...")
    suno_stats = index_suno_library(conn, cache, meta_db, verbose=verbose)
    if verbose:
        print(f"[suno_library] {suno_stats}")
        print("[derivatives] rebuilding relationships...")
    rel_count = rebuild_relationships(conn)
    if verbose:
        print(f"[derivatives] {rel_count} relationships")
        print(f"[assets] scanning {ASSETS_DIR}...")
    asset_stats = index_assets(conn, verbose=verbose)
    if verbose:
        print(f"[assets] {asset_stats}")
    return {
        "cache": {"loaded": cache_loaded, "entries": cache.entry_count},
        "suno_library": suno_stats,
        "relationships": rel_count,
        "assets": asset_stats,
    }


if __name__ == "__main__":
    import json
    print(json.dumps(full_reindex(), indent=2))
