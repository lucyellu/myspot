/**
 * Design / Style tab.
 *
 * Settings persist per song in localStorage and apply live to the karaoke
 * lyric overlay via CSS custom properties + a few class toggles.
 */
import { el, clear, toast } from "../util.js";

const STORE_KEY = "myspot.design.v1";

const FONTS = [
  { id: "display", label: "Pixelify (display)", css: "var(--font-display)" },
  { id: "pixel",   label: "VT323 (pixel)",      css: "var(--font-pixel)" },
  { id: "body",    label: "Inter (clean)",      css: "var(--font-body)" },
  { id: "mono",    label: "Mono (terminal)",    css: "var(--font-mono)" },
];

const PLACEMENTS = [
  { id: "overlay-bottom", label: "Overlay — lower" },
  { id: "overlay-top",    label: "Overlay — upper" },
  { id: "below",          label: "Below the video" },
];

const EFFECTS = [
  { id: "fill",    label: "Text fill (karaoke)",   help: "Active line fills left-to-right as it plays." },
  { id: "glow",    label: "Neon glow",             help: "Soft hue-tinted halo behind active line." },
  { id: "outline", label: "Outline-only active",   help: "Active line drawn as bold outline." },
  { id: "bounce",  label: "Bounce on line change", help: "Subtle bump when the active line advances." },
  { id: "scrim",   label: "Dark scrim band",       help: "Translucent backdrop for legibility on busy art." },
];

const DEFAULTS = {
  font: "display",
  fontSize: 32,           // px
  placement: "overlay-bottom",
  color: "",              // "" = use --accent
  fillFrom: "",           // "" = use --accent
  fillTo: "",             // "" = use --accent-2
  effects: ["fill", "glow", "scrim"],
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

/**
 * Apply settings to the live lyric-overlay element.
 *
 * Placement is handled by moving the overlay between two host containers:
 *   - .player-stage (overlay-top / overlay-bottom)
 *   - .lyric-strip-host directly below the player (below)
 * Both hosts exist in the watch template; this just toggles which one
 * actually contains the lyric-overlay element + the placement class.
 */
export function applyDesignSettings(songId) {
  const overlay = document.getElementById("lyric-overlay");
  if (!overlay) return;
  const s = load(songId);

  const fontDef = FONTS.find((f) => f.id === s.font) || FONTS[0];
  overlay.style.setProperty("--lyric-font", fontDef.css);
  overlay.style.setProperty("--lyric-size", `${s.fontSize || 32}px`);
  overlay.style.setProperty("--lyric-color", s.color || "var(--accent)");
  overlay.style.setProperty("--lyric-fill-a", s.fillFrom || "var(--accent)");
  overlay.style.setProperty("--lyric-fill-b", s.fillTo || "var(--accent-2)");

  for (const e of EFFECTS) {
    overlay.classList.toggle(`fx-${e.id}`, (s.effects || []).includes(e.id));
  }

  // Placement — move into the matching host
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

export function renderDesign(body, song) {
  clear(body);
  const settings = load(song.id);

  body.append(el("p", { class: "muted small", style: "margin-bottom:10px" },
    "Style the karaoke lyric overlay on the player. Settings save per song."));

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

  // Font size slider
  const sizeRow = el("div", { class: "design-slider-row" });
  const sizeLabel = el("span", { class: "design-slider-label" }, `Size: ${settings.fontSize}px`);
  const sizeSlider = el("input", { type: "range", min: "14", max: "72", step: "1", value: String(settings.fontSize) });
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

  // ── Colors ────────────────────────────────────────────────────
  const colorSection = el("section", { class: "gen-section" });
  colorSection.append(el("h5", { class: "section-h" }, "Colors"));
  colorSection.append(el("p", { class: "muted small", style: "margin: -4px 0 8px" },
    "Empty = inherit theme accent."));

  const baseColor = el("input", { type: "color", value: settings.color || "#c8e85f" });
  const baseClear = el("button", { class: "btn small-btn", type: "button" }, "Reset");
  const fillA = el("input", { type: "color", value: settings.fillFrom || "#c8e85f" });
  const fillAClear = el("button", { class: "btn small-btn", type: "button" }, "Reset");
  const fillB = el("input", { type: "color", value: settings.fillTo || "#ff7a4a" });
  const fillBClear = el("button", { class: "btn small-btn", type: "button" }, "Reset");

  baseColor.onchange = () => { settings.color = baseColor.value; persist(); };
  baseClear.onclick = () => {
    settings.color = ""; baseColor.value = "#c8e85f"; persist();
    toast("Reset base color");
  };
  fillA.onchange = () => { settings.fillFrom = fillA.value; persist(); };
  fillAClear.onclick = () => { settings.fillFrom = ""; fillA.value = "#c8e85f"; persist(); };
  fillB.onchange = () => { settings.fillTo = fillB.value; persist(); };
  fillBClear.onclick = () => { settings.fillTo = ""; fillB.value = "#ff7a4a"; persist(); };

  colorSection.append(
    el("div", { class: "design-color-row" },
      el("span", { class: "design-color-label" }, "Base text"), baseColor, baseClear),
    el("div", { class: "design-color-row" },
      el("span", { class: "design-color-label" }, "Fill from"), fillA, fillAClear),
    el("div", { class: "design-color-row" },
      el("span", { class: "design-color-label" }, "Fill to"), fillB, fillBClear),
  );
  body.append(colorSection);

  // ── Effects ───────────────────────────────────────────────────
  const fxSection = el("section", { class: "gen-section" });
  fxSection.append(el("h5", { class: "section-h" }, "Effects"));
  for (const e of EFFECTS) {
    const row = el("label", { class: "design-fx-row" });
    const cb = el("input", { type: "checkbox" });
    cb.checked = (settings.effects || []).includes(e.id);
    cb.onchange = () => {
      const cur = new Set(settings.effects || []);
      if (cb.checked) cur.add(e.id); else cur.delete(e.id);
      settings.effects = [...cur];
      persist();
    };
    row.append(cb,
      el("span", { class: "design-fx-name" }, e.label),
      el("span", { class: "muted small design-fx-help" }, e.help));
    fxSection.append(row);
  }
  body.append(fxSection);

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
    previewLine.style.fontSize = `${settings.fontSize}px`;
    previewLine.style.color = settings.color || "var(--accent)";
    previewLine.style.setProperty("--lyric-fill-a", settings.fillFrom || "var(--accent)");
    previewLine.style.setProperty("--lyric-fill-b", settings.fillTo || "var(--accent-2)");
    for (const e of EFFECTS) {
      previewLine.classList.toggle(`fx-${e.id}`, (settings.effects || []).includes(e.id));
    }
  }

  persist();
}
