# myspot — Design Brief for Frontend Redesign

> Self-contained handoff for Claude (or any designer/coder) to redesign the myspot frontend. Everything below is current as of this writing. Backend stays untouched — the redesign just consumes the existing API surface.

---

## TL;DR

- **What it is:** Personal music + visuals platform built on a 5,720-track Suno music library. Single-user, runs on `localhost:7777`.
- **What needs redesign:** The frontend (HTML + CSS + ES modules) under `frontend/`. Make it feel like a Suno-tok / Suno-TikTok hybrid — vertical-feed-first browsing, swipeable, music-video-as-the-default-state.
- **What stays:** Python FastAPI backend, all endpoints listed below, all data shapes.
- **Constraint:** No build step. Vanilla HTML + CSS + ES modules served as static files. Drop the new files into `frontend/` and they're live.
- **Path:** `C:\Users\lucyl\Desktop\myspot\frontend\`

---

## What myspot does (one paragraph)

Plays your 5,720 personal Suno tracks with AI-generated visuals attached to each song. Each track has a "track strip" of attached images/videos that plays in sequence with the audio (CapCut-MVP style). You can drag any image or video onto the player canvas to add it. AI integrations let you (a) enhance prompts via DeepSeek / Gemini / Claude, (b) generate images via free Pollinations FLUX or paid Nano Banana / Grok, (c) describe an existing image as a prompt via Gemini Vision, (d) animate images to short video clips via HF LTX-Video or hand off to Kling for higher quality. Once you're happy, render an MP4 slideshow synced to the song.

## The Suno-TikTok direction (user's brief)

The current UI is YouTube-style (header + drawer + main + sidepanel). The user now wants to lean into a **vertical feed** model:

- Each song is a "post" you swipe through, with the visual track playing fullscreen-ish.
- Audio plays automatically as you land on a song.
- Side actions: heart, comment-equivalent (notes), share/export, AI panel.
- Right-edge persistent rail for the AI sidepanel (collapsible).
- Bottom: track-strip + media-tray peek.
- Top: minimal — channel switcher, search, settings.

Think TikTok feed where each card is a song-with-visuals, but with the AI tooling tucked into a slide-over panel rather than gone entirely. Power-user features (asset browser, prompts vault, queue, lyrics, derivatives) accessed by tapping their respective icon in the right rail.

The user also said the YouTube style felt heavy and confusing. The redesign should:
- Make the primary action obvious (play song with visuals → ✨ generate / pick visuals)
- Hide complexity until asked for
- Default to free tools (Gemini text + Pollinations FLUX-Realism)

---

## Data model (what the redesign needs to render)

### Song
```ts
{
  id: number,
  suno_id?: string,          // UUID from Suno (782/5720 have this)
  title: string,             // e.g. "Atmos 4"
  base_title: string,        // title with " vN" stripped
  version: number,           // 1 = original, 2+ = regen
  artist?: string,           // user's Suno persona name
  account: string,           // e.g. "sunosync_primenotation_2026_April_17"
  genre?: string,            // comma-separated tags, e.g. "melodic, New Wave, dreamy"
  bpm?: number,
  prompt?: string,           // original Suno prompt — can be very long (1-2k chars)
  duration: number,          // seconds, e.g. 262.0
  mp3_path: string,          // server filesystem path
  jpg_path?: string,          // 40x40 cover thumbnail (small!)
  txt_path?: string,
  wav_path?: string,
  mid_path?: string,
  suno_date?: string,         // ISO date string when generated
  has_cache: 0 | 1,           // whether Suno metadata enriched this row
  lyric_count: number,
}
```

### Song detail (GET /api/songs/{id})
Adds:
```ts
{
  ...song,
  lyrics: [{idx: number, text: string, section?: string}],
  derivatives: [{id, title, version, kind, jpg_path}],   // children (v2, v3, etc)
  sources:     [{id, title, version, kind, jpg_path}],   // parents
  gens:        [{id, kind: "image"|"video", tool, prompt, file_path,
                 status: "pending"|"running"|"completed"|"failed", created_at}],
  note: string,
}
```

### Channel (Suno account)
```ts
{ account: string, song_count: number, with_cover: number }
```
There are exactly **6 channels** today.

### Asset folder
```ts
{ folder: string, n: number, synthetic?: boolean }
// "_gens" is the synthetic folder pointing at data/gens/
```

### Asset
```ts
{
  id: number,
  kind: "image" | "video",
  file_path: string,
  folder: string,            // first subdir under myspot/assets/
  width?: number, height?: number, duration?: number,
  phash?: string,            // perceptual hash for dedupe
  indexed_at: string,
}
```

### Generation (a visual attached to a song)
```ts
{
  id: number, song_id: number,
  kind: "image" | "video",
  tool: string,              // "pollinations" | "pollinations-realism" | "nano-banana" | "manual" | "drop" | "asset" | "tray-import" | "hf-ltx-video" | ...
  prompt: string,
  file_path: string | null,
  status: "pending" | "running" | "completed" | "failed",
  parent_gen_id: number | null,  // set when video is animated from an image gen
  created_at: string,
}
```

### Saved prompt (vault)
```ts
{
  id: number,
  name: string,              // unique
  category?: string,          // e.g. "cinematic", "anime", "portrait"
  template: string,           // supports {title} {genre} {bpm} {prompt} {lyrics_excerpt}
  default_vars_json?: string,
  use_count: number,
  last_used_at?: string,
  created_at: string,
}
```

### Tool status (GET /api/health)
```ts
{
  ffmpeg: boolean,
  queue_running: boolean,
  tools: {
    [name: string]: {
      available: boolean,
      kind: "image" | "video" | "prompt" | "vision",
      free?: boolean | "limited",
      source: ".env" | "secrets/" | "env" | null,  // where the key was found
    }
  }
}
```

Today: `pollinations` is free + always available; `gemini-text`, `nano-banana`, `inspire`, `deepseek` are wired with keys; `claude`, `grok`, `hf-flux`, `hf-ltx-video` are wired but unkeyed. The redesign should gracefully disable unavailable tools.

---

## API contract (consume — don't modify)

Base URL: `http://127.0.0.1:7777`. All endpoints return JSON unless noted.

