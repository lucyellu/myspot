# myspot — Current State (snapshot)

> Self-contained snapshot for cold pickup. Read this + PLAN.md + DESIGN-BRIEF.md to continue working in a fresh session.

## 🎯 PICK UP HERE

**Current focus:** Frontend redesign in flight via Claude (the design tool).
- The user fed [DESIGN-BRIEF.md](./DESIGN-BRIEF.md) to Claude design.
- Claude's questions answered (see "Redesign decisions" at bottom of DESIGN-BRIEF.md): **lime primary**, drop family tree (keep as AI-sheet tab), Auto = one-tap with toast progress, search = full-screen sheet, drop anywhere on visual.
- Awaiting Claude's file output. When it lands:
  1. `cp -r frontend frontend.bak` (or `mv frontend frontend.bak`)
  2. Paste new files into `frontend/`
  3. Hard-refresh browser at `http://127.0.0.1:7777/`
  4. Walk the 14-point validation checklist at the bottom of DESIGN-BRIEF.md
  5. Run `python -m tests.test_smoke` (backend-only, should stay 37/37)

**Backend is stable.** No backend work pending. Server runs at `http://127.0.0.1:7777/`. Desktop shortcut `myspot.lnk` launches it.

**Funded API balances:** DeepSeek $5, Google AI Studio $25. Pollinations FLUX (free unlimited) is the default image tool — costs nothing.

---

## What runs

```bash
cd C:/Users/lucyl/Desktop/myspot
python -m backend.library    # full reindex (~110s) — only if disk content changed
python -m backend.app        # serves localhost:7777
# or double-click Desktop\myspot.lnk
```

`start.bat` auto-opens the browser. `reindex.bat` runs the indexer one-shot.

## Library state (last indexed)

