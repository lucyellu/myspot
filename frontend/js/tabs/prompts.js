import { api } from "../api.js";
import { el, clear, toast, debounce } from "../util.js";

export async function renderPrompts(body, song) {
  clear(body);

  // ── Add new prompt form ───────────────────────────────────────────
  const form = el("section", { class: "gen-section" });
  form.append(el("h5", { class: "section-h" }, "+ New prompt"));

  const name = el("input", { type: "text", placeholder: "Name (e.g. cinematic-mood)", class: "compact" });
  const category = el("input", { type: "text", placeholder: "Category (e.g. cinematic, anime, portrait)", class: "compact" });
  const tpl = el("textarea", { placeholder: "Template — use {title}, {genre}, {lyrics_excerpt}, {bpm}, {prompt} as variables." });
  const save = el("button", { class: "btn primary", type: "button" }, "Save");
  form.append(el("div", { class: "row-2" },
    el("label", {}, "Name", name),
    el("label", {}, "Category", category),
  ));
  form.append(el("label", {}, "Template", tpl));
  form.append(save);
  body.append(form);

  save.onclick = async () => {
    if (!name.value.trim() || !tpl.value.trim()) { toast("Name and template required"); return; }
    try {
      await api.savePrompt({
        name: name.value.trim(),
        category: category.value.trim() || null,
        template: tpl.value.trim(),
      });
      name.value = ""; category.value = ""; tpl.value = "";
      reload();
    } catch (e) { toast("Save failed: " + e.message); }
  };

  // ── Search / filter ─────────────────────────────────────────────
  const filterSection = el("section", { class: "gen-section" });
  filterSection.append(el("h5", { class: "section-h" }, "Vault"));
  const searchInp = el("input", { type: "search", placeholder: "Search prompts...", class: "compact" });
  const catChips = el("div", { class: "cat-chips", id: "cat-chips" });
  filterSection.append(searchInp, catChips);
  body.append(filterSection);

  let activeCategory = null;
  const debouncedSearch = debounce(reload, 200);
  searchInp.addEventListener("input", debouncedSearch);

  // ── List ─────────────────────────────────────────────────────────
  const listEl = el("div", { id: "prompt-list", class: "prompt-grid" });
  body.append(listEl);

  async function loadCategories() {
    try {
      const cats = await api.promptCategories();
      clear(catChips);
      const all = el("button", { class: "cat-chip" + (activeCategory ? "" : " active"), type: "button" }, "All");
      all.onclick = () => { activeCategory = null; loadCategories(); reload(); };
      catChips.append(all);
      for (const c of cats) {
        const chip = el(
          "button",
          { class: "cat-chip" + (activeCategory === c.category ? " active" : ""), type: "button" },
          `${c.category} (${c.n})`,
        );
        chip.onclick = () => {
          activeCategory = activeCategory === c.category ? null : c.category;
          loadCategories(); reload();
        };
        catChips.append(chip);
      }
    } catch { /* ignore */ }
  }

  async function reload() {
    listEl.innerHTML = "";
    let prompts = [];
    try {
      prompts = await api.prompts({
        q: searchInp.value.trim() || null,
        category: activeCategory,
      });
    } catch { /* ignore */ }
    if (!prompts.length) {
      listEl.append(el("div", { class: "empty-state" }, "No saved prompts."));
      return;
    }
    for (const p of prompts) listEl.append(card(p));
  }

  function card(p) {
    const c = el("div", { class: "prompt-card" });
    const head = el("div", { class: "prompt-card-head" });
    head.append(el("strong", {}, p.name));
    if (p.category) head.append(el("span", { class: "prompt-cat" }, p.category));
    if (p.use_count) head.append(el("span", { class: "muted small" }, `× ${p.use_count}`));
    c.append(head);
    c.append(el("pre", {}, p.template));
    const row = el("div", { class: "row" });
    const useBtn = el("button", { class: "btn primary", type: "button" }, "Apply");
    useBtn.onclick = async () => {
      const applied = applyTemplate(p.template, song);
      try {
        await navigator.clipboard.writeText(applied);
        toast("Applied prompt copied to clipboard");
      } catch { toast("Could not copy to clipboard"); }
      api.markPromptUsed(p.id).catch(() => {});
    };
    const dup = el("button", { class: "btn", type: "button" }, "Duplicate");
    dup.onclick = () => {
      name.value = p.name + " (copy)";
      category.value = p.category || "";
      tpl.value = p.template;
      name.focus();
    };
    const del = el("button", { class: "btn", type: "button" }, "Delete");
    del.onclick = async () => {
      if (!confirm(`Delete prompt "${p.name}"?`)) return;
      await api.deletePrompt(p.id);
      reload(); loadCategories();
    };
    row.append(useBtn, dup, del);
    c.append(row);
    return c;
  }

  await loadCategories();
  await reload();

  // ── Notes (folded in here so it shares the prompts surface) ──────
  const notesSection = el("section", { class: "gen-section" });
  notesSection.append(el("h5", { class: "section-h" }, "📝 Notes"));
  notesSection.append(el("p", { class: "muted small", style: "margin: -4px 0 8px" },
    "Per-song. Auto-saves while you type."));
  const notesArea = el("textarea", {
    class: "notes-area",
    placeholder: "Ideas, references, mood, planned visuals...",
  }, song.note || "");
  notesSection.append(notesArea);
  const saveNote = debounce(async () => {
    try { await api.putNote(song.id, notesArea.value); toast("Note saved"); }
    catch (e) { toast("Note save failed: " + e.message); }
  }, 800);
  notesArea.addEventListener("input", saveNote);
  body.append(notesSection);
}

function applyTemplate(tpl, song) {
  const lyricsExcerpt = (song.lyrics || []).slice(0, 6).map((l) => l.text).join(" / ");
  return tpl
    .replaceAll("{title}", song.title || "")
    .replaceAll("{genre}", song.genre || "")
    .replaceAll("{bpm}", song.bpm || "")
    .replaceAll("{prompt}", song.prompt || "")
    .replaceAll("{lyrics_excerpt}", lyricsExcerpt);
}