### Catalog / browse
```
GET  /api/stats                          → {songs, lyric_lines, relationships, assets, gens, accounts, with_cache}
GET  /api/channels                       → array of channels
GET  /api/songs?account&q&limit&offset&sort=recent|title|version
                                          → {items, total, limit, offset}  — q hits title/genre + lyric FTS
GET  /api/songs/{id}                     → full song detail (see Data model)
GET  /api/songs/{id}/related?limit=N     → list of songs with reason: "sibling"|"channel"
PUT  /api/songs/{id}/notes  body:{body}  → save note

GET  /api/asset_folders                  → array incl. synthetic "_gens"
GET  /api/assets?folder&kind&limit&offset → {items, total}
GET  /api/gens_browse?limit&offset       → {items, total}  — every completed gen across all songs
```

### Generation
```
GET  /api/health                         → tool availability + key sources
POST /api/reload-env                     → re-read .env without restart

POST /api/songs/{id}/auto                → 🚀 cheapest-free pipeline
       body: {count?: 4, animate?: false, seed?: ""}
       returns: {steps: [...], image_gen_ids: [...], video_gen_id?: number, prompt: string}

POST /api/songs/{id}/enhance-prompt
       body: {model: "gemini-text"|"deepseek"|"claude", seed?: "", image_prompt?: ""}
       returns: {prompt, model_version} | {error}

POST /api/songs/{id}/inspire/upload      multipart file → Gemini Vision describes
       returns: {prompt, model_version}
POST /api/songs/{id}/inspire/url         body: {url, seed?}
POST /api/inspire/asset/{asset_id}       body: {song_id?, seed?}

POST /api/songs/{id}/gens/upload?tool&kind&prompt   multipart manual file
POST /api/songs/{id}/gens/generate                  body: {tool, prompt?} — sync gen
POST /api/songs/{id}/gens/enqueue                   body: {tool} — async via queue
POST /api/songs/{id}/gens/from_asset/{asset_id}     no-copy attach asset
POST /api/gens/{id}/animate                         body: {tool?, prompt?} — image-to-video
GET  /api/songs/{id}/gens                          → list gens for song
DEL  /api/gens/{id}                                 → delete gen

GET  /api/prompts?q&category                       → array of saved prompts
GET  /api/prompts/categories                       → array of {category, n}
POST /api/prompts                                  → body: {name, category?, template}
POST /api/prompts/{id}/used                        → bump use_count
DEL  /api/prompts/{id}

GET  /api/jobs?status&limit                        → background queue
DEL  /api/jobs                                     → clear completed/failed
POST /api/batch                                    → body: {tool, account?, limit?}

POST /api/reindex                                  → background full reindex (~110s)
GET  /api/reindex/status

POST /api/songs/{id}/export                       → ffmpeg slideshow → MP4
```

