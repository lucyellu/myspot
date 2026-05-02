# myspot — Current State

> Self-contained snapshot for cold pickup. Read this file before touching any code.

## Pick up here

**Repo:** https://github.com/lucyellu/myspot
**Active branch: `dev`** (created 2026-05-01, NOT yet pushed to origin)
**Local:** `C:\Users\lucyl\Desktop\myspot\`
**Netlify:** https://myspot-web.netlify.app — static frontend only; backend must be reachable via Cloudflare tunnel.

### Start the app
```
double-click Desktop\myspot.lnk   → launches dev branch at http://127.0.0.1:7777
```
start.bat runs `git checkout dev` before launching — shortcut always uses dev code.

---

## What changed in `dev` (2026-05-01) — NOT on main yet

### 1. suno_nightly metadata integration (schema v3)
- **`backend/sunometa_db.py`** (NEW) — reads `C:\Users\lucyl\Desktop\suno_nightly\suno_meta.db`
  by suno_id, returns play_count, upvote_count, is_liked, model_name, style, video_url
- **`backend/db.py`** — SCHEMA_VERSION bumped 2→3; migration adds 6 columns to songs:
  `suno_play_count`, `suno_upvote_count`, `suno_is_liked`, `suno_model`, `suno_style`, `suno_video_url`
- **`backend/library.py`** — reindex now loads SunoMetaDB, enriches songs on upsert;
  also falls back to suno_meta.db lyrics when no .txt file exists for a song
- **`backend/app.py`** — both list + detail song endpoints expose suno_* fields

### 2. UI improvements
- **Cards** show `suno_play_count` (♫) and `suno_upvote_count` (♥) — Suno platform counts.
  Local myspot play count removed from cards. "✓ cache" badge removed.
- **Sort direction toggle** — ↑↓ button beside Sort dropdown; passes `dir=asc|desc` to API.
  All sort options respect direction. `popular` sort now orders by `suno_play_count`.
- **Size slider** min reduced 70→40px
- **Lyrics fallback** — songs without .txt files get lyrics from suno_meta.db on reindex

### After switching to dev or restarting server
1. DB auto-migrates to v3 on startup
2. Click ↻ (reindex) in topbar to populate suno_* columns and lyrics for all songs
3. Songs with a suno_id (most of them) will show Suno play/like counts after reindex

---

## suno_nightly tool (separate project)

**Location:** `C:\Users\lucyl\Desktop\suno_nightly\`
**DB:** `suno_nightly\suno_meta.db` — 8600+ songs, all 6 accounts synced 2026-05-01
**Desktop shortcut:** "Suno Sync" (myspot icon)

### BLOCKER: tokens expire in 1 hour
The script supports `"cookie"` field in accounts.json (`__client` from suno.com) which auto-refreshes
JWT at runtime. **No accounts have cookies set yet** — currently using 1-hour JWTs manually.

**To fix (once per account):** log into suno.com → F12 → Application → Cookies → suno.com
→ copy `__client` value → add as `"cookie": "..."` in `accounts.json`

**Nightly scheduler not yet registered.** After cookies set, run as Admin:
```
C:\Users\lucyl\Desktop\suno_nightly\setup_scheduler.ps1
```

### accounts.json format
```json
[{ "name": "elludesign", "cookie": "dvb_...", "token": "eyJ..." }]
```

### Remaining work on suno_nightly
- [ ] Add `__client` cookies for all 6 accounts
- [ ] Run setup_scheduler.ps1 as admin to register 2am nightly task
- [ ] Optional: add `prefer_wav` / `download_video` toggle per account (for when premium)

---

## Architecture

```
myspot/
├── backend/
│   ├── app.py          ~55 endpoints, FastAPI
│   ├── db.py           SQLite schema v3, 14 tables + lyric_fts
│   ├── library.py      full reindex; uses SunoSyncCache + SunoMetaDB
│   ├── sunometa_db.py  reads suno_nightly/suno_meta.db (NEW in dev)
│   ├── sunosync_cache.py  reads legacy library_cache.json
│   ├── fingerprint.py  librosa MFCC + cosine_sim
│   ├── derivatives.py  filename version inference
│   ├── lyrics.py       [Section]-bracket parser; parse_lyrics_text() for strings
│   ├── render.py       ffmpeg slideshow MP4 export
│   ├── config.py       paths + .env / secrets/ resolution
│   └── ai/             tool registry, queue, claude/deepseek/gemini/pollinations/hf/grok
├── frontend/
│   ├── index.html      shell + templates; sort dir button, size slider min=40
│   ├── css/app.css
│   └── js/
│       ├── main.js
│       ├── api.js      songs() accepts dir=asc|desc param
│       ├── util.js     fmtAccount strips sunosync_ prefix
│       ├── views/home.js   dir state + toggle btn; cards show suno_play_count/upvote
│       └── views/watch.js, assets.js, tabs/...
├── data/myspot.db      SQLite WAL (gitignored)
├── start.bat           git checkout dev then launch
└── make_shortcut.ps1   recreates Desktop .lnk shortcuts
```

---

## SQLite schema (v3)

`songs` table key columns:
- `suno_id` — Suno UUID (match key to suno_meta.db)
- `mfcc` — JSON float[20], nullable (MFCC fingerprint)
- `suno_play_count`, `suno_upvote_count`, `suno_is_liked` — from Suno API
- `suno_model`, `suno_style`, `suno_video_url` — from Suno API

Migration runs automatically on startup (v2→v3 adds the 6 suno_* columns).

---

## Key API endpoints

```
GET  /api/songs?sort=recent|title|version|popular|liked|gens|recent_played&dir=asc|desc
GET  /api/songs/{id}           → full detail incl suno_* fields
GET  /api/songs/{id}/related   → MFCC cosine similarity rank
POST /api/reindex              → async full reindex (populates suno_* from suno_meta.db)
GET  /api/reindex/status
POST /api/fingerprint-all      → background MFCC computation
GET  /api/top-songs?by=popular|liked|gens|recent_played&limit&account
GET  /api/channels
GET  /api/stats
POST /api/songs/{id}/like
POST /api/songs/{id}/play
GET  /api/songs/{id}/plays
POST /api/songs/{id}/export
POST /api/songs/{id}/gens/generate
POST /api/extension/current-song-set
GET  /api/extension/current-song
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

---

## Pending / known issues

- [ ] Push `dev` branch to origin (not done yet)
- [ ] Channel display name aliases (e.g. sunosync_elludesign → "Ellu Design") — not implemented; fmtAccount strips prefix only
- [ ] suno_nightly cookie auth setup (see BLOCKER above)
- [ ] Reindex is full not incremental (~several minutes for 8600 songs)
- [ ] First fingerprint run ~10 min for full library
- [ ] `pip install librosa` required for MFCC (not auto-installed)
- [ ] Lyrics timestamps are progress-based not real
