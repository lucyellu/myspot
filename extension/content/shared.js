// myspot bridge — content script (runs on Suno/Meta/Grok/Kling tabs).
//
// MVP responsibility: add a small floating "myspot" pill in the corner so you
// can confirm the extension is active on this site. Future: site-specific
// scrapers can extend this file with per-host hooks (e.g., on klingai.com,
// detect the "Download MP4" button and auto-send the result to myspot).
//
// For now, the primary action is via the context-menu "Send to myspot" on any
// image — that's site-agnostic and never breaks with UI rewrites.

(() => {
  if (window.__myspot_bridge__) return;
  window.__myspot_bridge__ = true;

  const host = location.hostname.replace(/^www\./, "");
  let label = "myspot";
  if (host.endsWith("suno.com")) label = "myspot · Suno";
  else if (host.includes("meta.ai")) label = "myspot · Meta";
  else if (host.endsWith("grok.com") || host.endsWith("x.com")) label = "myspot · Grok";
  else if (host.endsWith("klingai.com")) label = "myspot · Kling";

  const pill = document.createElement("div");
  pill.textContent = label;
  pill.title = "Right-click any image → Send to myspot";
  pill.style.cssText = `
    position: fixed; bottom: 12px; right: 12px;
    z-index: 2147483647; padding: 6px 10px;
    background: rgba(15,15,18,0.92); color: #c8e85f;
    border: 1px solid #2a2a33; border-radius: 999px;
    font: 11px/1 -apple-system, "Segoe UI", system-ui, sans-serif;
    pointer-events: none; opacity: 0.7;
    transition: opacity .2s;
  `;
  document.documentElement.appendChild(pill);
  setTimeout(() => { pill.style.opacity = "0.3"; }, 4000);
})();