### Media (binary)
```
GET  /media/audio/{song_id}        audio/mpeg, supports HTTP Range
GET  /media/cover/{song_id}        image/jpeg (40x40 thumbnail!)
GET  /media/asset/{asset_id}       image/* or video/*
GET  /media/gen/{gen_id}           image/* or video/*
GET  /media/export/{song_id}       video/mp4 (rendered slideshow)
```

### Sample responses (paste into mocks)

**`GET /api/health`**
```json
{
  "tools": {
    "pollinations":  {"available": true, "kind": "image", "free": true,        "source": null},
    "hf-flux":       {"available": false, "kind": "image", "free": "limited",  "source": null},
    "hf-ltx-video":  {"available": false, "kind": "video", "free": "limited",  "source": null},
    "claude":        {"available": false, "kind": "prompt", "source": null},
    "deepseek":      {"available": true,  "kind": "prompt", "source": ".env"},
    "gemini-text":   {"available": true,  "kind": "prompt", "source": ".env"},
    "nano-banana":   {"available": true,  "kind": "image",  "source": ".env"},
    "grok":          {"available": false, "kind": "image",  "source": null},
    "inspire":       {"available": true,  "kind": "vision", "source": ".env"}
  },
  "ffmpeg": true,
  "queue_running": true
}
```

**`GET /api/stats`**
```json
{"songs":5720,"lyric_lines":109928,"relationships":2651,"assets":1020,"gens":45,"accounts":6,"with_cache":782}
```

**`GET /api/channels`**
```json
[
  {"account":"sunosync_primenotation_2026_April_17","song_count":1776,"with_cover":1770},
  {"account":"sunosync_elludesign","song_count":1727,"with_cover":1724},
  {"account":"sunosync_lucylucontact_chaimanmeow","song_count":1398,"with_cover":1393},
  {"account":"sunosync_lllucylllu","song_count":566,"with_cover":564},
  {"account":"sunosync_manualthinker","song_count":154,"with_cover":154},
  {"account":"sunosync","song_count":99,"with_cover":99}
]
```

**`GET /api/songs/27/related?limit=3`**
```json
[
  {"id":31,"title":"Atmos 4","version":1,"account":"sunosync","jpg_path":"...","duration":212.0,"reason":"sibling"},
  {"id":25,"title":"Atmos 4","version":2,"account":"sunosync","jpg_path":"...","duration":189.0,"reason":"sibling"},
  {"id":26,"title":"Atmos 4","version":3,"account":"sunosync","jpg_path":"...","duration":273.0,"reason":"sibling"}
]
```

---

## Current frontend inventory (what exists, in case you want to preserve any of it)

```
frontend/
├── index.html          shell + <template>s for views/cards + help overlay
├── icon.ico            32-bit pink music-note
├── css/app.css         ~770 lines, dark theme with custom-property palette
└── js/
    ├── main.js         hash router, drawer, search, help overlay
    ├── api.js          fetch wrappers for every endpoint
    ├── util.js         el(), fmtDuration, toast, debounce, clear
    ├── sidepanel.js    tab switcher with cleanup hooks
    ├── views/
    │   ├── home.js     library grid (paginated, search, sort)
    │   ├── watch.js    YouTube-style player + 6-tab sidepanel + track strip + media tray
    │   └── assets.js   asset browse view (per-folder grid)
    └── tabs/
        ├── generate.js  ✨ Prompt section (model picker, image inspiration, enhance/copy)
        │               🎨 Visual section (tool picker, generate, drop)
        │               🎬 Export section (slideshow MP4)
        ├── lyrics.js    parsed [Section] brackets, progress-synced highlight
        ├── sources.js   parent + derivatives list with thumbnails
        ├── prompts.js   vault: search, categories, save, apply, duplicate
        ├── notes.js     autosave per-song textarea
        └── queue.js     batch fill + 3s polling job list
```

### Routing (hash-based, keep this)
```
#/                             → home / recent
#/channel/{account}            → grid filtered to one Suno account
#/song/{id}                    → watch page (THE main view)
#/search/{q}                   → search results
#/assets/{folder}              → asset folder grid (or _gens for output)
```

