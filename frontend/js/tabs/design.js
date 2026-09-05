import { el, clear } from "../util.js";

const STORE_KEY = "myspot.design.v1";

const FONTS = [
  { id: "grotesk",  label: "Space Grotesk — modern",    css: "var(--font-grotesk)" },
  { id: "display",  label: "Pixelify — pixel display",  css: "var(--font-display)" },
  { id: "pixel",    label: "VT323 — pixel terminal",    css: "var(--font-pixel)" },
  { id: "roboto",   label: "Roboto — clean & readable", css: "var(--font-roboto)" },
  { id: "nunito",   label: "Nunito — rounded friendly", css: "var(--font-nunito)" },
  { id: "playfair", label: "Playfair — elegant serif",  css: "var(--font-playfair)" },
  { id: "bebas",    label: "Bebas Neue — bold caps",    css: "var(--font-bebas)" },
  { id: "script",   label: "Dancing Script — handwritten", css: "var(--font-script)" },
  { id: "body",     label: "Inter — system sans",       css: "var(--font-body)" },
  { id: "mono",     label: "Mono — terminal",           css: "var(--font-mono)" },
];

const PLACEMENTS = [
  { id: "overlay-bottom", label: "Overlay — lower" },
  { id: "overlay-top",    label: "Overlay — upper" },
  { id: "below",          label: "Below the video" },
];

const COLOR_PRESETS = [
  { label: "White",      value: "#ffffff" },
  { label: "Black",      value: "#000000" },
  { label: "Yellow",     value: "#ffff00" },
  { label: "Gold",       value: "#ffd700" },
  { label: "Cyan",       value: "#00ffff" },
  { label: "Hot pink",   value: "#ff69b4" },
  { label: "Orange",     value: "#ff8c00" },
  { label: "Neon green", value: "#39ff14" },
  { label: "Sky blue",   value: "#87ceeb" },
  { label: "Lavender",   value: "#c9aaff" },
];

const DEFAULTS = {
  font: "grotesk",
  fontSize: 40,
  placement: "overlay-bottom",
  color: "",   // "" = white
};

function load(songId) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return { ...DEFAULTS, ...(all[songId] || {}) };
  } catch { return { ...DEFAULTS }; }
}

function save(songId, settings) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    all[songId] = settings;
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

export function applyDesignSettings(songId) {
  const overlay = document.getElementById("lyric-overlay");
  if (!overlay) return;
  const s = load(songId);

  const fontDef = FONTS.find((f) => f.id === s.font) || FONTS[0];
  overlay.style.setProperty("--lyric-font", fontDef.css);
  overlay.style.setProperty("--lyric-size", `${s.fontSize || 40}px`);
  overlay.style.setProperty("--lyric-color", s.color || "#ffffff");

  for (const p of PLACEMENTS) overlay.classList.remove(`placement-${p.id}`);
  overlay.classList.add(`placement-${s.placement || "overlay-bottom"}`);

  const stageHost = document.querySelector(".player-stage");
  const belowHost = document.getElementById("lyric-strip-host");
  if (s.placement === "below" && belowHost && overlay.parentNode !== belowHost) {
    belowHost.append(overlay);
  } else if (s.placement !== "below" && stageHost && overlay.parentNode !== stageHost) {
    stageHost.append(overlay);
  }
}

