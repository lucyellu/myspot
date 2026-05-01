import { api, mediaUrl } from "../api.js";
import { el, clear, toast } from "../util.js";

const PAGE = 120;

export async function renderAssets({ folder = null } = {}) {
  const view = document.getElementById("view");
  clear(view);

  const wrap = el("section", { class: "home" });
  view.append(wrap);

  const header = el("div", { class: "home-header" });
  const isGens = folder === "_gens";
  header.append(el("h1", {}, isGens ? "Gens (output folder)" : (folder ? `Assets · ${folder}` : "Assets")));
  wrap.append(header);

  const grid = el("div", { class: "grid" });
  wrap.append(grid);

  const footer = el("div", { class: "grid-footer" });
  const more = el("button", { class: "btn" }, "Load more");
  const status = el("span", { class: "muted" }, "");
  footer.append(more, status);
  wrap.append(footer);

  let offset = 0;
  let total = 0;

  async function loadPage(reset = false) {
    if (reset) { clear(grid); offset = 0; }
    status.textContent = "Loading...";
    let items = [];
    if (isGens) {
      const data = await api.gensBrowse({ limit: PAGE, offset });
      total = data.total;
      items = data.items.map((g) => ({
        kind: g.kind, src: mediaUrl.gen(g.id),
        title: g.song_title, sub: `${g.tool} • #${g.song_id}`,
        href: `#/song/${g.song_id}`,
      }));
    } else {
      const data = await api.assets({ folder, limit: PAGE, offset });
      total = data.total;
      items = data.items.map((a) => ({
        kind: a.kind, src: mediaUrl.asset(a.id),
        title: a.file_path.split("/").pop(),
        sub: [a.folder, a.width && a.height ? `${a.width}×${a.height}` : ""].filter(Boolean).join(" · "),
        attach: a,
      }));
    }
    for (const it of items) grid.append(assetCard(it));
    offset += items.length;
    status.textContent = `${offset.toLocaleString()} / ${total.toLocaleString()}`;
    more.disabled = offset >= total;
    more.textContent = offset >= total ? "All loaded" : "Load more";
  }
  more.onclick = () => loadPage(false);
  await loadPage(true);
}

function assetCard(item) {
  const article = el("article", { class: "card" });
  const thumb = el("a", {
    class: "thumb",
    href: item.href || "#",
    onclick: item.href ? null : (e) => { e.preventDefault(); openPreview(item); },
  });
  if (item.kind === "image") thumb.append(el("img", { loading: "lazy", src: item.src, alt: "" }));
  else thumb.append(el("video", { src: item.src, muted: true, loop: true, playsinline: true, style: "width:100%;height:100%;object-fit:cover;" }));
  thumb.append(el("span", { class: "card-duration" }, item.kind));
  article.append(thumb);

  const body = el("div", { class: "card-body" });
  body.append(el("div", { class: "card-title" }, item.title || ""));
  body.append(el("div", { class: "card-sub" }, item.sub || ""));
  article.append(body);
  return article;
}

function openPreview(item) {
  const overlay = el("div", { class: "preview-overlay" });
  const box = el("div", { class: "preview-box" });

  if (item.kind === "video") {
    box.append(el("video", { src: item.src, controls: true, autoplay: true, loop: true, playsinline: true }));
  } else {
    box.append(el("img", { src: item.src, alt: "" }));
  }

  const footer = el("div", { class: "preview-footer" });

  if (item.attach) {
    const attachBtn = el("button", { class: "btn", type: "button" }, "Attach to song…");
    attachBtn.onclick = () => attachToSong(item.attach, overlay);
    footer.append(attachBtn);
  }

  const closeBtn = el("button", { class: "btn", type: "button" }, "Close");
  closeBtn.onclick = () => overlay.remove();
  footer.append(closeBtn);

  box.append(footer);
  overlay.append(box);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  function onKey(e) {
    if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onKey); }
  }
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("remove", () => document.removeEventListener("keydown", onKey));

  document.body.append(overlay);
}

async function attachToSong(asset, overlay) {
  const q = prompt("Song title or ID to attach to:", "");
  if (!q) return;
  let songId = parseInt(q, 10);
  if (Number.isNaN(songId)) {
    try {
      const data = await api.songs({ q, limit: 1 });
      if (!data.items.length) { toast("No song matched."); return; }
      songId = data.items[0].id;
    } catch (e) { toast("Search failed: " + e.message); return; }
  }
  try {
    await api.attachAsset(songId, asset.id);
    toast("Attached → opening song");
    overlay.remove();
    location.hash = `#/song/${songId}`;
  } catch (e) { toast("Attach failed: " + e.message); }
}
