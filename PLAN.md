# myspot — Roadmap

> Phased plan. See [STATE.md](./STATE.md) for current ground truth, [DESIGN-BRIEF.md](./DESIGN-BRIEF.md) for the redesign in flight, [MODELS.md](./MODELS.md) for AI service options, [CONCERT.md](./CONCERT.md) for the multiplayer concert vision.

Status: ✅ done · 🟡 partial · ⏳ deferred · ⬜ not started · 🔄 in progress.

## 🔄 Active work

**Repo on GitHub.** https://github.com/lucyellu/myspot — initial commit pushed. Future commits should be small + focused.

**Cassette/radio frontend is live in-house** as the current production theme (sage HSL + VT323 pixel + halftone visualizer + FM-dial tabs + LCD readouts). Theme system (hue picker + dark mode) layered on top. `frontend/css/app.dark.css.bak` and `frontend/index.dark.html.bak` preserve the original dark theme for rollback.

**Claude design's redesign** (Suno-TikTok feed direction) is still possible — DESIGN-BRIEF.md is the contract. If/when Claude returns files: `mv frontend frontend.bak` → drop in new files → walk 14-point validation checklist. Both designs share the same backend so they're swappable.

**Locked design decisions** (apply to whichever frontend ships):
- Brand: **lime** primary; pink retired
- Auto pipeline: one-tap fire-and-forget with toast progress
- Search: full-screen sheet
- Drop: anywhere on the visual card
- Family tree: stays as Sources tab; no separate glyph
- `frontend/js/api.js` stays verbatim across redesigns

## Milestones

### ✅ M1 — Library + viewer skeleton
Full library indexer, YouTube-style watch page, 6-tab AI sidepanel, lyrics + sources tabs, prompt vault, notes, channel sidebar, FTS5 lyrics search, keyboard shortcuts, help overlay.

### ✅ M2 — Manual gen + assets
Manual paste/drop workflow, drop-on-canvas, asset browser with attach-to-song, visual auto-refresh.

### ✅ M3 — Real AI integrations
- DeepSeek V3 prompt enhancer (paid, cheap)
- Gemini 2.5 Flash prompt enhancer (250/day free)
- Claude Sonnet 4.6 prompt enhancer (wired, optional key)
- Gemini Nano Banana image gen (paid, $25 funded)
- Grok Imagine image gen (wired, no key — paid)
- **Pollinations FLUX (4 variants — FREE unlimited)** — default
- **HuggingFace FLUX-schnell** — premium free tier
- Gemini Vision image-to-prompt with auto-fallback chain
- Background job queue + batch fill
- "Generate 4" parallel variation flow
- **🚀 Auto pipeline** — single-click cheapest-free orchestration

### 🟡 M4 — Chrome extension bridge
Scaffolded as a **right-click "Send to myspot"** extension (site-agnostic image grab via context menu). Lives in `extension/`. Manifest V3, service worker, popup with status, corner pill on supported tabs (suno / meta / grok / kling / x). No per-site DOM scraping yet — adding that is opt-in extension work, not myspot core. The bridge talks only to the backend, so it survives any frontend redesign.

**What's implemented:** right-click image → save + optionally attach to current song, popup status, current-song wire-up.

**What's not (and probably stays deferred):** simulating button presses on Suno / Meta AI / Grok pages. Brittle; the right-click pattern strict-improves on it for most workflows.

### ✅ M5a — Slideshow MP4 export
ffmpeg-driven slideshow export. Distributes completed gens evenly across audio duration, 1280×720 H.264.

### ✅ M5b — Live track strip + auto-advance + media tray (CapCut MVP)
- Track strip with thumbnails per gen
- Live slideshow during playback
- Drop-anywhere-on-canvas adds to track
- Click thumbnail = seek to position
- Per-clip Animate button (HF LTX-Video) and Kling handoff button
- Bottom media tray with folder switcher (Gens / asset folders)
- Sidebar folder click wires into tray on watch view

