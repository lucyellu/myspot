import { api, mediaUrl } from "../api.js";
import { fmtDuration, fmtAccount, channelColor, el, clear } from "../util.js";
import { playSongNow, setPlaylistContext, appendPlaylistSongs } from "../player.js";

const PAGE = 60;

// Persisted view state — density (px min-col width) + grid/list mode.
const STORE_KEY = "myspot.home.v1";
const DEFAULTS = { size: 110, view: "grid", sort: "recent" };
function loadHomePrefs() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE_KEY) || "{}")) }; }
  catch { return { ...DEFAULTS }; }
}
function saveHomePrefs(p) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export async function renderHome({ account = null, q = null, tag = null, has_video = false } = {}) {
  const view = document.getElementById("view");
  clear(view);
  const tpl = document.getElementById("tpl-home").content.cloneNode(true);
  view.append(tpl);

  let videoOnly = Boolean(has_video);
  const titleEl = document.getElementById("home-title");
  const updateTitle = () => {
    let base = "ALL CHANNELS";
    if (q) base = `Search: ${q}`;
    else if (tag) base = `🎤 ${tag.toUpperCase()}`;
    else if (account) base = fmtAccount(account).toUpperCase();
    else if (videoOnly && !account && !q && !tag) base = "VIDEOS 🎬";

    if (videoOnly && (account || q || tag)) {
      titleEl.textContent = `${base} · VIDEOS 🎬`;
    } else {
      titleEl.textContent = base;
    }
    return titleEl.textContent;
  };
  let contextName = updateTitle();

  const grid = document.getElementById("grid");
  const status = document.getElementById("grid-status");
  const more = document.getElementById("btn-more");
  const sortSel = document.getElementById("home-sort");
  const sizeSel = document.getElementById("home-size");
  const viewBtns = document.querySelectorAll(".view-btn");
  const videoFilterBtn = document.getElementById("home-filter-video");

  if (videoFilterBtn) {
    videoFilterBtn.classList.toggle("active", videoOnly);
    videoFilterBtn.onclick = () => {
      videoOnly = !videoOnly;
      videoFilterBtn.classList.toggle("active", videoOnly);
      contextName = updateTitle();
      loadPage(true);
    };
  }

  // Hydrate size + view-mode + sort from localStorage
  const prefs = loadHomePrefs();

  // Default sort is RECENT everywhere. A persisted choice wins, but only if it
  // is still one of the options this build offers.
  const wanted = [...sortSel.options].some(o => o.value === prefs.sort)
    ? prefs.sort
    : DEFAULTS.sort;
  sortSel.value = wanted;
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
  let loadedSongs = [];

  const dirBtn = document.getElementById("btn-sort-dir");
  const updateDirBtn = () => { dirBtn.textContent = dir === "desc" ? "↓" : "↑"; };
  dirBtn.onclick = () => { dir = dir === "desc" ? "asc" : "desc"; updateDirBtn(); loadPage(true); };

  async function loadPage(reset = false) {
    if (reset) { clear(grid); offset = 0; loadedSongs = []; }
    status.textContent = "Loading...";
    const data = await api.songs({
      account,
      q,
      tag,
      has_video: videoOnly ? true : null,
      limit: PAGE,
      offset,
      sort,
      dir,
    });
    total = data.total;
    const query = { account, q, tag, has_video: videoOnly ? true : null, sort, dir, total };

    for (const s of data.items) {
      loadedSongs.push(s);
      grid.append(card(s, () => loadedSongs, query, contextName));
    }
    offset += data.items.length;
    appendPlaylistSongs(data.items, { total });

    status.textContent = `${offset.toLocaleString()} / ${total.toLocaleString()}`;
    more.disabled = offset >= total;
    more.textContent = offset >= total ? "ALL LOADED" : "LOAD MORE";
  }

  more.onclick = () => loadPage(false);
  sortSel.onchange = () => {
    sort = sortSel.value;
    prefs.sort = sort;
    saveHomePrefs(prefs);
    loadPage(true);
  };

  await loadPage(true);

  // Add a "RECENT ASSETS" strip at the bottom of the home view so users can
  // navigate songs + assets in one place.
  if (!q && !account && !videoOnly) {
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

export function card(s, getPlaylist = null, query = null, contextName = "") {
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

  const onPick = () => {
    const list = getPlaylist ? getPlaylist() : [s];
    setPlaylistContext({ playlist: list, song: s, query, contextName });
  };
  thumb.onclick = onPick;
  titleEl.onclick = onPick;

  const c = channelColor(s.account);
  thumb.style.background = `linear-gradient(150deg, ${c}3 0%, ${c}9 100%)`;

  const hasImage = Boolean(s.jpg_path || s.video_only);
  if (hasImage) {
    img.style.display = "";
    img.src = mediaUrl.cover(s.id);
    const markLowres = () => {
      if (img.naturalWidth && img.naturalWidth < 200) {
        img.classList.add("lowres");
        thumb.classList.add("lowres");
      }
    };
    if (img.complete) markLowres();
    else img.addEventListener("load", markLowres, { once: true });
    img.onerror = () => {
      img.style.display = "none";
    };
  } else {
    img.style.display = "none";
    img.removeAttribute("src");
  }
  img.alt = s.title || "";

  const quick = el("button", {
    class: "card-quick-play",
    type: "button",
    title: "Play without leaving this view",
    "aria-label": `Play ${s.title || "song"}`,
  }, "▶");
  quick.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onPick();
    playSongNow(s);
  };
  thumb.append(quick);
  if (s.version > 1) verBadge.textContent = `v${s.version}`; else verBadge.remove();
  durBadge.textContent = fmtDuration(s.duration);
  titleEl.textContent = s.title;
  const dot = article.querySelector(".card-dot");
  if (dot) {
    dot.style.background = channelColor(s.account);
    dot.title = fmtAccount(s.account);
  }
  const subParts = [];
  if (s.suno_play_count) subParts.push(`${s.suno_play_count.toLocaleString()} ♫`);
  if (s.suno_upvote_count) subParts.push(`${s.suno_upvote_count} ♥`);
  if (s.gens_count) subParts.push(`${s.gens_count} gens`);
  // append as text node to keep the dot span sibling intact
  subEl.append(document.createTextNode(subParts.join(" · ")));
  if (s.liked) {
    const liked = article.querySelector(".card-liked");
    if (liked) liked.hidden = false;
  }
  const videoBadge = article.querySelector(".card-video-badge");
  if (videoBadge) {
    if (s.video_only) {
      videoBadge.textContent = "mp4";
      videoBadge.title = "No mp3 — playing from video render";
      videoBadge.hidden = false;
    } else if (s.has_video || s.video_path) {
      videoBadge.textContent = "🎬";
      videoBadge.title = "Video track";
      videoBadge.hidden = false;
    } else {
      videoBadge.hidden = true;
    }
  }

  return article;
}
