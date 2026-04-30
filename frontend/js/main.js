import { api } from "./api.js";
import { renderHome } from "./views/home.js";
import { renderWatch } from "./views/watch.js";
import { renderAssets } from "./views/assets.js";
import { fmtAccount, debounce, toast } from "./util.js";
import { bindThemePopover } from "./theme.js";

async function loadChannels() {
  const list = document.getElementById("channel-list");
  const countEl = document.getElementById("drawer-channels-n");
  list.innerHTML = "";
  try {
    const channels = await api.channels();
    if (countEl) countEl.textContent = String(channels.length);
    const all = document.createElement("a");
    all.href = "#/";
    all.innerHTML = `<span class="count">${channels.reduce((a, c) => a + c.song_count, 0).toLocaleString()}</span>All`;
    list.append(all);
    for (const c of channels) {
      const a = document.createElement("a");
      a.href = `#/channel/${encodeURIComponent(c.account)}`;
      a.dataset.account = c.account;
      a.innerHTML = `<span class="count">${c.song_count.toLocaleString()}</span>${fmtAccount(c.account)}`;
      list.append(a);
    }
  } catch (e) {
    list.innerHTML = `<div class="muted">Failed to load channels: ${e.message}</div>`;
  }
}

async function loadAssetFolders() {
  const list = document.getElementById("asset-folder-list");
  const countEl = document.getElementById("drawer-folders-n");
  list.innerHTML = "";
  try {
    const folders = await api.assetFolders();
    if (countEl) countEl.textContent = String(folders.length);
    if (!folders.length) {
      list.innerHTML = `<div class="muted" style="padding:6px 10px">Drop into <code>myspot/assets/</code> and re-index.</div>`;
      return;
    }
    for (const f of folders) {
      const a = document.createElement("a");
      a.dataset.folder = f.folder;
      const label = f.folder === "_gens" ? "📁 Gens (output)" : f.folder;
      a.href = `#/assets/${encodeURIComponent(f.folder)}`;
      a.innerHTML = `<span class="count">${f.n.toLocaleString()}</span>${label}`;
      a.onclick = async (e) => {
        // If we're on the watch page, hijack the click and update the bottom tray instead
        const onWatch = location.hash.startsWith("#/song/");
        if (onWatch) {
          e.preventDefault();
          try {
            const mod = await import("./views/watch.js");
            if (mod.setTrayFolder) await mod.setTrayFolder(f.folder);
          } catch { /* fall through to normal nav */ }
        }
        // Otherwise let the link navigate to /assets/<folder>
      };
      list.append(a);
    }
  } catch { /* ignore */ }
}

async function loadSmartTags() {
  const list = document.getElementById("smart-tag-list");
  const countEl = document.getElementById("drawer-smart-n");
  if (!list) return;
  list.innerHTML = "";
  try {
    const tags = await api.smartTags();
    const non_zero = tags.filter((t) => t.n > 0);
    if (countEl) countEl.textContent = String(non_zero.length);
    if (!non_zero.length) {
      list.innerHTML = `<div class="muted" style="padding:6px 10px">No songs match yet — pattern detection is title-based.</div>`;
      return;
    }
    for (const t of non_zero) {
      const a = document.createElement("a");
      a.href = `#/tag/${encodeURIComponent(t.tag)}`;
      a.dataset.tag = t.tag;
      const emoji =
        t.tag === "live" ? "🎤" :
        t.tag === "acoustic" ? "🎸" :
        t.tag === "remix" ? "🎛️" :
        t.tag === "instrumental" ? "🎼" :
        t.tag === "demo" ? "🪞" :
        t.tag === "cover" ? "🔁" :
        t.tag === "remastered" ? "✨" : "🏷️";
      a.innerHTML = `<span class="count">${t.n.toLocaleString()}</span>${emoji} ${t.tag.toUpperCase()}`;
      list.append(a);
    }
  } catch { /* ignore */ }
}