### ⬜ M5c — Real timeline editor
Not started. Drag-to-reorder, per-clip duration, transitions, beat detection. Solid via esm.sh. Estimated 4-6 weeks. Probably skipped in favor of more AI features unless export quality demands it.

### ✅ M5d — Frontend redesign (cassette/radio aesthetic shipped)
**In-house version live.** Sage HSL palette + VT323 pixel + halftone Web Audio visualizer + FM-dial sidepanel tabs + LCD readouts. Theme system (hue picker + dark mode) layered on top. Original dark theme preserved at `*.bak`. Claude design's alternate (Suno-TikTok) still welcome — drop-in compatible.

### ⬜ M6 — Concert mode
See [CONCERT.md](./CONCERT.md). Phase A (single-user concert mode) is one weekend's work and reuses the existing prompt + image pipeline. The new TikTok-feed redesign actually fits this concept better than the YouTube-style did.

## Reusable foundation (stable, won't change)

- **Auto-fallback architecture**: `backend/ai/__init__.py::auto_*_tool()` picks the cheapest available tool per kind. Add a tool to the registry → it joins the cascade.
- **Manual upload workflow**: any file dropped goes through `POST /api/songs/{id}/gens/upload` and becomes a track clip. Works for any external generator (Kling, Veo, Photoshop).
- **Track strip**: gens are ordered by id (insertion). Reorder/duration/trim hooks land on the strip without backend changes.
- **`secrets/` + `.env` resolution**: drop a key, hit "Reload .env" or restart, new tool lights up.
- **Media tray**: any new asset folder under `myspot/assets/` shows up after reindex; gens always shown via `_gens` synthetic folder.

## Sortability + plays + likes (now wired)

Backend ready for: most-played, most-liked, most-gens, recently-played sort modes. The frontend redesign should:

1. Call `POST /api/songs/{id}/play` when audio actually plays (e.g. on `audio.pause` with the cumulative ms played, or `audio.ended` with full duration).
2. Show a heart in the right rail that calls `POST /api/songs/{id}/like` to toggle. Read `liked` from the song detail response.
3. Add sort controls: "Recent / Popular / Liked / Most Gens / Recently played". Pass `sort=` to `/api/songs`.
4. Optionally show plays + gens counts as small badges on each card.

`GET /api/songs/top?by=...&limit=N` is the curated-list endpoint (filters out songs with zero plays/gens/likes for cleaner top lists).

## Polish backlog (not assigned to a milestone)

| Item | Effort | Value |
| --- | --- | --- |
| Cross-fade transitions in slideshow render | 1h | bigger than its size |
| Drag-to-reorder track strip | 2h | yes |
| Per-clip duration override | 3h | needed before M6 concert mode |
| Watchdog filesystem monitor (auto-reindex on drop) | 2h | yes |
| Whisper-based lyric timestamps | 4h | huge for lyrics tab |
| HF cold-start retry with backoff | 30min | quality-of-life |
| Procedural per-song palette (cover-derived) | 3h | post-redesign — was discussed and tabled |
| MIDI playback widget for `.mid` siblings | 3h | bonus |
| SSE for live queue updates (replace 3s polling) | 2h | quality-of-life |

## Intentionally not on the roadmap

- **Suno regen via web automation** — possible (SunoSync proves the cookie-auth path works) but heavyweight; revisit when concert mode demands it.
- **Self-hosted FLUX/LTX on local GPU** — user doesn't have 24GB+ VRAM and the setup tax is huge. Pollinations + HF cover the use case.
- **Mobile native app** — the web UI is responsive enough; native is months for marginal benefit.
- **Multi-user account system** — single-user-localhost is the design. Multi-user lives in M6 concert mode (room codes, not accounts).
- **Real-time collaborative editing** — possible with Yjs/CRDT but only valuable if multiple humans edit one song. Out of scope.
- **Pink as a color** — retired. Lime is the new primary.