### Visual language (current — okay to evolve)
```
--bg:        #0a0a0c   /* near-black */
--bg-elev:   #15151a   /* card / drawer / chips */
--bg-hover:  #1f1f26
--border:    #2a2a33
--text:      #e8e8ec
--text-dim:  #9b9ba5
--text-muted:#6f6f7a
--accent:    #ff5577   /* myspot pink — primary brand */
--accent-2:  #6588ff   /* blue — secondary */
--accent-3:  #00d4aa   /* teal — actions */
--warn:      #ffaa55
--danger:    #ff4466
--radius:    10px
font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif
```

Brand is the music-note-on-pink-circle icon at `frontend/icon.ico`. Name is lowercase **myspot**.

### Existing user flows (must work in the redesign)

1. **Browse + play.** Land on home → see grid of recent or by-channel → click song → opens watch view → audio auto-loads → first attached gen plays. With ≥2 gens, visuals auto-advance synced to playback.

2. **Drop-and-attach.** On any song, drag an image/video file onto the player area or track strip → uploads via `POST /api/songs/{id}/gens/upload` → appears as a new clip in the track strip → cycles into the slideshow.

3. **🚀 Auto-generate.** Click "🚀 Auto" in Generate panel → backend calls `POST /api/songs/{id}/auto` → enhances prompt via Gemini-text (free) → generates 4 Pollinations FLUX-Realism images (free) → all appear on track strip in ~20-30s.

4. **Image inspiration.** Drop an image into the inspiration zone → Gemini Vision describes it → that description gets folded into the next "Enhance prompt" call → resulting prompt aims to recreate the inspiration's aesthetic.

5. **Manual prompt + gen.** Type a prompt (or use Apply from prompt vault) → pick a tool (Pollinations FLUX-Realism is the default) → click Generate → image saves to track.

6. **Animate.** Hover any image clip in the track strip → ▶+ button (HF LTX-Video automated) or `K` button (Kling manual handoff: downloads image + opens kling.ai in new tab).

7. **Search.** Top search box; queries hit title + base_title + genre + lyric content (FTS5). Press `/` to focus.

8. **Export.** Generate → 🎬 Export → backend ffmpeg-renders all completed gens distributed across the song duration → MP4 downloads.

9. **Notes.** Right sidepanel → Notes tab → free text autosaves on debounce.

10. **Prompt vault.** Save reusable templates with `{title}` `{genre}` `{lyrics_excerpt}` `{bpm}` `{prompt}` placeholders. Apply substitutes and copies to clipboard.

### Keyboard shortcuts (preserve these)
```
Space / K   play/pause
J / L       seek -10s / +10s
M           mute
N           next sibling/related
P           previous (parent/source)
1..6        switch sidepanel tab
/           focus search
?           help overlay
Esc         close help
```

---

## Proposed Suno-TikTok redesign (user's direction — interpret loosely)

A swipeable feed where each "card" is a song-with-visuals. Suggested screens:

### Feed (replaces home + watch)
```
┌──────────────────────────────────┐
│ ▾ All channels   [search] ⚙      │ <- minimal top
├──────────────────────────────────┤
│                                  │
│      [fullscreen visual]         │
│      autoplay video sequence     │   ← ♥ (like)
│                                  │   ← 💬 (notes)
│                                  │   ← ✨ (AI panel)
│                                  │   ← ↗  (export/share)
│                                  │
│                                  │
│   "Atmos 4" v4 • sunosync        │
│   melodic · New Wave · dreamy    │
│   ──●──────  1:24 / 4:22         │
│                                  │
├──────────────────────────────────┤
│ [thumb][thumb][thumb][+]   🎬    │ <- track strip
└──────────────────────────────────┘
        ↕ swipe up = next song
```

### Channel switcher (slide-down panel from top)
```
┌──────────────────────────────────┐
│ × Channels                       │
├──────────────────────────────────┤
│ All (5,720)                      │
│ primenotation 2026 (1,776)       │
│ elludesign     (1,727)           │
│ chaimanmeow    (1,398)           │
│ ...                              │
└──────────────────────────────────┘
```

### AI sidepanel (slide in from right when ✨ tapped)
Same six tab content as today but in a sheet rather than a permanent rail:
- Generate (hero ✨ Auto button + advanced)
- Lyrics
- Sources / derivatives
- Prompts vault
- Queue
- Notes

### Asset library (slide-up sheet)
- Folders horizontal chips
- Grid of thumbnails
- Drag any onto the visual to attach
- Includes the `_gens` synthetic folder

