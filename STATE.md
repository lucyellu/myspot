# myspot — Current State

> Self-contained snapshot for cold pickup. Read STATE.md → PLAN.md → DESIGN-BRIEF.md to continue.

## Pick up here

**Repo:** https://github.com/lucyellu/myspot — `main` branch, latest commit on `1f90697`+.
**Local:** `C:\Users\lucyl\Desktop\myspot\` — double-click `myspot.lnk` to launch.
**Netlify:** https://myspot-web.netlify.app — static frontend only; backend must be reachable via Cloudflare tunnel (see below).

---

## Running the app

```bash
# Local only
double-click Desktop\myspot.lnk          # or:
cd C:\Users\lucyl\Desktop\myspot
python -m backend.app                     # serves http://127.0.0.1:7777

# Public (Cloudflare quick tunnel)
double-click Desktop\myspot (public).lnk  # opens backend + cloudflared in separate windows
# cloudflared window prints: https://xxxx.trycloudflare.com
# Open https://myspot-web.netlify.app → click ⚙ in topbar → paste tunnel URL → Save & Reload

# Re-fingerprint after adding songs
click ♫ button in topbar                  # computes MFCC audio fingerprints in background
```

---

## Architecture

```
myspot/
├── backend/
│   ├── app.py          ~55 endpoints, FastAPI, schema v2
│   ├── db.py           SQLite schema — SCHEMA_VERSION=2, 14 tables + lyric_fts + mfcc col
│   ├── library.py      full reindex (no incremental)
│   ├── fingerprint.py  librosa MFCC extraction + cosine_sim (NEW)
│   ├── derivatives.py  filename version inference
│   ├── lyrics.py       [Section]-bracket parser
│   ├── render.py       ffmpeg slideshow MP4 export
│   ├── config.py       paths + .env / secrets/ resolution
│   └── ai/             tool registry, queue, claude/deepseek/gemini/pollinations/hf/grok
├── frontend/
│   ├── index.html      shell + templates; ⚙ backend-URL picker, ♫ fingerprint btn
│   ├── css/app.css     cassette/radio theme, dual-shelf layout, preview overlay
│   └── js/
│       ├── main.js     router + drawer + search + api-popover + fingerprint btn
│       ├── api.js      all API calls; BASE from localStorage/config.js/?api=
│       ├── sidepanel.js
│       ├── theme.js
│       ├── util.js
│       ├── views/home.js, watch.js, assets.js
│       └── tabs/generate.js, lyrics.js, design.js, sources.js, prompts.js, queue.js, notes.js
├── data/myspot.db      SQLite WAL (gitignored)
├── data/gens/          AI outputs (gitignored)
├── assets/<folder>/    personal media (gitignored)
├── secrets/            API keys (gitignored)
├── start.bat           local launcher
├── start_public.bat    local + cloudflared tunnel launcher
├── make_shortcut.ps1   recreates Desktop .lnk shortcuts
└── requirements.txt    includes librosa
```

---

## SQLite schema (v2)

`songs` table has `mfcc TEXT` column (JSON float[20], nullable — populated by /api/fingerprint-all).
All other tables unchanged from v1. Migration runs automatically on startup.

| Table | Purpose |
|---|---|
| `songs` | every track; mfcc col for audio similarity |
| `lyric_lines` + `lyric_fts` | parsed lyrics + FTS5 search |
| `relationships` | derivative chain (parent_id, child_id, kind) |
| `assets` | personal media files |
| `gens` | AI/manual visuals per song |
| `prompts` | template vault |
| `jobs` | background gen queue |
| `notes` | per-song notes |
| `play_history` | playback log |
| `playlists`, `playlist_songs` | (schema only, unused) |
| `edits`, `clips` | (schema only, M5b) |

---

## Key frontend features (current)

**Watch page layout:**
- Player (visual stage + transport) at top
- MEDIA shelf + UP NEXT shelf side-by-side below player — both always open, independently scrollable
- Clicking a media tile → loads into visual stage (`stageUrl`); "+ track" button attaches to track strip
- Side panel: FM-dial tabs (GENERATE, LYRICS, DESIGN, SOURCES, PROMPTS, BATCH)

**Sources tab:**
- Expand/collapse inline tree with ▶/▼ toggle — no page navigation needed
- Seen-set prevents circular recursion (songs already in tree show "already shown")
- ↗ link still navigates to that song if wanted

**Audio similarity (`/api/songs/{id}/related`):**
- Uses MFCC cosine similarity when fingerprints exist → `reason: "audio"`
- Falls back to title/account matching when no fingerprints

**Assets view:**
- Click asset card → opens preview lightbox (image/video full size)
- "Attach to song…" button in lightbox for associating with a song
- Esc or click outside closes

**Netlify / remote access:**
- ⚙ button in topbar → paste Cloudflare tunnel URL → saves to localStorage → reloads
- `window.MYSPOT_API_BASE` read from localStorage before config.js on every load
- All `mediaUrl.*` helpers prepend BASE so audio/covers/gens work remotely

**Left sidebar:**
- Smart-tag entries (LIVE, ACOUSTIC, REMIX, etc.) — no emojis

---

## Endpoints (additions since original STATE)

```
GET  /api/songs/{id}/related   → MFCC cosine similarity rank when fingerprints exist
POST /api/fingerprint-all      → background MFCC computation for all songs missing mfcc
POST /api/songs/{id}/like
POST /api/songs/{id}/play
GET  /api/songs/{id}/plays
GET  /api/top-songs?by=popular|liked|gens|recent_played&limit&account
POST /api/reindex / GET /api/reindex/status
POST /api/songs/{id}/export
POST /api/extension/current-song-set
GET  /api/extension/current-song
POST /api/extension/import-image
```

---

## Wired AI tools

| Tool | Kind | Free? | Key var |
|---|---|---|---|
| Pollinations FLUX (realism/anime/turbo/dev) | image | FREE unlimited | none |
| Gemini 2.5 Flash | text | 250/day free | GEMINI_API_KEY |
| DeepSeek V3 | text | $5 funded | DEEPSEEK_API_KEY |
| Nano Banana (Gemini) | image | $25 funded | GEMINI_API_KEY |
| Gemini Vision (inspire) | vision | 250/day free | GEMINI_API_KEY |
| HF FLUX-schnell | image | ~30/mo free | HF_TOKEN |
| HF LTX-Video / CogVideoX / Wan | video | ~3-60/mo free | HF_TOKEN |
| Claude Sonnet | text | — | ANTHROPIC_API_KEY |
| Grok Imagine | image | — | XAI_API_KEY |

Default image tool: `pollinations-realism`. Default text model: `gemini-text`.

---

## Library state (last full reindex)

- ~5,720 songs across 6 Suno accounts
- ~109,928 lyric lines (FTS5 searchable)
- ~2,651 derivative relationships
- ~1,020 personal assets
- MFCC fingerprints: run ♫ button to populate (first time ~10 min for full library)

---

## Known issues / caveats

- Re-index is full, not incremental (~110s)
- Suno covers are 40×40px (SunoSync thumbnails) — displayed OK with object-fit:cover
- Lyrics highlight is progress-based, not real timestamps
- HF API may 503 on cold start — retry after 30s
- Slideshow render is hard-cut (no crossfade yet)
- MFCC fingerprinting requires `pip install librosa` — not auto-installed

---

## Quick recipes

```bash
# Inspect db
sqlite3 data/myspot.db "SELECT id, title, version, account FROM songs LIMIT 5"

# Check fingerprint coverage
sqlite3 data/myspot.db "SELECT COUNT(*) FROM songs WHERE mfcc IS NOT NULL"

# Trigger auto pipeline
curl -X POST http://127.0.0.1:7777/api/songs/27/auto \
  -H 'Content-Type: application/json' -d '{"count":4}'

# Check health / tools
curl http://127.0.0.1:7777/api/health

# Full reindex
python -m backend.library
```

---

## Files to read for cold pickup

1. **STATE.md** (this)
2. **PLAN.md** — phased roadmap
3. **DESIGN-BRIEF.md** — frontend aesthetic decisions
4. **MODELS.md** — AI pricing + free tiers
5. `backend/app.py` — all endpoints
6. `backend/db.py` — full schema
7. `frontend/js/api.js` — every API call
