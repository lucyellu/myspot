import { api } from "../api.js";
import { el, clear, toast, debounce } from "../util.js";

export function renderNotes(body, song) {
  clear(body);
  const hint = el("div", { class: "muted", style: "margin-bottom:8px" },
    "Auto-saves on pause. Per-song.");
  body.append(hint);
  const ta = el("textarea", { class: "notes-area", placeholder: "Ideas, references, mood, planned visuals..." }, song.note || "");
  body.append(ta);

  const save = debounce(async () => {
    try { await api.putNote(song.id, ta.value); toast("Note saved"); }
    catch (e) { toast("Save failed: " + e.message); }
  }, 800);
  ta.addEventListener("input", save);
}
