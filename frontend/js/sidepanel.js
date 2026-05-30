import { renderGenerate } from "./tabs/generate.js";
import { renderDJ } from "./tabs/dj.js?v=dj1";
import { renderLyrics } from "./tabs/lyrics.js?v=lanes2";
import { renderSources } from "./tabs/sources.js";
import { renderPrompts } from "./tabs/prompts.js";
import { renderQueue } from "./tabs/queue.js";
import { renderDesign } from "./tabs/design.js";
import { api } from "./api.js";
import { toast } from "./util.js";

const TABS = {
  dj: renderDJ,
  generate: renderGenerate,
  lyrics: renderLyrics,
  design: renderDesign,
  sources: renderSources,
  prompts: renderPrompts,
  batch: renderQueue,   // Batch is the renamed queue tab
};

let _song = null;
let _tab = "generate";

export function setSong(song) {
  _song = song;
  updateTabCounts(song);
}
export function currentSong() { return _song; }
export function currentTab() { return _tab; }

/** Replace the FM-dial frequency placeholders with real per-tab counts. */
export function updateTabCounts(song) {
  if (!song) return;
  const set = (key, n) => {
    // Run twice — once now, and once on next animation frame — because the
    // sidepanel template can be cloned slightly after this is invoked when
    // navigating between songs.
    const write = () => {
      const els = document.querySelectorAll(`.fm-freq[data-count="${key}"]`);
      els.forEach((el) => { el.textContent = String(n); });
    };
    write();
    requestAnimationFrame(write);
  };

  set("dj", "ON");

  // Gens — count any row with a file_path (covers legacy rows missing status).
  const gens = Array.isArray(song.gens) ? song.gens : [];
  const realGens = gens.filter((g) => g && g.file_path).length;
  set("generate", realGens);

  const lyrics = Array.isArray(song.lyrics) ? song.lyrics : [];
  set("lyrics", lyrics.length);

  const sources = Array.isArray(song.sources) ? song.sources : [];
  const derivatives = Array.isArray(song.derivatives) ? song.derivatives : [];
  set("sources", sources.length + derivatives.length);

  // Prompts (app-level) — fetch lazily, log errors so we can see what failed.
  api.prompts()
    .then((rows) => {
      const n = Array.isArray(rows) ? rows.length : 0;
      set("prompts", n);
    })
    .catch((e) => { console.warn("prompts count failed:", e.message); set("prompts", 0); });

  // Batch (active jobs only) — same.
  api.jobs()
    .then((data) => {
      const items = Array.isArray(data?.items) ? data.items : [];
      const active = items.filter((j) => j && (j.status === "pending" || j.status === "running"));
      set("batch", active.length);
    })
    .catch((e) => { console.warn("batch count failed:", e.message); set("batch", 0); });

  // One-line summary in the console so it's obvious what data we received.
  console.debug("[myspot] tab counts:",
    { generate: realGens, lyrics: lyrics.length, sources: sources.length, derivatives: derivatives.length });
}

export function renderTab(name) {
  if (!TABS[name]) {
    console.warn(`[myspot] no renderer for tab "${name}"`);
    return;
  }
  _tab = name;
  const body = document.getElementById("tab-body");
  if (typeof body._cleanup === "function") {
    try { body._cleanup(); } catch { /* ignore */ }
    body._cleanup = null;
  }
  body.innerHTML = "";
  if (!_song) {
    body.innerHTML = "<div class='empty-state'>Pick a song.</div>";
    return;
  }
  // Render in try/catch so a thrown tab shows what happened instead of a
  // silent blank panel. Visible toast + console for the inevitable next bug.
  try {
    TABS[name](body, _song);
  } catch (e) {
    console.error(`[myspot] tab "${name}" failed:`, e);
    body.innerHTML =
      `<div class='empty-state' style='color: var(--accent-2);'>
        <strong>Tab "${name}" crashed</strong><br>
        <code style='display:block;margin-top:8px;font-size:12px'>${(e && e.message) || e}</code>
      </div>`;
    toast(`Tab "${name}" failed: ${(e && e.message) || e}`);
  }
}