### Top-level navigation
- Just three tabs at the top or bottom: **Feed** · **Search** · **Library** (assets + prompts + queue)
- Settings reachable via a gear icon in the corner

### Direction notes
- Default state is "playing" — no big "play" button in the middle of every card
- Visual fills as much of the screen as possible (current letterbox is too restrained)
- AI tools are accessible but never the first thing the user sees
- Free tools (Pollinations + Gemini text) are the obvious defaults; paid ones are tucked away
- Make 🚀 Auto-pipeline the most prominent action when the AI sidepanel opens
- Keep the track strip visible at the bottom — that's the "this song's visual sequence" affordance and core to the editing model
- Music-video-as-the-default: when you swipe to a new song, audio + visual sequence auto-play

---

## Constraints (must respect)

1. **No build step.** Final files must be plain `.html`, `.css`, and ES module `.js` files that work via `<script type="module" src="...">`. No webpack/vite/rollup. CDN imports via `esm.sh` are fine if needed (e.g. for Solid).
2. **Localhost only.** No external font/CSS hosted on third parties unless cached. Fine to use Google Fonts but the user runs offline often — system fonts as primary.
3. **Backend stays.** All endpoints listed above. Don't ask to add new endpoints; if the design needs new data, propose it but expect it'll be added separately.
4. **5,720 songs in the library.** Performance matters: virtualize the feed, lazy-load images, don't re-fetch unnecessarily.
5. **Cover thumbnails are 40×40.** Always letterbox/blur-backdrop or treat as low-fi UI element. The real visuals (gens) can be 768×768 to 1024×1024.
6. **Korean / emoji / unicode in titles.** Render all titles defensively (no `latin-1` paths).
7. **Single-user.** No login UI, no user-switching, no multi-user modeling needed.
8. **Windows file paths in the database.** The frontend doesn't need to display paths; use the `/media/*` proxy URLs.

---

## Files we'd want from the redesign

In rough priority order:

1. `frontend/index.html` — full new shell
2. `frontend/css/app.css` — replacement stylesheet (or split into multiple files if helpful)
3. `frontend/js/main.js` — entry, router, top-level state
4. `frontend/js/api.js` — keep this from current build, it's a thin wrapper over the API and well-tested. Optional: extend it.
5. Page modules: `feed.js`, `library.js`, `search.js` (or whatever the new structure)
6. Component modules for: visual player, track strip, AI panel sheet, asset sheet, prompt vault, notes
7. Optional: tiny utility for loading + auto-pause-other-videos when one becomes active

The backend already serves anything in `frontend/` at `/static/...`, and `index.html` at `/`. So drop replacement files in place and they're live.

---

## Test data to feed your mock

Use these as fixture songs for the design:

| ID | Title | Account | Genre | Has cover | Has gens? |
| --- | --- | --- | --- | --- | --- |
| 27 | Atmos 4 (v4) | sunosync | melodic, New Wave, dreamy | yes (40×40) | yes — multiple Pollinations + Nano Banana + manual upload |
| 5720 | 아직 내 맘속에 (Remix) | sunosync_primenotation_2026_April_17 | (none) | yes | no |
| 5641 | YIMBY | sunosync_primenotation_2026_April_17 | (varies) | yes | no |
| 1 | 17.4s Recording (Mar 8 @ 1_09 PM) | sunosync_primenotation_2026_April_17 | (varies) | yes | no |
| 24 | 37.0s Recording (Mar 4 @ 8_12 PM) | sunosync_primenotation_2026_April_17 | (varies) | yes | no, but has 2 derivatives (v2, v3) |

Test endpoints with these IDs to see real responses while designing.

---

## Hand-off checklist for after redesign

When the new files come back, the integration should be:

1. Back up `frontend/` to `frontend.bak/`.
2. Drop new files in `frontend/`.
3. Verify each existing endpoint is still called correctly (use the API contract above).
4. Hard-refresh in browser; check the keyboard shortcuts still work; test the auto-pipeline flow on song 27.
5. Run smoke tests: `python -m tests.test_smoke` (these are backend-only, should still be green).