async function loadStats() {
  try {
    const s = await api.stats();
    document.getElementById("topbar-stats").textContent =
      `${s.songs.toLocaleString()} songs · ${s.assets.toLocaleString()} assets · ${s.relationships.toLocaleString()} rels`;
  } catch { /* ignore */ }
}

function highlightActiveChannel(account) {
  const list = document.getElementById("channel-list");
  list.querySelectorAll("a").forEach((a) => a.classList.toggle(
    "active",
    (a.dataset.account || "") === (account || "")
  ));
}

async function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const parts = hash.split("/").filter(Boolean);
  if (parts.length === 0) {
    highlightActiveChannel(null);
    await renderHome();
  } else if (parts[0] === "channel" && parts[1]) {
    const account = decodeURIComponent(parts[1]);
    highlightActiveChannel(account);
    await renderHome({ account });
  } else if (parts[0] === "song" && parts[1]) {
    highlightActiveChannel(null);
    await renderWatch(parseInt(parts[1], 10));
  } else if (parts[0] === "search" && parts[1]) {
    await renderHome({ q: decodeURIComponent(parts[1]) });
  } else if (parts[0] === "tag" && parts[1]) {
    highlightActiveChannel(null);
    await renderHome({ tag: decodeURIComponent(parts[1]) });
  } else if (parts[0] === "assets") {
    const folder = parts[1] ? decodeURIComponent(parts[1]) : null;
    await renderAssets({ folder });
  } else {
    await renderHome();
  }
}

function bindHelp() {
  const overlay = document.getElementById("help-overlay");
  const close = () => overlay.hidden = true;
  document.getElementById("help-close").onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  document.addEventListener("keydown", (e) => {
    const t = document.activeElement;
    const inInput = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (e.key === "?" && !inInput) {
      e.preventDefault();
      overlay.hidden = !overlay.hidden;
    } else if (e.key === "Escape" && !overlay.hidden) {
      e.preventDefault();
      close();
    }
  });
}

function bindGlobal() {
  document.getElementById("btn-menu").onclick = () => {
    document.getElementById("sidedrawer").classList.toggle("hidden");
  };
  document.getElementById("btn-reindex").onclick = async () => {
    if (!confirm("Re-scan suno_library/ and assets/? Takes ~2 minutes.")) return;
    try {
      await api.reindex();
      toast("Re-index started in background");
      const interval = setInterval(async () => {
        const s = await api.reindexStatus();
        if (!s.running) {
          clearInterval(interval);
          toast("Re-index complete");
          loadStats(); loadChannels(); loadAssetFolders();
        }
      }, 2000);
    } catch (e) { toast("Reindex failed: " + e.message); }
  };

  const search = document.getElementById("search");
  const onSearch = debounce(() => {
    const v = search.value.trim();
    if (v) location.hash = `#/search/${encodeURIComponent(v)}`;
    else location.hash = "#/";
  }, 350);
  search.addEventListener("input", onSearch);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onSearch();
  });
}

function bindApiPopover() {
  const btn = document.getElementById("btn-api");
  const pop = document.getElementById("api-pop");
  const input = document.getElementById("api-url-input");
  const current = document.getElementById("api-current");

  btn.onclick = () => {
    const stored = localStorage.getItem("myspot_api_base") || "";
    input.value = stored;
    current.textContent = stored ? `Active: ${stored}` : "Local mode (same-origin)";
    pop.hidden = !pop.hidden;
  };

  document.getElementById("api-save").onclick = () => {
    const v = input.value.trim().replace(/\/$/, "");
    if (v) localStorage.setItem("myspot_api_base", v);
    else localStorage.removeItem("myspot_api_base");
    location.reload();
  };

  document.getElementById("api-clear").onclick = () => {
    localStorage.removeItem("myspot_api_base");
    location.reload();
  };

  document.addEventListener("click", (e) => {
    if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true;
  });
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", async () => {
  bindGlobal();
  bindHelp();
  bindThemePopover();
  bindApiPopover();
  await Promise.all([loadChannels(), loadAssetFolders(), loadSmartTags(), loadStats()]);
  await route();
});
