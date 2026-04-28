/**
 * Theme controller — hue/sat/lig + dark mode toggle.
 *
 * Persists in localStorage. Applied as inline style on <html> (CSS custom
 * properties --hue/--sat/--lig) plus data-theme="dark|light" attribute.
 */

const STORE_KEY = "myspot.theme.v1";

const PRESETS = [
  { name: "sage",   hue: 80,  sat: 25, lig: 60 },
  { name: "rose",   hue: 350, sat: 30, lig: 65 },
  { name: "amber",  hue: 38,  sat: 50, lig: 62 },
  { name: "yellow", hue: 48,  sat: 65, lig: 70 },
  { name: "teal",   hue: 175, sat: 30, lig: 55 },
  { name: "violet", hue: 270, sat: 25, lig: 60 },
  { name: "slate",  hue: 220, sat: 12, lig: 55 },
];

const DEFAULTS = { ...PRESETS[0], dark: false };

function loadTheme() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

function saveTheme(t) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(t)); } catch { /* ignore */ }
}

function applyTheme(t) {
  const root = document.documentElement;
  root.style.setProperty("--hue", String(t.hue));
  root.style.setProperty("--sat", `${t.sat}%`);
  // Both modes use the same light bg — contrast mode only swaps black ink/
  // borders/panels for a dark hue-tinted shade. So --lig is always honored.
  root.style.setProperty("--lig", `${t.lig}%`);
  root.setAttribute("data-theme", t.dark ? "dark" : "light");
}

let _t = loadTheme();
applyTheme(_t);

export function getTheme() { return { ..._t }; }

export function setTheme(patch) {
  _t = { ..._t, ...patch };
  applyTheme(_t);
  saveTheme(_t);
}

export function bindThemePopover() {
  const btn = document.getElementById("btn-theme");
  const pop = document.getElementById("theme-pop");
  const hue = document.getElementById("theme-hue");
  const sat = document.getElementById("theme-sat");
  const lig = document.getElementById("theme-lig");
  const swatch = document.getElementById("theme-swatch");
  const presetsRow = document.getElementById("theme-presets");
  const toggle = document.getElementById("theme-toggle-mode");
  const reset = document.getElementById("theme-reset");
  if (!btn || !pop) return;

  // Build preset buttons
  presetsRow.innerHTML = "";
  for (const p of PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.title = p.name;
    b.style.background = `hsl(${p.hue}, ${p.sat}%, ${p.lig}%)`;
    b.onclick = () => {
      hue.value = p.hue; sat.value = p.sat; lig.value = p.lig;
      setTheme({ hue: p.hue, sat: p.sat, lig: p.lig });
      updateSwatch();
    };
    presetsRow.append(b);
  }

  function updateSwatch() {
    swatch.style.background = `hsl(${hue.value}, ${sat.value}%, ${lig.value}%)`;
  }
  function syncFromState() {
    hue.value = _t.hue; sat.value = _t.sat; lig.value = _t.lig;
    // Renamed from "DARK MODE" — the user thinks of this as a contrast boost
    // toggle, not a light/dark distinction.
    toggle.textContent = _t.dark ? "NORMAL MODE" : "CONTRAST MODE";
    updateSwatch();
  }

  btn.onclick = (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    if (!pop.hidden) syncFromState();
  };
  document.addEventListener("click", (e) => {
    if (pop.hidden) return;
    if (e.target === btn || pop.contains(e.target)) return;
    pop.hidden = true;
  });

  hue.oninput = () => { setTheme({ hue: +hue.value }); updateSwatch(); };
  sat.oninput = () => { setTheme({ sat: +sat.value }); updateSwatch(); };
  lig.oninput = () => { setTheme({ lig: +lig.value }); updateSwatch(); };

  toggle.onclick = () => {
    setTheme({ dark: !_t.dark });
    toggle.textContent = _t.dark ? "NORMAL MODE" : "CONTRAST MODE";
  };
  reset.onclick = () => {
    setTheme({ ...DEFAULTS });
    syncFromState();
  };
}
