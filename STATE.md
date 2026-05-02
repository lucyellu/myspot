# myspot — Current State

> Self-contained snapshot for cold pickup. Read this file before touching any code.

## Pick up here

**Repo:** https://github.com/lucyellu/myspot  
**Active branch: `dev`** (pushed to origin; merged to main 2026-05-01)  
**Local:** `C:\Users\lucyl\Desktop\myspot\`  
**Netlify:** https://myspot-web.netlify.app — static frontend only; backend via Cloudflare tunnel.

### Start the app
```
double-click Desktop\myspot.lnk   → launches dev branch at http://127.0.0.1:7777
Ctrl+Shift+R                       → hard-refresh browser after code changes
```

---

## What's in dev/main (2026-05-01)

### 1. suno_nightly metadata integration (schema v3)
- `backend/sunometa_db.py` reads `C:\Users\lucyl\Desktop\suno_nightly\suno_meta.db`
- Schema v3 adds 6 columns to songs: `suno_play_count`, `suno_upvote_count`, `suno_is_liked`, `suno_model`, `suno_style`, `suno_video_url`
- DB auto-migrates to v3 on startup

### 2. suno_id matching — 3 fallback strategies
In `backend/library.py` during reindex, each song tries in order:
1. `library_cache.json` lookup by mp3 basename (old SunoSync files)
2. `suno_meta.db` lookup by `local_mp3` path (suno_nightly downloads)
3. `suno_meta.db` lookup by `__xxxxxxxx` 8-char UUID prefix in filename

`SunoMetaDB` indexes: `_cache` (by full UUID), `_by_local_path` (keeps highest play_count on collision), `_by_prefix` (8-char prefix).

**Coverage after reindex:** ~4553/6917 = 66%. Remaining 34% have no suno_meta.db record.

### 3. Channel consolidation
`canonical_account(name)` in `app.py`:
- Strips `sunosync_` prefix
- Strips date suffixes like `_2026_April_17`
- `sunosync_primenotation_2026_April_17` → `primenotation`

`/api/channels` groups by canonical name.  
`/api/songs?account=primenotation` expands via `_expand_account()` to all matching raw folders.

### 4. Color dot system (cards + sidebar)
- `channelColor(rawAccount)` in `util.js`: deterministic hash → 10-color palette
- Cards show colored dot + play/like counts (no channel name text, no lyric count)
- `fmtAccount()` now strips date suffixes too
- Sidebar channel list shows matching dots

### 5. Bug fixes
- `library.py`: fixed `rows` variable bug (previous song's lyrics bleeding into lyric-less song)
- `home.js`: fixed `card-dot` span wiped by `textContent`; use `append(textNode)` instead
- Null guard on dot for cached-template safety

---

## Architecture

```
myspot/
├── backend/
│   ├── app.py          ~55 endpoints; canonical_account(), _expand_account()
│   ├── db.py           SCHEMA_VERSION=3
│   ├── library.py      full reindex; 3-fallback suno_id matching
│   ├── sunometa_db.py  reads suno_meta.db (_cache, _by_local_path, _by_prefix)
│   ├── sunosync_cache.py  reads library_cache.json (by basename)
│   ├── fingerprint.py  librosa MFCC + cosine_sim
│   ├── derivatives.py  filename version inference
│   ├── lyrics.py       [Section]-bracket parser
│   ├── render.py       ffmpeg slideshow export
│   ├── config.py       paths, .env/secrets resolution
│   └── ai/             tool registry, Claude/DeepSeek/Gemini/Pollinations/HF
├── frontend/
│   ├── index.html      shell; tpl-card has .card-dot span
│   ├── css/app.css     .card-dot, .channel-dot styles
│   └── js/
│       ├── main.js     sidebar with color dots; imports channelColor
│       ├── api.js      songs() accepts dir=asc|desc
│       ├── util.js     fmtAccount() strips date suffix; channelColor()
│       └── views/home.js  card() with dot + text node append
├── data/myspot.db      SQLite WAL (gitignored)
└── start.bat           git checkout dev then launch
```

---

## SQLite schema v3 — songs key columns

| column | source |
|---|---|
| `suno_id` | UUID from cache / path / prefix fallback |
| `suno_play_count` | from suno_meta.db |
| `suno_upvote_count` | from suno_meta.db |
| `suno_is_liked` | from suno_meta.db |
| `suno_model`, `suno_style`, `suno_video_url` | from suno_meta.db |
| `mfcc` | JSON float[20], MFCC fingerprint |

---

## Key API endpoints

```
GET  /api/songs?sort=recent|popular|liked|gens|recent_played|title|version&dir=asc|desc&account=<canonical>
GET  /api/channels             → canonical names, consolidated counts
GET  /api/songs/{id}           → full detail incl suno_* fields
POST /api/reindex              → async full reindex (~several min for 6917 songs)
GET  /api/top-songs?by=popular|liked|gens|recent_played&account=<canonical>
```

---

## Pending / known issues

- [ ] Run ↻ reindex to populate play counts for ~4553 songs (currently ~782 in DB)
- [ ] Run `suno_nightly.py --meta-only` after refreshing all 6 tokens for latest counts
- [ ] Set up `__client` cookies in suno_nightly/accounts.json for auto-refresh
- [ ] Register nightly scheduler (setup_scheduler.ps1 as admin)
- [ ] Re-index is full not incremental
- [ ] Lyrics timestamps are progress-based not real
- [ ] `pip install librosa` required for MFCC fingerprinting
