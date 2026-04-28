import { renderGenerate } from "./tabs/generate.js";
import { renderLyrics } from "./tabs/lyrics.js";
import { renderSources } from "./tabs/sources.js";
import { renderPrompts } from "./tabs/prompts.js";
import { renderQueue } from "./tabs/queue.js";
import { renderNotes } from "./tabs/notes.js";

const TABS = {
  generate: renderGenerate,
  lyrics: renderLyrics,
  sources: renderSources,
  prompts: renderPrompts,
  queue: renderQueue,
  notes: renderNotes,
};

let _song = null;
let _tab = "generate";

export function setSong(song) { _song = song; }
export function currentSong() { return _song; }
export function currentTab() { return _tab; }

export function renderTab(name) {
  if (!TABS[name]) return;
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
  TABS[name](body, _song);
}
