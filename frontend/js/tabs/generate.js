import { api, mediaUrl } from "../api.js";
import { el, clear, toast } from "../util.js";
import { refreshPlayerVisual } from "../views/watch.js";

// Default order: free options first (Gemini text 250/day, Pollinations unlimited).
const PROMPT_MODELS = [
  { id: "gemini-text", label: "Gemini Flash (250/day free)", check: "gemini-text" },
  { id: "deepseek",    label: "DeepSeek (cheap)",         check: "deepseek" },
  { id: "claude",      label: "Claude Sonnet 4.6",        check: "claude" },
];

const IMAGE_TOOLS = [
  { id: "pollinations-realism", label: "FLUX-Realism — photoreal (FREE unlimited)", check: "pollinations" },
  { id: "pollinations",         label: "FLUX.dev — balanced (FREE unlimited)",     check: "pollinations" },
  { id: "pollinations-anime",   label: "FLUX-Anime — illustrated (FREE unlimited)", check: "pollinations" },
  { id: "pollinations-turbo",   label: "FLUX-Turbo — fast/draft (FREE unlimited)",  check: "pollinations" },
  { id: "hf-flux",              label: "HF FLUX-schnell — premium (FREE ~30/mo)",  check: "hf-flux" },
  { id: "nano-banana",          label: "Nano Banana ($0.04/img)",                  check: "nano-banana" },
  { id: "grok",                 label: "Grok Imagine ($0.02/img)",                 check: "grok" },
  { id: "manual",               label: "Manual paste / drop",                      available: true },
];

const _state = new Map();
function stateFor(song) {
  if (!_state.has(song.id)) _state.set(song.id, { promptValue: "", imagePromptValue: "", lastInspireSource: null });
  return _state.get(song.id);
}

