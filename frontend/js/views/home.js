import { api, mediaUrl } from "../api.js";
import { fmtDuration, fmtAccount, el, clear } from "../util.js";

const PAGE = 60;

export async function renderHome({ account = null, q = null } = {}) {
  const view = document.getElementById("view");
  clear(view);
  const tpl = document.getElementById("tpl-home").content.cloneNode(true);
  view.append(tpl);

  const titleEl = document.getElementById("home-title");
  if (q) titleEl.textContent = `Search: ${q}`;
  else if (account) titleEl.textContent = fmtAccount(account);
  else titleEl.textContent = "Recent";

  const grid = document.getElementById("grid");
  const status = document.getElementById("grid-status");
  const more = document.getElementById("btn-more");
  const sortSel = document.getElementById("home-sort");
  let sort = sortSel.value;
  let offset = 0;
  let total = 0;

  async function loadPage(reset = false) {
    if (reset) { clear(grid); offset = 0; }
    status.textContent = "Loading...";
    const data = await api.songs({ account, q, limit: PAGE, offset, sort });
    total = data.total;
    for (const s of data.items) grid.append(card(s));
    offset += data.items.length;
    status.textContent = `${offset.toLocaleString()} / ${total.toLocaleString()}`;
    more.disabled = offset >= total;
    more.textContent = offset >= total ? "All loaded" : "Load more";
  }

  more.onclick = () => loadPage(false);
  sortSel.onchange = () => { sort = sortSel.value; loadPage(true); };

  await loadPage(true);
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
  if (s.jpg_path) img.src = mediaUrl.cover(s.id); else img.removeAttribute("src");
  img.alt = s.title || "";
  if (s.version > 1) verBadge.textContent = `v${s.version}`; else verBadge.remove();
  durBadge.textContent = fmtDuration(s.duration);
  titleEl.textContent = s.title;
  const subParts = [fmtAccount(s.account)];
  if (s.play_count) subParts.push(`${s.play_count} plays`);
  if (s.gens_count) subParts.push(`${s.gens_count} gens`);
  if (s.lyric_count) subParts.push(`${s.lyric_count} lines`);
  if (s.has_cache) subParts.push("✓ cache");
  subEl.textContent = subParts.join(" · ");
  if (s.liked) {
    const liked = article.querySelector(".card-liked");
    if (liked) liked.hidden = false;
  }

  return article;
}
