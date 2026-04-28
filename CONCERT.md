# Concert Mode — Roadmap

A multiplayer music-video experience: each connected viewer is a "ticket" that scales the visual crowd, and the song itself gets re-prompted to a Suno regeneration that reflects who's there. Final output: panoramic / 360 visuals from multiple POV archetypes that you can navigate during playback.

This is **not built yet.** The notes below capture the user's vision so we can build toward it incrementally.

---

## The crowd-multiplier idea

| Connected viewers | Generated crowd size | Notes |
| --- | --- | --- |
| 1  | 10            | solo session — small bar feel |
| 2  | 100           | club / late-night small venue |
| 3  | 1,000         | mid-size venue |
| 4  | 10,000        | arena |
| 5  | 100,000       | stadium |
| 6  | 1,000,000     | festival headliner |
| 7  | 10,000,000    | landmark / "never been done before" |

Logarithmic ramp by viewer count is the gimmick. Each new viewer 10×s the rendered audience, which gives the song a real escalating-stakes feel as friends join.

## Pipeline (per session)

```
attendees → archetype factor → DeepSeek/Claude word-pass on Suno prompt
                                    │
                                    ▼
                          regenerated Suno track (×2 variants)
                                    │
                  ┌─────────────────┼─────────────────┐
                  ▼                 ▼                 ▼
        crowd-pov image gen   stage-cam panorama   attendee-phone POVs
        (FLUX panorama)       (16:9 wide)          (iphone/polaroid/dslr)
                  │                 │                 │
                  └─────────────────┴─────────────────┘
                                    ▼
                         360-equirectangular video
                       (look-around playback in browser)
```

## Per-attendee personalization (optional toggle)

Lets users opt-in to share factors that shape the prompt. Default to archetypes if no opt-in.

```
[ ] age band (17-25, 26-40, 40+)
[ ] gender presentation
[ ] ethnicity
[ ] ticket tier (GA, VIP, side-stage)
[ ] mood ("hype", "melancholy", "rage")
[ ] outfit (silver, neon, all-black)
```

If unshared → use archetype rotation (e.g. "rotating cohort of 25-year-old festival-goers in summer fits"). The prompt-builder picks one summary line per cohort and folds it into the regen prompt.

## POV variants for "phone footage" gens

Each POV is a prompt-prefix bundle reused across songs:

- **iphone, casual, realistic** — vertical 9:16, slight lens distortion, indoor flash
- **polaroid** — square, vignette, slight color shift toward warm, motion blur
- **disposable camera** — over-saturated, harsh flash, grain, low resolution feel
- **DSLR / professional party photographer** — 35mm, shallow DOF, dramatic side light, color graded
- **drone overhead** — top-down crowd, stage in frame, light show streaks
- **stage cam** — wide-angle from performer's POV looking into the crowd

For each Suno regen, generate 6 images (one per POV) so the user has variety. FLUX is decent at all these styles; Pollinations free covers it.

## Phasing

### Phase A — Single-user concert mode (1-2 days)
- New "Concert" tab beside Generate.
- UI: pick archetype mix (or pull random) + crowd size slider.
- Backend assembles a "concert prompt prefix" string, runs it through Pollinations FLUX with each POV variant, attaches all 6 to the song's gen track.
- No Suno regen yet — uses the existing song. Validates the prompt-engineering loop end-to-end.

### Phase B — Multi-perspective track export (2-3 days)
- Render each POV as a separate "angle" in the export.
- Add a "POV switcher" button on the player that swaps between angles mid-song.
- MP4 export bakes one chosen POV; HTML5 player can hot-swap.

### Phase C — Suno regen pipeline (1 week)
- Wire Suno's unofficial API (requires user's Suno session cookie — same path SunoSync uses).
- "Regen from concert context" button → submits modified prompt to Suno → polls for completion → adds the two new variants to the song's `relationships` (kind=concert-regen) and to the channel.
- The song-detail "Sources" tab now shows the regen lineage.

### Phase D — Multiplayer presence (2-3 weeks)
- WebSocket server (FastAPI's `WebSocket` route) maintains per-room presence.
- Room code in URL: `myspot://concert/<room>` → both clients join the same audio + visual stream.
- Crowd multiplier reads from current room size; when count crosses a threshold (1→2, 2→3, etc.), kick off a fresh regen.
- Sync playback across clients (master clock + drift correction).

### Phase E — 360 panorama mode (1-2 weeks)
- FLUX prompt prefix: "equirectangular 360 panorama, 2:1 aspect, full sphere coverage".
- ffmpeg `-vf v360=e:flat:yaw=...` to emit per-frame perspective views from a single equirect source.
- Use Three.js or similar to render the panorama in the player; mouse drag = look around.
- YouTube 360-style metadata in the exported MP4 (`spatial-media` injector).

### Phase F — Recommendation algo (later)
- After several regens per song, score variants by: viewer reactions (heart/skip during playback), session length, replay count.
- Surface "top variant" badge in the Sources tab.
- Default new sessions to top-scored variant.

## What it inherits from current myspot

Everything below is already built and reusable:

| Concert needs | Already built |
| --- | --- |
| Songs library | ✅ 5,720 indexed |
| Per-song attached visuals + ordered track | ✅ `gens` + track strip (this build) |
| Free image gen | ✅ Pollinations FLUX |
| Prompt enhancement (DeepSeek/Gemini/Claude) | ✅ |
| Image-to-prompt vision | ✅ Gemini |
| Slideshow MP4 export | ✅ M5a |
| Source/derivative chain | ✅ filename-version inference; can extend to concert-regen kind |

## What needs new infrastructure

- **Suno regen**: requires session-cookie automation. Same risk profile as Meta AI extension — fragile but well-trodden ground (SunoSync proves it works).
- **Multiplayer presence**: WebSocket server + room state. Standard FastAPI.
- **Equirectangular rendering**: Three.js + ffmpeg v360 filter. Both off-the-shelf.
- **Per-user opt-in personal data**: simple form + cookie storage; respect a "data dropoff" toggle (clear after session).

## Privacy notes

Demographics input must be opt-in and per-session. No persistence across sessions unless the user explicitly chooses to save a profile. Prompt prefixes generated from demographics should never include exact strings the user typed (paraphrase / fold into archetype language) so a leaked prompt doesn't leak the input.

---

**TL;DR**: this is a real product idea with a clean phased build, mostly leveraging the foundation here. Phase A is one weekend of work and would already feel magical.