// Color swatch row builder
function renderColorRow(label, presets, currentVal, onChange) {
  const row = el("div", { class: "design-color-row" });
  const lbl = el("span", { class: "design-color-label" }, label);
  const swatches = el("div", { class: "design-swatches" });

  // Theme/accent swatch (value = "")
  const themeSw = el("button", { type: "button", class: "swatch-btn", title: "White" });
  themeSw.style.background = "#ffffff";
  themeSw.style.border = "2px dashed var(--ink)";
  themeSw.onclick = () => { onChange(""); markActive(""); };
  swatches.append(themeSw);

  for (const p of presets) {
    const sw = el("button", { type: "button", class: "swatch-btn", title: p.label });
    sw.style.background = p.value;
    if (p.value === "#000000") sw.style.border = "2px solid #555";
    sw.onclick = () => { onChange(p.value); markActive(p.value); };
    sw.dataset.val = p.value;
    swatches.append(sw);
  }

  // Custom picker at end
  const custom = el("input", { type: "color", class: "swatch-custom",
    value: currentVal || "#ffffff", title: "Custom color" });
  custom.oninput = () => { onChange(custom.value); markActive(custom.value); };
  swatches.append(custom);

  function markActive(val) {
    swatches.querySelectorAll(".swatch-btn").forEach((b) => b.classList.remove("active"));
    if (!val) { themeSw.classList.add("active"); return; }
    const match = [...swatches.querySelectorAll(".swatch-btn[data-val]")]
      .find((b) => b.dataset.val === val);
    if (match) match.classList.add("active");
    custom.value = val || "#ffffff";
  }
  markActive(currentVal);

  row.append(lbl, swatches);
  return row;
}

export function renderDesign(body, song) {
  clear(body);
  const settings = load(song.id);

  body.append(el("p", { class: "muted small", style: "margin-bottom:10px" },
    "Karaoke shows one lyric line at a time with a soft blur-morph. Settings save per song."));

  // ── Font ──────────────────────────────────────────────────────
  const fontSection = el("section", { class: "gen-section" });
  fontSection.append(el("h5", { class: "section-h" }, "Font"));
  const fontSel = el("select", { class: "compact" });
  for (const f of FONTS) {
    const o = el("option", { value: f.id }, f.label);
    if (f.id === settings.font) o.selected = true;
    fontSel.append(o);
  }
  fontSel.onchange = () => { settings.font = fontSel.value; persist(); };
  fontSection.append(fontSel);

  const sizeRow = el("div", { class: "design-slider-row" });
  const sizeLabel = el("span", { class: "design-slider-label" }, `Size: ${settings.fontSize}px`);
  const sizeSlider = el("input", { type: "range", min: "18", max: "80", step: "1", value: String(settings.fontSize) });
  sizeSlider.oninput = () => {
    settings.fontSize = parseInt(sizeSlider.value, 10);
    sizeLabel.textContent = `Size: ${settings.fontSize}px`;
    persist();
  };
  sizeRow.append(sizeLabel, sizeSlider);
  fontSection.append(sizeRow);
  body.append(fontSection);

  // ── Placement ─────────────────────────────────────────────────
  const placeSection = el("section", { class: "gen-section" });
  placeSection.append(el("h5", { class: "section-h" }, "Placement"));
  const placeSel = el("select", { class: "compact" });
  for (const p of PLACEMENTS) {
    const o = el("option", { value: p.id }, p.label);
    if (p.id === settings.placement) o.selected = true;
    placeSel.append(o);
  }
  placeSel.onchange = () => { settings.placement = placeSel.value; persist(); };
  placeSection.append(placeSel);
  body.append(placeSection);

  // ── Colour ────────────────────────────────────────────────────
  const colorSection = el("section", { class: "gen-section" });
  colorSection.append(el("h5", { class: "section-h" }, "Colour"));
  colorSection.append(
    renderColorRow("Text", COLOR_PRESETS, settings.color,
      (v) => { settings.color = v; persist(); }));
  body.append(colorSection);

  // ── Preview ───────────────────────────────────────────────────
  const preview = el("section", { class: "gen-section design-preview" });
  preview.append(el("h5", { class: "section-h" }, "Preview"));
  const previewFrame = el("div", { class: "design-preview-frame" });
  const previewLine = el("div", { class: "design-preview-line", "data-text": "lyric line preview" }, "lyric line preview");
  previewFrame.append(previewLine);
  preview.append(previewFrame);
  body.append(preview);

  function persist() {
    save(song.id, settings);
    applyDesignSettings(song.id);
    paintPreview();
  }
  function paintPreview() {
    const fontDef = FONTS.find((f) => f.id === settings.font) || FONTS[0];
    previewLine.style.fontFamily = fontDef.css;
    previewLine.style.fontSize = `${Math.min(settings.fontSize, 40)}px`;
    previewLine.style.color = settings.color || "#ffffff";
  }

  persist();
}
