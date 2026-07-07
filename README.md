# myspot

**[Try it live →](https://myspot-web.netlify.app/)**

Personal YouTube-style player for your Suno music library, with a six-tab AI sidepanel, **free unlimited image generation via Pollinations FLUX**, prompt enhancement (Gemini / Groq / Cerebras / DeepSeek / Claude), free image-to-prompt vision (Gemini), live drag-drop visual track that plays in sequence with the song, image-to-video animation (HF LTX-Video automated + Kling manual), and one-click music-video MP4 export.

> **For developers picking up the project:** read [STATE.md](./STATE.md) for current architecture + endpoints, [PLAN.md](./PLAN.md) for the roadmap, [MODELS.md](./MODELS.md) for the full AI service landscape, [DESIGN-BRIEF.md](./DESIGN-BRIEF.md) for the in-flight frontend redesign, [CONCERT.md](./CONCERT.md) for the multiplayer concert vision.

What ships in this build:

- **M1**: library indexer + YouTube-style player + Lyrics tab (synced highlight) + Sources tab + Notes + Prompt vault + asset folder browser + lyrics full-text search + keyboard shortcuts.
- **M3**: Claude prompt enhancer + Gemini Nano Banana + Grok Imagine + background queue + batch mode (drop the matching key into `secrets/` and they light up).
- **M5a**: ffmpeg slideshow MP4 export (`POST /api/songs/:id/export`).

Not yet built: M4 Chrome extension for Meta AI, M5b real timeline editor, Veo video generation.

## Setup

```bash
cd C:/Users/lucyl/Desktop/myspot
pip install -r requirements.txt

python -m backend.library    # one-shot full reindex (~110 sec for 5,700+ tracks)
python -m backend.app        # serves http://127.0.0.1:7777/

# Convenience:
start.bat                    # opens the main app and also prints the phone/LAN URL
start.bat "#/radio"          # same app, opens the AI Radio route
reindex.bat                  # same as python -m backend.library
```

Open http://127.0.0.1:7777/ — you should see your channels in the left drawer and a grid of recent tracks. Click any track to open the watch page. The regular launcher binds to `0.0.0.0`, so the same server also works from a phone on the same network using the LAN URL printed in the launch window.

## Verify it's running

```bash
curl http://127.0.0.1:7777/api/stats
# {"songs":5720,"lyric_lines":109928,"relationships":2651,"assets":1020, ... }

curl http://127.0.0.1:7777/api/health
# {"tools":{...},"ffmpeg":true,"queue_running":true}

# Run the smoke tests
cd C:/Users/lucyl/Desktop/myspot
python -m tests.test_smoke
# Expected: PASSED: 37, FAILED: 0
```

## API keys

The recommended path is to copy `.env.example` → `.env` (gitignored) and paste your keys. Resolution order: process env var → `secrets/<NAME>.txt` → `.env`. After editing, click "Reload .env" in the Generate tab or restart the server.

### Pricing reality (verified April 2026)

| Step | Tool | Key | Cost | Free tier |
| --- | --- | --- | --- | --- |
| Prompt enhance | Gemini 2.5 Flash | `GEMINI_API_KEY` | ~$0.0008 / call | **250 calls / day free** |
| Prompt enhance | Groq Llama 3.3 70B | `GROQ_API_KEY` | provider pricing/free tier varies | account-dependent |
| Prompt enhance | Cerebras GPT OSS 120B | `CEREBRAS_API_KEY` | provider pricing/free tier varies | account-dependent |
| **Prompt enhance** | **DeepSeek V3** | `DEEPSEEK_API_KEY` | ~$0.0005 / call | none — but $5 buys ~10,000 calls |
| Prompt enhance | Claude Sonnet 4.6 | `ANTHROPIC_API_KEY` | ~$0.005 / call | none |
| **Image inspire** | Gemini 2.5 Flash (vision) | `GEMINI_API_KEY` | free or ~$0.001 / call | yes, with auto-fallback to flash-lite/2.0-flash on capacity |
| **Image gen** | **Nano Banana** | `GEMINI_API_KEY` | ~$0.04 / image | **gone for new projects** — billing required |
| Image gen | Grok Imagine | `XAI_API_KEY` | $0.02 / image | gone (removed March 2026) |
| Image gen | Veo (video) | `GEMINI_API_KEY` | paid only | none — deferred in myspot |

**Bottom line:** for a typical "make a music video" cycle (one prompt enhance + one inspire from photo + four image gens to pick from), expect roughly **$0.16** per song using DeepSeek + Nano Banana. Gemini text on the free tier handles 250 enhance calls/day for $0 if you'd rather burn quota than dollars.

### Recommended defaults (current dropdown order)

| Step | Default in UI | Reason |
| --- | --- | --- |
| Prompt enhance | **Gemini 2.5 Flash** (free 250/day) → Groq/Cerebras fast fallback → DeepSeek paid fallback | Free covers most days; fast hosted fallbacks light up when keys are present. |
| Image inspire | Gemini Vision | Free 250/day per model; auto-falls-through to flash-lite/2.0-flash on 503/429. |
| Image gen | **Pollinations FLUX-Realism** (FREE unlimited) | No key, no quota, FLUX.dev-Realism quality. |
| Image-to-video (auto) | HF LTX-Video | ~3-60/mo free with `HF_TOKEN`. |
| Image-to-video (manual) | Kling web | 6/day free; click `K` on any clip — image downloads + Kling opens. |
| One-tap full pipeline | **🚀 Auto** button | Backend picks cheapest-free for each step. Gemini-text → Pollinations × N. Total cost: $0. |

### Where to get the keys

| Tool | Portal |
| --- | --- |
| Anthropic Claude | https://console.anthropic.com/settings/keys |
| DeepSeek | https://platform.deepseek.com/api_keys → top up at /usage/balance |
| Groq | https://console.groq.com/keys |
| Cerebras | https://cloud.cerebras.ai/ |
| Google Gemini (text + vision + image) | https://aistudio.google.com/apikey → click project → "Set up billing" if you want image gen |
| xAI Grok | https://console.x.ai/ → "API Keys" |

The `.env` file is gitignored. **Never share or commit it.**

## Recent additions worth knowing about

- **🚀 Auto pipeline** — top of the Generate tab. One click: enhance prompt via free Gemini → generate 4 free Pollinations images. Step trace returned.
- **Track strip below player** — auto-advances visuals during playback synced to song duration. Drop any image/video onto the player canvas to add it to the track.
- **Bottom media tray** — collapsible folder browser. Pick `Gens` to see every AI gen ever made, or any asset folder. Click thumbnail = attach to current song.
- **Animate ▶+** button on each track-strip clip — image-to-video via HF LTX-Video (needs `HF_TOKEN`). Hover the clip to see it.
- **Kling K** button on each clip — downloads the image and opens kling.ai in a new tab; paste the resulting MP4 onto the player canvas to attach. 6 free clips/day on web.
- **Sidebar wired to tray** — clicking a folder in the left drawer while on a song page updates the bottom tray instead of navigating.
- **Prompt vault** — categories, search, use-count tracking, Duplicate button.

## Keyboard shortcuts

Press <kbd>?</kbd> on the watch page for the full overlay.

| Key | Action |
| --- | --- |
| <kbd>Space</kbd> / <kbd>K</kbd> | Play / pause |
| <kbd>J</kbd> / <kbd>L</kbd> | Seek −10s / +10s |
| <kbd>M</kbd> | Mute |
| <kbd>N</kbd> | Next song (top of "Up next") |
| <kbd>P</kbd> | Previous (parent / source) |
| <kbd>1</kbd>–<kbd>6</kbd> | Switch sidepanel tab |
| <kbd>/</kbd> | Focus search |
| <kbd>?</kbd> | Toggle help overlay |
| <kbd>Esc</kbd> | Close help |

## Search

The top-bar search box (or <kbd>/</kbd>) hits **title + base_title + genre + lyrics_fts** in one query. So `underneath` finds songs that say "Underneath the violet sky" anywhere in the lyrics, even if no title matches. Multi-word queries are OR'd; the last term gets an automatic prefix wildcard.

## Browse personal assets

`myspot/assets/<folder>/<file>` is your drop zone. Each first-level subfolder becomes a "folder tag" in the asset browser sidebar. Click any folder to see a grid; click any asset to attach it directly to a song (you'll be prompted for a song title or ID). Attaching an asset creates a `gen` row pointing at the existing file — no duplicate copy.

## Tech stack

- Python 3.11 + FastAPI + SQLite (WAL + FTS5) + mutagen + Pillow + ImageHash + httpx + anthropic + google-genai.
- Vanilla HTML + ES modules + plain CSS (no build step). Solid via `esm.sh` planned for M5b's timeline editor.
- ffmpeg + ffprobe on PATH for export.

## Project layout

```
myspot/
  backend/
    app.py              # FastAPI routes, AI dispatch, media serving
    library.py          # suno_library/ + assets/ indexer (+FTS backfill)
    sunosync_cache.py   # library_cache.json by-basename lookup
    db.py               # SQLite schema (v1) + WAL connection + FTS5 table
    derivatives.py      # filename version inference
    lyrics.py           # [Section]-bracket parser
    config.py           # paths, HOST:PORT, secrets reader
    render.py           # ffmpeg slideshow MP4 exporter
    ai/
      __init__.py       # tool registry + dispatch (generate_image, enhance_prompt)
      claude.py         # prompt enhancer (claude-sonnet-4-6)
      groq.py           # prompt enhancer via Groq OpenAI-compatible chat
      cerebras.py       # prompt enhancer via Cerebras OpenAI-compatible chat
      deepseek.py       # prompt enhancer via OpenAI-compatible (deepseek-chat V3)
      gemini.py         # Nano Banana image gen + Gemini text enhance (2.5-flash)
      inspire.py        # image-to-prompt via Gemini vision (with model fallback)
      grok.py           # Grok Imagine via httpx (grok-2-image)
      queue.py          # background JobQueue (single thread)
  frontend/
    index.html          # shell + <template>s + help overlay
    css/app.css
    js/
      main.js           # hash router + bootstrap + help binding
      api.js, util.js, sidepanel.js
      views/{home,watch,assets}.js
      tabs/{generate,lyrics,sources,prompts,queue,notes}.js
  data/
    myspot.db           # SQLite (incl. FTS5 lyric_fts)
    gens/song{N}_*.{png,jpg,mp4}
    exports/song_{N}.mp4
  assets/<folder>/*     # personal images/videos drop folder
  secrets/              # API keys, gitignored
  tests/test_smoke.py   # 37 assertions covering parsers, cache, indexer, FTS
  start.bat / reindex.bat / requirements.txt
```

## Endpoints

```
# Catalog
GET  /api/stats
GET  /api/channels
GET  /api/songs?account&q&limit&offset&sort=recent|title|version
GET  /api/songs/{id}                 # full detail
GET  /api/songs/{id}/related         # "Up next"
PUT  /api/songs/{id}/notes           # body: {body}
GET  /api/asset_folders
GET  /api/assets?folder&kind&limit&offset
POST /api/reindex                    # background thread
GET  /api/reindex/status

# Prompts vault
GET  /api/prompts
POST /api/prompts                    # body: {name, template, default_vars?}
DEL  /api/prompts/{id}

# Generation
GET  /api/health                     # which tools are available + key source
POST /api/reload-env                 # re-read .env without restart
POST /api/songs/{id}/enhance-prompt  # body: {model: deepseek|gemini-text|claude, seed?, image_prompt?}
POST /api/songs/{id}/inspire/upload  # multipart image → Gemini Vision describes it
POST /api/songs/{id}/inspire/url     # body: {url, seed?} → fetch + describe
POST /api/inspire/asset/{asset_id}   # use a myspot/assets/ image as inspiration source
POST /api/songs/{id}/gens/upload     # multipart manual file upload
POST /api/songs/{id}/gens/generate   # body: {tool, prompt?} — sync gen
POST /api/songs/{id}/gens/enqueue    # body: {tool} — async via queue
POST /api/songs/{id}/gens/from_asset/{asset_id}   # attach asset as gen (no copy)
POST /api/batch                      # body: {tool, account?, limit?} — batch fill
GET  /api/songs/{id}/gens
DEL  /api/gens/{id}

# Queue
GET  /api/jobs?status&limit
DEL  /api/jobs                       # clear completed/failed

# Export
POST /api/songs/{id}/export          # ffmpeg slideshow → MP4
GET  /media/export/{song_id}         # download

# Media (Range supported on audio)
GET  /media/audio/{song_id}
GET  /media/cover/{song_id}
GET  /media/asset/{asset_id}
GET  /media/gen/{gen_id}
GET  /api/events                     # SSE keepalive
```

## How background gen works

1. Click **Queue** in the Generate tab, or open the **Queue** tab and use **Enqueue batch** for many songs at once.
2. The `jobs` table receives a row with `status='pending'`. A `gens` row is also created with `status='pending'`.
3. The `JobQueue` thread (started on app launch) picks up pending jobs one-at-a-time, builds a default prompt from title/genre/lyrics/Suno-prompt, calls the tool, and writes either `completed` (with `file_path`) or `failed` (with `error`).
4. The Queue tab polls `/api/jobs` every 3s and shows status pills. Completed gens appear in the Generate tab and become candidates for export.

The single-threaded design is intentional — most free tiers (Nano Banana ~500/day) don't reward parallelism, and serial keeps cost predictable on Grok.

## Design decisions

1. **Filename inference is the only derivative signal.** SunoSync's `library_cache.json` turned out to have a flat schema (no `type`/`persona_id`/`concat` fields) — so version chains come from `\bv(\d+)\b` in the filename, kind comes from `cover|mashup|remix` substrings. The cache still gives us rich `prompt`/`genre`/`bpm`/`suno_id` per track when a basename matches (782 of 5720 today).
2. **No filesystem watching.** Manual `↻` button (top-right) re-runs the full indexer (~110 sec).
3. **No Playwright.** Real APIs everywhere; Chrome extension reserved for Meta AI in M4.
4. **Vanilla ES modules.** No build step.
5. **Single drop folder for personal media.** `myspot/assets/` only — first subfolder name becomes the asset's "folder" tag.
6. **Queue is single-threaded by design.** Predictable cost/budget; backs off 1.5s when idle.
7. **Slideshow renders to 1280×720 H.264** with letterboxed images and uniform per-image duration. The full music-video editor (M5b) replaces this.
8. **FTS5 for lyrics, LIKE for everything else.** FTS5 is overkill for short title/genre fields; LIKE is fine. The two are OR'd in one query so search-by-line-of-lyrics works.

## Known caveats

- Lyrics highlight is progress-based (linear distribution across track length). Real timestamp sync needs forced-alignment (Whisper or aubio) — deferred.
- Re-index is full, not incremental.
- "Sources" tab only knows what filenames suggest; songs that don't share a `vN` suffix won't link.
- The on-page player visual updates after a successful generate or upload via `refreshPlayerVisual`. If you tinker via the API directly, reload the song to see updates.
- Pillow gets juggled between 11/12 by other packages on the user's box (`rembg` / `moviepy`); myspot pins `>=11,<13` to coexist. Re-running pip occasionally is normal.
- The `.gitkeep` file in `data/gens/` will be picked up by the indexer if you symlink things weirdly. It's a 0-byte file, ignored.

## Roadmap

- **M4** — `extension/` Chrome companion for Meta AI (port SunoSync's auth-relay pattern at `C:/Users/lucyl/Desktop/hold/sunosync/SunoSync/chrome_extension/`). Content script types prompts into the Meta AI tab and posts results back to `POST /api/songs/{id}/gens/upload`.
- **M5b** — Solid via `esm.sh` timeline editor with transitions, beat detection (aubio), per-section visual assignment, drag personal photos/videos from the asset browser onto the timeline.
- Veo and Nano Banana Pro: revisit when API access opens up or you're willing to pay.

## Tests

```bash
cd C:/Users/lucyl/Desktop/myspot
python -m tests.test_smoke
```

Covers: lyrics parser, derivative inference (incl. cross-account no-leak), cache lookup with mtime tie-break, end-to-end indexer round-trip on a synthetic library, FTS5 population.