export async function renderGenerate(body, song) {
  clear(body);
  const state = stateFor(song);

  let health = { tools: {}, ffmpeg: false };
  try { health = await api.health(); } catch { /* ignore */ }

  // ============ HERO: one-button generate ============
  const hero = el("section", { class: "gen-hero" });
  hero.append(el("h4", { class: "section-h" }, "✨ Make a visual"));
  hero.append(el("p", { class: "muted small", style: "margin: -4px 0 8px" },
    "One click. Pollinations is free and unlimited; switch tools in the dropdown."));

  const tool = el("select", { class: "compact" });
  for (const t of IMAGE_TOOLS) {
    const info = t.check ? health.tools?.[t.check] : null;
    const av = t.available != null ? t.available : !!info?.available;
    let label = t.label;
    if (!av) label += " (no key)";
    const o = el("option", { value: t.id }, label);
    if (!av) o.disabled = true;
    tool.append(o);
  }
  // Default to first available (Pollinations is always available)
  const firstAvail = [...tool.options].find((o) => !o.disabled);
  if (firstAvail) tool.value = firstAvail.value;

  const goBtn = el("button", { class: "btn primary big", type: "button" }, "Generate 1");
  const go4Btn = el("button", { class: "btn big", type: "button", title: "Generate 4 variations in parallel" }, "Generate 4");
  const autoBtn = el("button", { class: "btn big auto-btn", type: "button",
    title: "Enhance prompt (free Gemini) then generate 4 images (free Pollinations) — all free, one click" },
    "🚀 Auto (free pipeline)");
  hero.append(el("div", { class: "hero-row" }, tool, goBtn));
  hero.append(el("div", { class: "hero-row hero-row-2" }, go4Btn, autoBtn));

  autoBtn.onclick = async () => {
    autoBtn.disabled = true; goBtn.disabled = true; go4Btn.disabled = true;
    autoBtn.textContent = "🚀 Running...";
    heroStatus.textContent = "Enhancing prompt → generating 4 images...";
    try {
      const r = await api.autoPipeline(song.id, { count: 4, animate: false });
      if (r.error) { heroStatus.textContent = "Auto failed: " + r.error; toast("Failed"); }
      else {
        const parts = (r.steps || []).map((s) => {
          if (s.error) return `${s.step}: ${s.error.slice(0, 40)}`;
          if (s.skipped) return `${s.step}: skipped`;
          return `${s.step}: ${s.tool || s.model || "ok"}`;
        });
        const imgCount = (r.image_gen_ids || []).length;
        heroStatus.textContent = `Done — ${imgCount} images. Steps: ${parts.join(" → ")}`;
        toast(`🚀 Auto: ${imgCount} new`);
        refreshPlayerVisual(song);
      }
    } catch (e) { heroStatus.textContent = "Auto failed: " + e.message; }
    autoBtn.disabled = false; goBtn.disabled = false; go4Btn.disabled = false;
    autoBtn.textContent = "🚀 Auto (free pipeline)";
  };

  const heroStatus = el("div", { class: "muted small", style: "margin-top:8px;min-height:16px" }, "");
  hero.append(heroStatus);

  async function runGen(times) {
    const t = tool.value;
    if (t === "manual") { toast("Manual = drop a file directly onto the player canvas."); return; }
    if (t.startsWith("pollinations") === false) {
      const av = !!health.tools?.[t]?.available;
      if (!av) { toast("Pick another tool — this one needs a key."); return; }
    }
    const promptText = (state.promptValue || buildSeedPrompt(song)).trim();
    goBtn.disabled = true; go4Btn.disabled = true;
    let done = 0;
    let failed = 0;
    heroStatus.textContent = `${t}: 0 / ${times}...`;

    const updateStatus = () => {
      heroStatus.textContent = `${t}: ${done} / ${times}` + (failed ? ` (${failed} failed)` : "");
    };

    // Parallel for free tier; serial for paid (avoid double-spend on bad params).
    const isFree = t.startsWith("pollinations");
    const tasks = Array.from({ length: times }, () => async () => {
      try {
        const r = await api.generateGen(song.id, t, promptText);
        if (r.error) failed++; else done++;
      } catch { failed++; }
      updateStatus();
    });

    if (isFree) {
      await Promise.all(tasks.map((fn) => fn()));
    } else {
      for (const fn of tasks) await fn();
    }

    refreshPlayerVisual(song);
    if (done) toast(`${t}: ${done} new ✓` + (failed ? ` (${failed} failed)` : ""));
    else toast(`All ${times} failed — see status below`);

    goBtn.disabled = false; go4Btn.disabled = false;
  }

  goBtn.onclick = () => runGen(1);
  go4Btn.onclick = () => runGen(4);

  body.append(hero);

  // ============ Advanced (collapsed by default) ============
  const adv = el("details", { class: "gen-advanced" });
  const sum = el("summary", {}, "▸ Advanced — write your own prompt, use image inspiration, queue, export");
  adv.append(sum);

  // -- Prompt subsection
  const promptSection = el("section", { class: "gen-section" });
  promptSection.append(el("h5", { class: "section-h" }, "Custom prompt"));
  promptSection.append(el("p", { class: "muted small", style: "margin: -4px 0 8px" },
    "Empty = auto-generate from song's title, lyrics, genre."));

  const promptModel = el("select", { class: "compact" });
  for (const m of PROMPT_MODELS) {
    const info = health.tools?.[m.check];
    const av = !!info?.available;
    const o = el("option", { value: m.id }, av ? `${m.label} · key: ${info.source}` : `${m.label} (no key)`);
    if (!av) o.disabled = true;
    promptModel.append(o);
  }
  const firstPromptAvail = [...promptModel.options].find((o) => !o.disabled);
  if (firstPromptAvail) promptModel.value = firstPromptAvail.value;

  const seedInput = el("input", { type: "text", placeholder: "Optional direction, e.g. 'noir, rainy neon'", class: "compact" });
  promptSection.append(
    el("div", { class: "row-2" },
      el("label", {}, "Enhance with", promptModel),
      el("label", {}, "Direction", seedInput),
    ),
  );

  const promptArea = el("textarea", { placeholder: buildSeedPrompt(song), class: "prompt-area" });
  promptArea.value = state.promptValue || "";
  promptArea.addEventListener("input", () => { state.promptValue = promptArea.value; });
  promptSection.append(promptArea);

  // Tag chips — curated one-click prompt fragments
  const tagBox = el("details", { class: "tag-chips-box" });
  const tagSummary = el("summary", {}, "▸ Style chips — click to append");
  tagBox.append(tagSummary);
  const tagBody = el("div", { class: "tag-chips-body" });
  tagBox.append(tagBody);
  promptSection.append(tagBox);

  api.promptTags().then((groups) => {
    tagBody.innerHTML = "";
    for (const [label, items] of Object.entries(groups || {})) {
      const grp = el("div", { class: "tag-group" });
      grp.append(el("h6", {}, label));
      const row = el("div", { class: "tag-row" });
      for (const t of items) {
        const chip = el("button", { type: "button", class: "tag-chip-btn" }, t);
        chip.onclick = () => {
          const cur = (promptArea.value || "").trim();
          promptArea.value = cur ? `${cur}, ${t}` : t;
          state.promptValue = promptArea.value;
          promptArea.focus();
        };
        row.append(chip);
      }
      grp.append(row);
      tagBody.append(grp);
    }
  }).catch(() => { /* ignore */ });

  const enhanceBtn = el("button", { class: "btn", type: "button" }, "✨ Enhance");
  const seedFromContextBtn = el("button", { class: "btn", type: "button" }, "Reset");
  const copyBtn = el("button", { class: "btn", type: "button" }, "Copy");
  promptSection.append(el("div", { class: "button-row" }, enhanceBtn, seedFromContextBtn, copyBtn));

  enhanceBtn.onclick = async () => {
    const model = promptModel.value;
    if (!health.tools?.[model]?.available) { toast(`Need key for ${model}`); return; }
    enhanceBtn.disabled = true; enhanceBtn.textContent = "Thinking...";
    try {
      const r = await api.enhancePrompt(song.id, {
        model, seed: seedInput.value.trim(), image_prompt: state.imagePromptValue || "",
      });
      if (r.error) toast(`${model}: ${r.error.slice(0, 220)}`);
      else { promptArea.value = r.prompt; state.promptValue = r.prompt; toast(`Enhanced via ${r.model_version}`); }
    } catch (e) { toast("Failed: " + e.message); }
    enhanceBtn.disabled = false; enhanceBtn.textContent = "✨ Enhance";
  };
  seedFromContextBtn.onclick = () => { promptArea.value = promptArea.placeholder; state.promptValue = promptArea.value; };
  copyBtn.onclick = () => {
    navigator.clipboard.writeText((promptArea.value || promptArea.placeholder).trim()).then(() => toast("Copied"));
  };

  adv.append(promptSection);

  // -- Image inspiration subsection
  const inspireSection = el("section", { class: "gen-section" });
  inspireSection.append(el("h5", { class: "section-h" }, "🖼  Image inspiration"));
  inspireSection.append(el("p", { class: "muted small", style: "margin: -4px 0 8px" },
    "Drop or link an image — Gemini Vision describes it so the next prompt recreates that aesthetic."));

  const inspireDrop = el("div", { class: "inspire-drop" }, "Drop an image here, or click to pick.");
  const inspireFileInp = el("input", { type: "file", accept: "image/*", style: "display:none" });
  inspireDrop.onclick = () => inspireFileInp.click();
  inspireDrop.ondragover = (e) => { e.preventDefault(); inspireDrop.classList.add("drag"); };
  inspireDrop.ondragleave = () => inspireDrop.classList.remove("drag");
  inspireDrop.ondrop = async (e) => {
    e.preventDefault(); inspireDrop.classList.remove("drag");
    const f = e.dataTransfer?.files?.[0];
    if (f) await runInspireUpload(f);
  };
  inspireFileInp.onchange = async () => {
    const f = inspireFileInp.files?.[0];
    if (f) await runInspireUpload(f);
  };

  const urlRow = el("div", { class: "row-2 url-row" });
  const urlInp = el("input", { type: "url", placeholder: "https://...", class: "compact" });
  const urlBtn = el("button", { class: "btn", type: "button" }, "From URL");
  urlRow.append(urlInp, urlBtn);
  urlBtn.onclick = () => runInspireUrl(urlInp.value.trim());

  inspireSection.append(inspireDrop, inspireFileInp, urlRow);

  const imgPromptDisplay = el("details", { class: "inspire-detail" });
  const imgPromptSummary = el("summary", {},
    state.imagePromptValue ? "Visual reference loaded — folded into Enhance" : "No reference loaded");
  const imgPromptText = el("div", { class: "muted small inspire-text" }, state.imagePromptValue || "");
  imgPromptDisplay.append(imgPromptSummary, imgPromptText);
  inspireSection.append(imgPromptDisplay);

  adv.append(inspireSection);

  // -- Queue button
  const queueSection = el("section", { class: "gen-section" });
  queueSection.append(el("h5", { class: "section-h" }, "Queue"));
  queueSection.append(el("p", { class: "muted small", style: "margin: -4px 0 8px" },
    "Defer to background worker (see Queue tab)."));
  const qBtn = el("button", { class: "btn", type: "button" }, "Queue this for later");
  queueSection.append(qBtn);
  qBtn.onclick = async () => {
    const t = tool.value;
    if (t === "manual") { toast("Cannot queue manual."); return; }
    try { await api.enqueueGen(song.id, t); toast("Queued — see Queue tab"); }
    catch (e) { toast("Failed: " + e.message); }
  };
  adv.append(queueSection);

  // -- Export
  const exportSection = el("section", { class: "gen-section" });
  exportSection.append(el("h5", { class: "section-h" }, "🎬 Export MP4"));
  exportSection.append(el("p", { class: "muted small", style: "margin: -4px 0 8px" },
    "All clips on the track render as a slideshow synced to the song audio."));
  const exportBtn = el("button", { class: "btn", type: "button", disabled: !health.ffmpeg },
    health.ffmpeg ? "Render slideshow" : "ffmpeg missing");
  const exportStatus = el("div", { class: "muted small", style: "margin-top:6px" }, "");
  exportSection.append(exportBtn, exportStatus);
  exportBtn.onclick = async () => {
    exportBtn.disabled = true; exportBtn.textContent = "Rendering..."; exportStatus.textContent = "";
    try {
      const r = await api.exportSong(song.id);
      if (r.error) exportStatus.textContent = "Failed: " + r.error;
      else {
        clear(exportStatus);
        exportStatus.append(
          el("a", { href: mediaUrl.export(song.id), target: "_blank", style: "color:var(--accent-3)" },
            `Download MP4 (${(r.size_bytes/1024/1024).toFixed(1)} MB)`),
        );
        toast("Export rendered ✓");
      }
    } catch (e) { exportStatus.textContent = "Failed: " + e.message; }
    exportBtn.disabled = !health.ffmpeg; exportBtn.textContent = "Render slideshow";
  };
  adv.append(exportSection);

  body.append(adv);

  // ============ Helpers ============
  async function runInspireUpload(file) {
    inspireDrop.classList.add("loading");
    inspireDrop.textContent = "Vision describing...";
    try {
      const r = await api.inspireFromUpload(song.id, file, seedInput.value.trim());
      if (r.error) toast("Vision: " + r.error.slice(0, 200));
      else {
        state.imagePromptValue = r.prompt;
        state.lastInspireSource = file.name;
        imgPromptText.textContent = r.prompt;
        imgPromptSummary.textContent = `Visual reference loaded (${r.model_version}) — folded into Enhance`;
        toast("Visual reference captured");
      }
    } catch (e) { toast("Failed: " + e.message); }
    inspireDrop.classList.remove("loading");
    inspireDrop.textContent = "Drop an image here, or click to pick.";
  }

  async function runInspireUrl(url) {
    if (!url) { toast("Paste a URL"); return; }
    urlBtn.disabled = true; urlBtn.textContent = "Fetching...";
    try {
      const r = await api.inspireFromUrl(song.id, url, seedInput.value.trim());
      if (r.error) toast("Vision: " + r.error.slice(0, 200));
      else {
        state.imagePromptValue = r.prompt;
        state.lastInspireSource = new URL(url).hostname;
        imgPromptText.textContent = r.prompt;
        imgPromptSummary.textContent = `Visual reference loaded (${r.model_version}) — folded into Enhance`;
        toast("Visual reference captured");
      }
    } catch (e) { toast("Failed: " + e.message); }
    urlBtn.disabled = false; urlBtn.textContent = "From URL";
  }
}

function buildSeedPrompt(song) {
  const parts = [];
  parts.push(`A music video visual for "${song.title}".`);
  if (song.genre) parts.push(`Genre cues: ${song.genre}.`);
  if (song.lyrics?.length) {
    const top = song.lyrics.slice(0, 6).map((l) => l.text).join(" / ");
    parts.push(`Lyric mood: ${top}.`);
  }
  if (song.prompt) parts.push(`Suno prompt: ${song.prompt.slice(0, 240)}.`);
  parts.push("Cinematic, high detail, 16:9, atmospheric lighting.");
  return parts.join(" ");
}
