# myspot bridge — Chrome extension

Right-click any image on any website → "Send to myspot." The image downloads to your local `data/gens/` and optionally attaches to the song currently open in myspot.

## Install (developer mode — one-time)

1. Make sure myspot is running: `python -m backend.app` or `Desktop\myspot.lnk`.
2. Open Chrome → `chrome://extensions/` → toggle "Developer mode" on (top-right).
3. Click "Load unpacked" → pick the `C:\Users\lucyl\Desktop\myspot\extension\` folder.
4. (Optional) Pin the myspot extension to the toolbar for the popup status panel.

The extension shows a tiny "myspot · Site" pill in the bottom-right corner of any tab on the supported sites (suno.com, meta.ai, grok.com / x.com, klingai.com) so you know it's active.

## How to use

**Right-click → Send to myspot:** image goes to `data/gens/` as a generic asset.

**Right-click → Send to myspot → attach to current song:** image goes to `data/gens/` AND gets attached as a new gen on whatever song you currently have open in myspot. The myspot frontend tells the backend which song is "current" via `POST /api/extension/current-song-set` (handled automatically when you open a song page).

**Right-click on a hyperlink → Send link to myspot:** treats the linked URL as if it were the image source. Useful when an image is wrapped in `<a href>` (common on Suno, Pinterest etc.).

## What's automated, what isn't

✅ **Right-click image → save to myspot** — works on every website without per-site code.

✅ **Auto-attach to current song** — works as long as myspot has a song open.

❌ **Auto-trigger generation on Suno / Meta / Grok / Kling** — not implemented. Each site has different DOM and changes too often. Use these sites manually, then right-click the result to ship it.

## Per-site hook points (extend yourself if you want)

`extension/content/shared.js` runs on every supported site. To add site-specific behavior, branch on `location.hostname` and inject buttons / scrapers / auto-senders. Pattern:

```js
if (location.hostname.endsWith("klingai.com")) {
  // observe for the "Download" button on a finished video
  // when found, fetch the video URL and POST to:
  //   http://127.0.0.1:7777/api/extension/import-image
  // (the endpoint accepts videos too, despite the name)
}
```

This is exactly the path SunoSync's chrome_extension uses for Suno cookie-relay; if you ever want to drive Suno regen from myspot, port that pattern here.

## Endpoints the extension calls

```
GET  http://127.0.0.1:7777/api/health                    → check myspot is up
GET  http://127.0.0.1:7777/api/extension/current-song    → which song is open
POST http://127.0.0.1:7777/api/extension/import-image    → save URL to library
       body: {url, source_url?, attach_to_current?: bool}
       returns: {asset_id?, attached_to_song_id?}
```

## Troubleshooting

- **"Cannot reach myspot at localhost:7777"** in the popup → server isn't running. Double-click `Desktop\myspot.lnk`.
- Extension does nothing on right-click → reload the extension at `chrome://extensions/` (myspot bridge → ↻).
- Got a "Failed to fetch" → CORS or mixed-content. The backend is `http://`; modern Chrome blocks fetch from `https://` to `localhost`. Workaround: use the `host_permissions` already in `manifest.json` (declared) — if it persists, check `chrome://flags/#block-insecure-private-network-requests` on dev mode.
- Notifications not showing → enable Chrome notifications for the extension.