Things to manually validate post-redesign:
- [ ] Audio plays on load and Range requests work (seeking)
- [ ] Track strip auto-advances visuals during playback
- [ ] Drop-on-canvas adds to track
- [ ] 🚀 Auto generates 4 free Pollinations images
- [ ] Image inspire drop → Gemini Vision describes (existing tools modal)
- [ ] Lyrics tab scrolls in sync
- [ ] Sources tab links work between siblings
- [ ] Prompt vault save / search / apply works
- [ ] Notes autosave debounced
- [ ] Queue tab polls every ~3s
- [ ] Export MP4 button renders ffmpeg slideshow
- [ ] Search by lyrics finds songs (e.g. "underneath" matches lyric content)
- [ ] Channel switcher shows all 6 accounts
- [ ] Asset folders include `_gens` synthetic folder
- [ ] Mobile responsive (single-column feed)
- [ ] Korean / emoji titles render correctly

---

## What you can ignore

- **Concert mode (M6)** — separate roadmap in `CONCERT.md`. Not in this redesign.
- **Real timeline editor (M5c)** — too big. The track strip + tray + slideshow export is enough.
- **Chrome extension for Meta AI (M4)** — deferred indefinitely.
- **Watchdog filesystem monitoring** — manual reindex button is fine.
- **Multi-user / login** — single-user, no.

---

## References (existing repo files worth reading)

- `STATE.md` — current architecture snapshot
- `PLAN.md` — phased roadmap with status
- `MODELS.md` — AI service landscape (pricing, free tiers)
- `CONCERT.md` — multiplayer concert vision (later)
- `README.md` — install + usage
- `backend/app.py` — every endpoint, in code form
- `backend/db.py` — full SQLite schema
- `frontend/index.html` — current shell (templates show data binding spots)
- `frontend/js/api.js` — every API call wrapped (likely keep this verbatim)

---

**Use this brief verbatim when prompting Claude for the redesign.** All fixture data is real and can be queried live; all endpoints are stable; the visual direction is the user's stated preference (Suno-TikTok hybrid, free defaults). When the new files come back, paste them into `frontend/` and the existing backend will serve them.

---

## Redesign decisions (locked)

After Claude design's clarifying questions, the following defaults are confirmed:

1. **Brand color: lime is primary, pink retired.** No pink anywhere. `--accent` becomes a lime (Claude's `oklch(0.88 0.18 130)` is acceptable; exact tone is Claude's call). Destructive stays red (its own color).
2. **Family tree: not promoted to a separate UI.** Sources & derivatives stay as a tab inside the AI sheet. No separate "lineage glyph."
3. **Auto pipeline (🚀): one-tap fire-and-forget.** Toast progress + inline running chip on the 🚀 button itself (e.g. "🚀 Auto · 1/4"). No confirm sheet.
4. **Search: full-screen sheet.** With FTS5 over 109k lyric lines, the room is needed. No inline expand.
5. **Drop: anywhere on the visual card.** Whole card is the drop target; the visual area shows the drag highlight. Track strip drop also appends.

Other technical commitments (no changes from brief):
- `frontend/js/api.js` kept verbatim, re-exported from new modules.
- All media via `/media/audio/{id}`, `/media/cover/{id}`, `/media/gen/{id}`, `/media/asset/{id}` — never raw paths.
- Keyboard shortcuts preserved exactly (Space/K, J/L, M, N, P, 1-6, /, ?, Esc).
- Feed virtualized — only ±2 cards in DOM. Off-screen videos paused but metadata pre-warmed (poster + metadata loaded). Audio pauses hard on inactive cards.
- `/api/health` polled once on boot and again after every `POST /api/reload-env`.

Procedural color (per-song palette extraction, generative backdrops, lime-shifted pulses) is **deferred** post-prototype — the user explicitly tabled it to ship a working version first. Cover-derived colors and procedural sheet backdrops stay on the polish backlog (see PLAN.md), to be layered onto the redesigned frontend after it's stable.

## What's out of scope for this redesign

- **Concert mode (M6)** — separate roadmap in CONCERT.md.
- **Real timeline editor (M5c)** — too big. Track strip + tray + slideshow export is enough.
- **Chrome extension for Meta AI (M4)** — deferred indefinitely.
- **Multi-user / login** — single-user, no.
- **Procedural color system** — post-prototype polish.

## How the integration goes

When Claude returns the new files:

1. `mv frontend frontend.bak` (or `cp -r frontend frontend.bak`) — preserve the old version in case of rollback.
2. Drop the new files into `frontend/`.
3. Restart the server (or just hard-refresh the browser if the server is running — static files don't need a restart).
4. Run `python -m tests.test_smoke` (backend-only; should still be 37/37).
5. Manually validate the 14-point checklist above.
6. If something's broken: `mv frontend frontend.broken && mv frontend.bak frontend` to roll back instantly.
