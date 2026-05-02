import { api, mediaUrl } from "../api.js";
import { fmtDuration, fmtAccount, channelColor, el, clear } from "../util.js";

const PAGE = 60;

// Persisted view state — density (px min-col width) + grid/list mode.
const STORE_KEY = "myspot.home.v1";
const DEFAULTS = { size: 110, view: "grid" };
function loadHomePrefs() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE_KEY) || "{}")) }; }
  catch { return { ...DEFAULTS }; }
}
function saveHomePrefs(p) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export async function renderHome({ account = null, q = null, tag = null } = {}) {
  const view = document.getElementById("view");
  clear(view);
  const tpl = document.getElementById("tpl-home").content.cloneNode(true);
  view.append(tpl);

  const titleEl = document.getElementById("home-title");
  if (q) titleEl.textContent = `Search: ${q}`;
  else if (tag) titleEl.textContent = `🎤 ${tag.toUpperCase()}`;
  else if (account) titleEl.textContent = fmtAccount(account).toUpperCase();
  else titleEl.textContent = "ALL CHANNELS";

  const grid = document.getElementById("grid");
  const status = document.getElementById("grid-status");
  const more = document.getElementById("btn-more");
  const sortSel = document.getElementById("home-sort");
  const sizeSel = document.getElementById("home-size");
  const viewBtns = document.querySelectorAll(".view-btn");

  // Default sort: most-played for top-level, recent for channel/search views
  if (!account && !q && [...sortSel.options].some(o => o.value === "popular")) {
    sortSel.value = "popular";
  }

  // Hydrate size + view-mode from localStorage
  const prefs = loadHomePrefs();
  const applySize = (px) => {
    grid.style.setProperty("--card-min", `${px}px`);
  };
  const applyView = (mode) => {
    grid.classList.toggle("list-mode", mode === "list");
    viewBtns.forEach((b) => b.classList.toggle("active", b.dataset.view === mode));
  };
  if (sizeSel) {
    sizeSel.value = String(prefs.size);
    applySize(prefs.size);
    sizeSel.addEventListener("input", () => {
      const v = parseInt(sizeSel.value, 10);
      applySize(v);
      prefs.size = v;
      saveHomePrefs(prefs);
    });
  }
  applyView(prefs.view);
  viewBtns.forEach((b) => {
    b.onclick = () => {
      prefs.view = b.dataset.view;
      saveHomePrefs(prefs);
      applyView(prefs.view);
    };
  });

  let sort = sortSel.value;
  let dir = "desc";
  let offset = 0;
  let total = 0;

  const dirBtn = document.getElementById("btn-sort-dir");
  const updateDirBtn = () => { dirBtn.textContent = dir === "desc" ? "↓" : "↑"; };
  dirBtn.onclick = () => { dir = dir === "desc" ? "asc" : "desc"; updateDirBtn(); loadPage(true); };

  async function loadPage(reset = false) {
    if (reset) { clear(grid); offset = 0; }
    status.textContent = "Loading...";
    const data = await api.songs({ account, q, tag, limit: PAGE, offset, sort, dir });
    total = data.total;
    for (const s of data.items) grid.append(card(s));
    offset += data.items.length;
    status.textContent = `${offset.toLocaleString()} / ${total.toLocaleString()}`;
    more.disabled = offset >= total;
    more.textContent = offset >= total ? "ALL LOADED" : "LOAD MORE";
  }

  more.onclick = () => loadPage(false);
  sortSel.onchange = () => { sort = sortSel.value; loadPage(true); };

  await loadPage(true);

  // Add a "RECENT ASSETS" strip at the bottom of the home view so users can
  // navigate songs + assets in one place.
  if (!q && !account) {
    await renderAssetsStrip(view);
  }
}

async function renderAssetsStrip(view) {
  let folders = [];
  try { folders = await api.assetFolders(); } catch { return; }
  const realFolders = folders.filter((f) => f.folder !== "_gens");
  if (!realFolders.length) return;

  const wrap = el("section", { class: "home-assets-strip" });
  wrap.append(el("h2", { class: "home-section-h" }, "ASSET FOLDERS"));
  const row = el("div", { class: "home-folder-row" });
  // _gens chip first, then real folders
  const gensChip = el("a", { class: "folder-chip", href: "#/assets/_gens" });
  const gensFolder = folders.find((f) => f.folder === "_gens");
  gensChip.innerHTML = `<strong>📁 GENS</strong><span class="muted small">${(gensFolder?.n || 0).toLocaleString()} files</span>`;
  row.append(gensChip);
  for (const f of realFolders.slice(0, 12)) {
    const a = el("a", { class: "folder-chip", href: `#/assets/${encodeURIComponent(f.folder)}` });
    a.innerHTML = `<strong>${f.folder.slice(0, 28)}</strong><span class="muted small">${f.n.toLocaleString()} files</span>`;
    row.append(a);
  }
  wrap.append(row);
  view.append(wrap);
}

export function card(s) {
  const tpl = document.getElementById("tpl-card").content.cloneNode(true);
  const article = tpl.querySelector(".card");
  const thumb = article.querySelector(".thumb");
  const img = article.querySelector("img");
  const verBadge = article.querySelector(".card-version");
  const durBadge = article.querySelector(".card-duration");
  const titleEl = article.querySelector(".card-title");
  const subEl = article.querySelector(".card-sub");

  const href = `#/song/${s.id}`;
  thumb.href = href;
  titleEl.href = href;
  if (s.jpg_path) {
    img.src = mediaUrl.cover(s.id);
    const markLowres = () => {
      if (img.naturalWidth && img.naturalWidth < 200) {
        img.classList.add("lowres");
        thumb.classList.add("lowres");
      }
    };
    if (img.complete) markLowres();
    else img.addEventListener("load", markLowres, { once: true });
  } else {
    img.removeAttribute("src");
  }
  img.alt = s.title || "";
  if (s.version > 1) verBadge.textContent = `v${s.version}`; else verBadge.remove();
  durBadge.textContent = fmtDuration(s.duration);
  titleEl.textContent = s.title;
  const dot = article.querySelector(".card-dot");
  dot.style.background = channelColor(s.account);
  dot.title = fmtAccount(s.account);
  const subParts = [];
  if (s.suno_play_count) subParts.push(`${s.suno_play_count.toLocaleString()} ♫`);
  if (s.suno_upvote_count) subParts.push(`${s.suno_upvote_count} ♥`);
  if (s.gens_count) subParts.push(`${s.gens_count} gens`);
  subEl.textContent = subParts.join(" · ");
  if (s.liked) {
    const liked = article.querySelector(".card-liked");
    if (liked) liked.hidden = false;
  }

  return article;
}