- **5,720 songs** across 6 Suno accounts (`suno_library/sunosync_*/`)
- **109,928 lyric lines** parsed and FTS5-searchable
- **2,651 derivative relationships** (filename version inference)
- **1,020 personal assets** indexed from `myspot/assets/<folder>/`
- **45+ generations** in `data/gens/` (mix of Pollinations FLUX, Nano Banana, manual uploads)
- **782 / 5,720** songs have rich Suno metadata (basename match in SunoSync's `library_cache.json`)

## Architecture

```
myspot/
├── backend/                       Python 3.11 + FastAPI + SQLite (WAL+FTS5)
│   ├── app.py                     ~50 endpoints, SSE stub, startup queue
│   ├── library.py                 indexer (full reindex, no incremental yet)
│   ├── sunosync_cache.py          library_cache.json reader (by basename)
│   ├── db.py                      schema_version=1 + 14 tables + lyric_fts
│   ├── derivatives.py             filename version inference
│   ├── lyrics.py                  [Section]-bracket parser
│   ├── render.py                  ffmpeg slideshow MP4 export
│   ├── config.py                  paths + .env / secrets/ resolution
│   └── ai/
│       ├── __init__.py            tool registry + auto_*_tool() pickers
│       ├── claude.py              prompt enhance via anthropic SDK
│       ├── deepseek.py            prompt enhance via OpenAI-compatible HTTP
│       ├── gemini.py              Nano Banana image + 2.5-flash text enhance
│       ├── grok.py                Grok Imagine via xAI HTTP (paid)
│       ├── pollinations.py        FREE FLUX image gen — no key, default
│       ├── huggingface.py         FLUX-schnell + LTX-Video / CogVideoX / Mochi / Wan
│       ├── inspire.py             Gemini Vision image-to-prompt + auto-fallback
│       └── queue.py               background single-thread JobQueue
├── frontend/                      Vanilla HTML + ES modules + plain CSS
│   ├── index.html                 shell with templates + help overlay + media tray
│   ├── icon.ico                   favicon
│   ├── css/app.css                ~870 lines, dark theme
│   └── js/
│       ├── main.js                hash router + drawer + search + help
│       ├── api.js, util.js, sidepanel.js
│       ├── views/{home,watch,assets}.js
│       └── tabs/{generate,lyrics,sources,prompts,queue,notes}.js
├── data/
│   ├── myspot.db                  SQLite — every gen, lyric, note, job
│   ├── gens/                      AI gens + manual uploads (song{id}_{ms}_{tool}.{ext})
│   └── exports/                   slideshow MP4s (song_{id}.mp4)
├── assets/<folder>/*              personal media drop folder (read-only index)
├── secrets/                       per-key files (gitignored)
├── .env                           single-file key store (gitignored)
├── tests/test_smoke.py            37 assertions, all passing
├── start.bat / reindex.bat        Windows launchers
├── icon.ico / icon_preview.png
├── make_shortcut.ps1              re-creates Desktop/myspot.lnk
└── *.md                           README, PLAN, STATE, MODELS, CONCERT, DESIGN-BRIEF
```

## SQLite schema (v1)

| Table | Purpose | Key cols |
| --- | --- | --- |
| `meta` | schema_version | key, value |
| `songs` | every Suno track | suno_id, base_title, version, account, genre, bpm, prompt, **liked** |
| `lyric_lines` | parsed lyric rows | song_id, idx, text, section |
| `lyric_fts` | FTS5 over lyrics | text, song_id (UNINDEXED) |
| `relationships` | derivative chain | parent_id, child_id, kind ∈ version\|cover\|remix\|mashup |
| `assets` | personal media | kind, file_path, folder, width/height/phash |
| `gens` | AI/manual visuals | song_id, kind, tool, prompt, file_path, status, parent_gen_id |
| `prompts` | template vault | name, **category**, template, **use_count**, **last_used_at** |
| `jobs` | queue rows | song_id, gen_id, tool, status, started/finished_at |
| `notes` | per-song notes | song_id (PK), body, updated_at |
| `tags` | (currently unused) | song_id ↔ tag |
| `playlists`, `playlist_songs` | (unused) | |
| `play_history` | playback log (now populated via POST /api/songs/{id}/play) | |
| `edits`, `clips` | M5b timeline editor (schema only) | |

**Recently added columns** on `prompts`: `category`, `use_count`, `last_used_at` + index `idx_prompts_category`. Already migrated on disk.

## Wired AI tools (April 2026)

| Tool | Kind | Free? | Status | Key var |
| --- | --- | --- | --- | --- |
| **Pollinations FLUX.dev / Realism / Anime / Turbo** | image | ✅ FREE unlimited | live, **default** | none |
| **Gemini 2.5 Flash** | text | 250/day free | live | `GEMINI_API_KEY` |
| **DeepSeek V3** | text | none ($5 funded) | live | `DEEPSEEK_API_KEY` |
| Claude Sonnet 4.6 | text | none | wired, no key | `ANTHROPIC_API_KEY` |
| **Nano Banana** | image | none ($25 funded) | live | `GEMINI_API_KEY` |
| Gemini Vision (inspire) | vision | 250/day free + auto-fallback | live | `GEMINI_API_KEY` |
| HF FLUX-schnell | image | ~30/mo free | wired, no key | `HF_TOKEN` |
| HF LTX-Video / CogVideoX / Mochi / Wan2.2 | video (I2V) | ~3-60/mo free | wired, no key | `HF_TOKEN` |
| Grok Imagine | image | none | wired, no key | `XAI_API_KEY` |
| Meta AI Imagine | image | extension only | ⏳ M4 deferred | n/a |
| Veo 3.1 | video | none | not wired (paid only) | n/a |
| Kling | video | 6/day on web | ✅ manual handoff button | n/a |

**Defaults in the UI:** image tool → `pollinations-realism`, prompt model → `gemini-text`. Both are free.

## Endpoints

```
# Catalog / browse
GET  /api/stats
GET  /api/channels
GET  /api/songs?account&q&limit&offset&sort=recent|title|version
GET  /api/songs/{id}                → full detail (gens, sources, derivatives, lyrics, note)
GET  /api/songs/{id}/related?limit  → "Up next"
PUT  /api/songs/{id}/notes          → body: {body}
GET  /api/asset_folders             → includes synthetic _gens entry
GET  /api/assets?folder&kind&limit&offset
GET  /api/gens_browse?limit&offset  → all completed gens across all songs (powers media tray)

# Gen
GET  /api/health                    → tools + key sources + ffmpeg/queue
POST /api/reload-env                → re-read .env
POST /api/songs/{id}/auto           → 🚀 free pipeline (gemini-text → pollinations-realism × N)
POST /api/songs/{id}/enhance-prompt → body: {model, seed?, image_prompt?}
POST /api/songs/{id}/inspire/upload  multipart → Gemini Vision describes
POST /api/songs/{id}/inspire/url    → body: {url, seed?}
POST /api/inspire/asset/{asset_id}  → use a tray asset as inspiration source
POST /api/songs/{id}/gens/upload     multipart manual file
POST /api/songs/{id}/gens/generate  → body: {tool, prompt?} sync gen
POST /api/songs/{id}/gens/enqueue   → body: {tool} async via queue
POST /api/songs/{id}/gens/from_asset/{asset_id}  → no-copy attach
POST /api/gens/{id}/animate         → I2V via HF (LTX/CogVideoX/Mochi/Wan)
GET  /api/songs/{id}/gens
DEL  /api/gens/{id}

# Prompts
GET  /api/prompts?q&category        → search/filter
GET  /api/prompts/categories
POST /api/prompts                   → body: {name, category?, template, default_vars?}
POST /api/prompts/{id}/used         → bump use_count + last_used_at
DEL  /api/prompts/{id}

# Queue + maintenance
GET  /api/jobs?status&limit
DEL  /api/jobs                      → clear completed/failed
POST /api/batch                     → enqueue N for cheapest available tool
POST /api/reindex                   → background full reindex
GET  /api/reindex/status

# Export
POST /api/songs/{id}/export         → ffmpeg slideshow → MP4
GET  /media/export/{song_id}        → MP4 download

# Media (Range supported on audio)
GET  /media/audio/{song_id}
GET  /media/cover/{song_id}, /media/asset/{id}, /media/gen/{id}
```

## Funded balances

- DeepSeek: $5 (≈ 10,000 prompt enhance calls)
- Google AI Studio: $25 (≈ 600 Nano Banana images, plus free Gemini text + vision under daily caps)
- Pollinations: free unlimited (no key, no balance to track)

## Known caveats / open issues

- **Suno covers are 40×40** (SunoSync downloaded thumbnails). Player shows them at full-card size with `object-fit: cover` — looks fine but not pixel-perfect.
- **FLUX in 16:9 distorts full-body figures** — defaults switched to 1024×1024 (Pollinations actually serves 768×768).
- **Re-index is full, not incremental.** Manual `↻` button or `python -m backend.library`. ~110s for current library.
- **Lyrics highlight is progress-based**, not real timestamps.
- **Slideshow render is hard-cut between clips.** Crossfade pending.
- **No drag-to-reorder on the track strip** yet — order is insertion (id).
- **HF API has tight free tier** — first call may 503 on cold-start; retry after ~30s.
- **Pollinations occasionally times out** at the 180s mark on heavy prompts — usually retry succeeds.

## Sortability (new)

`GET /api/songs?sort=` accepts: `recent | title | version | popular | liked | gens | recent_played`. Each song detail now includes `liked`, `play_count`, `gens_count`, `last_played_at`.

```
POST /api/songs/{id}/like                  toggle liked (returns {liked: bool})
POST /api/songs/{id}/play  body:{ms_played?}  → insert into play_history
GET  /api/songs/{id}/plays                 → {plays, last, total_ms}
GET  /api/top-songs?by=popular|liked|gens|recent_played&limit&account
                                           → curated top list (excludes never-played for popular)
```

Frontend should call `recordPlay(songId, msPlayed)` from `api.js` whenever the user actually listens to a song, ideally on `audio.pause` or `audio.ended` with the cumulative ms played.

## Chrome extension bridge (new)

`extension/` folder is a working Manifest V3 Chrome extension. Right-click any image on any website → "Send to myspot" → image downloads + (optionally) attaches to whichever song is currently open in myspot.

```
extension/
├── manifest.json       MV3 with permissions for suno.com / meta.ai / grok.com / klingai.com / x.com
├── background.js       service worker — context menu + bridge to localhost:7777
├── content/shared.js   tiny corner pill confirming activation per host
├── popup.html / popup.js   status panel (myspot reachable + current song)
├── icons/icon{16,48,128}.png
└── README.md           install + usage + per-site extension hooks
```

Backend endpoints:
```
POST /api/extension/current-song-set  body:{song_id?}  → frontend sets which song extension targets
GET  /api/extension/current-song                       → extension reads the target
POST /api/extension/import-image  body:{url, source_url?, attach_to_current?}
                                  → fetches URL, saves to data/gens/, optionally attaches as gen
```

CORS middleware on `/api/extension/*` so MV3 service worker can call `localhost:7777` from any origin.

**Install:** `chrome://extensions/` → Developer mode → Load unpacked → pick `extension/`. Pin if you want the popup status.

**Frontend integration (to do when redesign lands):** the new frontend should call `POST /api/extension/current-song-set` on song-page open and `null` on song-page close. That's the only hook required.

## Recent additions (since last STATE update)

- **Sortability** — `liked` column on songs; new sort modes: popular, liked, gens, recent_played; `GET /api/songs/top` curated lists; `POST /api/songs/{id}/like` and `/play` endpoints
- **Chrome extension bridge** — `extension/` folder, MV3, right-click any image → "Send to myspot." Includes per-site corner pill for visual feedback. New backend endpoints under `/api/extension/`.
- **Pollinations 4 variants** (FLUX.dev, Realism, Anime, Turbo) — all free unlimited
- **🚀 Auto pipeline** — `POST /api/songs/{id}/auto` chooses cheapest available text + image tools and runs the full enhance + N-generate cycle
- **`auto_*_tool()` pickers** in `backend/ai/__init__.py` — fallback cascade per kind (text/image/vision/video)
- **HuggingFace integration** — FLUX-schnell text-to-image + LTX-Video / CogVideoX / Mochi / Wan2.2 image-to-video
- **`POST /api/gens/{id}/animate`** + ▶+ button on each track-strip clip
- **Kling handoff** — `K` button on each clip downloads image and opens kling.ai in new tab
- **Bottom media tray** — collapsible folder browser below track strip, click thumbnail to attach
- **`GET /api/gens_browse`** — paginated list of all completed gens (for the tray)
- **Sidebar wired to tray** — clicking an asset folder while on watch view updates the tray instead of navigating
- **`_gens` synthetic asset folder** — exposes `data/gens/` in the asset list with count
- **Defaults switched** — `pollinations-realism` is the default image tool; `gemini-text` is the default prompt model
- **Player image fit** — `object-fit: cover` (was contain) so square images fill the player area
- **Pollinations default size** — 1024×1024 (was 1280×720) for FLUX-native sweet spot
- **Prompt vault** — added `category` / `use_count` / `last_used_at` columns; vault tab now has search box, category chips, "× N times used" badge, Duplicate button
- **DESIGN-BRIEF.md** — comprehensive frontend handoff doc for Claude design tool
- **Brand pivot decided** — lime is the new primary color (replacing pink). Awaits Claude design implementation.

## Testing

```bash
cd C:/Users/lucyl/Desktop/myspot
python -m tests.test_smoke
# Expect: PASSED: 37, FAILED: 0
```

Covers: lyrics parser, derivative inference + cross-account no-leak, cache by-basename + mtime tiebreak, end-to-end indexer round-trip on synthetic library, FTS5 population.

No frontend tests — manual validation in browser.

## Quick recipes

```bash
# Full reindex
python -m backend.library

# Inspect db
sqlite3 data/myspot.db "SELECT id, title, version, account FROM songs LIMIT 5"

# Find a song
sqlite3 data/myspot.db "SELECT id, title FROM songs WHERE title LIKE '%Atmos%' LIMIT 5"

# Show all gens for a song
sqlite3 data/myspot.db "SELECT id, kind, tool, status, file_path FROM gens WHERE song_id=27 ORDER BY id"

# Trigger 🚀 auto-pipeline
curl -X POST http://127.0.0.1:7777/api/songs/27/auto \
  -H 'Content-Type: application/json' -d '{"count":4,"animate":false}'

# Browse all gens (for tray)
curl http://127.0.0.1:7777/api/gens_browse?limit=10

# Check what's free + keyed right now
curl http://127.0.0.1:7777/api/health
```

## Files to read for cold pickup (in order)

1. **STATE.md** (this) — where we are right now
2. **PLAN.md** — phased roadmap with status
3. **DESIGN-BRIEF.md** — frontend redesign brief + answered decisions
4. **MODELS.md** — AI service landscape (pricing, free tiers)
5. **README.md** — install + daily usage
6. **CONCERT.md** — multiplayer concert vision (M6, post-redesign)
7. `backend/app.py` — every endpoint in code form
8. `backend/db.py` — full schema
9. `backend/ai/__init__.py` — tool registry + auto-pickers
10. `frontend/js/api.js` — every API call wrapped (Claude redesign keeps this verbatim)
