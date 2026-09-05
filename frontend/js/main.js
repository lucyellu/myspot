import { api } from "./api.js?v=lyric-export1";
import { renderHome } from "./views/home.js";
import { renderWatch } from "./views/watch.js?v=lyric-export1";
import { renderAssets } from "./views/assets.js";
import { renderRadio } from "./views/radio.js?v=radio-onehour1";
import { renderLiveBoards } from "./views/liveBoards.js?v=liveboards2";
import { fmtAccount, channelColor, debounce, toast } from "./util.js";
import { bindThemePopover } from "./theme.js";
import { initPersistentPlayer } from "./player.js?v=radio-longform1";

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
      const color = channelColor(c.account);
      a.innerHTML = `<span class="channel-dot" style="background:${color}"></span><span class="count">${c.song_count.toLocaleString()}</span>${c.account}`;
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
      a.innerHTML = `<span class="count">${t.n.toLocaleString()}</span>${t.tag.toUpperCase()}`;
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
  } else if (parts[0] === "radio") {
    highlightActiveChannel(null);
    await renderRadio();
  } else if (parts[0] === "search" && parts[1]) {
    await renderHome({ q: decodeURIComponent(parts[1]) });
  } else if (parts[0] === "tag" && parts[1]) {
    highlightActiveChannel(null);
    await renderHome({ tag: decodeURIComponent(parts[1]) });
  } else if (parts[0] === "assets") {
    const folder = parts[1] ? decodeURIComponent(parts[1]) : null;
    await renderAssets({ folder });
  } else if (parts[0] === "live-boards") {
    highlightActiveChannel(null);
    const id = parts[1] ? decodeURIComponent(parts.slice(1).join("/")) : null;
    await renderLiveBoards({ id });
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
  const radioLink = document.getElementById("topbar-radio");
  if (radioLink) radioLink.onclick = () => { location.hash = "#/radio"; };
  bindDrawerResize();
  document.getElementById("btn-reindex").onclick = async () => {
    if (!confirm("Re-scan suno_library/ and assets/? Takes ~2 minutes.")) return;
    try {
      await api.reindex();
      toast("Re-index started in background");
      const interval = setInterval(async () => {
        const s = await api.reindexStatus();
        if (!s.running) {
          clearInterval(interval);
          toast("Re-index complete — computing audio fingerprints...");
          api.fingerprintAll().catch(() => {});
          loadStats(); loadChannels(); loadAssetFolders();
        }
      }, 2000);
    } catch (e) { toast("Reindex failed: " + e.message); }
  };

  document.getElementById("btn-fingerprint").onclick = async () => {
    try {
      const r = await api.fingerprintAll();
      toast(`Fingerprinting ${r.pending} songs in background…`);
    } catch (e) { toast("Fingerprint failed: " + e.message); }
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

function bindDrawerResize() {
  const drawer = document.getElementById("sidedrawer");
  const handle = document.getElementById("drawer-resize");
  if (!drawer || !handle) return;
  const saved = localStorage.getItem("myspot.drawer.width");
  if (saved) document.documentElement.style.setProperty("--drawer-w", `${Math.max(180, Math.min(420, Number(saved)))}px`);
  handle.onpointerdown = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = drawer.getBoundingClientRect().width || 240;
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const w = Math.max(180, Math.min(420, startW + ev.clientX - startX));
      document.documentElement.style.setProperty("--drawer-w", `${w}px`);
      localStorage.setItem("myspot.drawer.width", String(Math.round(w)));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
}

/** Poll until the rescan finishes, reporting indexed-file counts as it goes.
 *  Reloading mid-scan would show a half-empty library and look like a failure,
 *  and a big folder takes minutes, so show progress rather than a dead spinner. */
async function waitForReindex(onProgress, timeoutMs = 15 * 60 * 1000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const status = await fetch("/api/reindex/status").then((r) => r.json());
      if (!status.running) return true;
      onProgress?.(status.progress ?? 0, Math.round((Date.now() - t0) / 1000));
    } catch (e) { return false; }
  }
  return false;
}

// True while the folder picker is on screen. Stays true through the click that
// dismisses it, so that click can't also collapse the Settings popover beneath.
let fsPickerOpen = false;

/** Modal folder/file picker over /api/fs/list.
 *  Resolves to the chosen path, or null if the user cancels. */
function openFsPicker({ start = "", mode = "dir", title = "CHOOSE FOLDER" } = {}) {
  const wrap = document.getElementById("fs-picker");
  const list = document.getElementById("fs-list");
  const pathInput = document.getElementById("fs-path");
  const info = document.getElementById("fs-info");
  const useBtn = document.getElementById("fs-use");
  const upBtn = document.getElementById("fs-up");
  if (!wrap) return Promise.resolve(null);

  document.getElementById("fs-picker-title").textContent = title;
  useBtn.textContent = mode === "file" ? "USE THIS FILE" : "USE THIS FOLDER";

  let here = "";       // folder currently listed
  let parent = null;
  let picked = null;   // in file mode, the selected file

  return new Promise((resolve) => {
    const cleanup = () => {
      wrap.hidden = true;
      document.removeEventListener("keydown", onKey);
      list.innerHTML = "";
      // Clear on the next tick — the dismissing click is still bubbling.
      setTimeout(() => { fsPickerOpen = false; }, 0);
    };
    const finish = (val) => { cleanup(); resolve(val); };
    const onKey = (e) => {
      if (e.key === "Escape") finish(null);
      if (e.key === "Enter" && document.activeElement === pathInput) load(pathInput.value.trim());
    };

    async function load(path) {
      list.innerHTML = `<div class="fs-row muted">Loading…</div>`;
      picked = null;
      try {
        const r = await fetch(`/api/fs/list?path=${encodeURIComponent(path || "")}&mode=${mode}`);
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          list.innerHTML = `<div class="fs-row bad">${err.detail || `Cannot open (HTTP ${r.status})`}</div>`;
          info.textContent = "";
          return;
        }
        const d = await r.json();
        here = d.path;
        parent = d.parent;
        pathInput.value = d.path;
        upBtn.disabled = !d.path;
        useBtn.disabled = mode === "dir" ? !d.path : true;

        list.innerHTML = "";
        if (d.shortcuts?.length) {
          list.append(sectionLabel("SHORTCUTS"));
          for (const s of d.shortcuts) list.append(row(s.name, s.path, "dir", "★"));
          list.append(sectionLabel("DRIVES"));
        }
        if (!d.entries.length) {
          list.append(Object.assign(document.createElement("div"),
            { className: "fs-row muted", textContent: "(no subfolders)" }));
        }
        for (const e of d.entries) {
          list.append(row(e.name, e.path, e.kind, e.kind === "dir" ? "📁" : "🗄"));
        }
        if (d.truncated) {
          list.append(Object.assign(document.createElement("div"),
            { className: "fs-row muted", textContent: "… list truncated" }));
        }
        info.textContent = d.media_files != null
          ? `${d.media_files.toLocaleString()} media file${d.media_files === 1 ? "" : "s"} here`
          : "";
      } catch (e) {
        list.innerHTML = `<div class="fs-row bad">Failed: ${e.message}</div>`;
      }
    }

    const sectionLabel = (text) => Object.assign(document.createElement("div"),
      { className: "fs-section", textContent: text });

    function row(name, path, kind, icon) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fs-row";
      b.innerHTML = `<span class="fs-ico">${icon}</span><span class="fs-name"></span>`;
      b.querySelector(".fs-name").textContent = name;
      b.onclick = () => {
        if (kind === "dir") { load(path); return; }
        // file mode: select rather than descend
        picked = path;
        list.querySelectorAll(".fs-row.sel").forEach((el) => el.classList.remove("sel"));
        b.classList.add("sel");
        useBtn.disabled = false;
        info.textContent = path;
      };
      return b;
    }

    upBtn.onclick = () => load(parent ?? "");
    useBtn.onclick = () => finish(mode === "file" ? picked : here);
    document.getElementById("fs-cancel").onclick = () => finish(null);
    document.getElementById("fs-close").onclick = () => finish(null);
    wrap.onclick = (e) => { if (e.target === wrap) finish(null); };
    document.addEventListener("keydown", onKey);

    fsPickerOpen = true;
    wrap.hidden = false;
    load(start);
  });
}

function bindApiPopover() {
  const btn = document.getElementById("btn-api");
  const pop = document.getElementById("api-pop");
  const input = document.getElementById("api-url-input");
  const current = document.getElementById("api-current");
  const msg = document.getElementById("api-settings-msg");
  const envfile = document.getElementById("api-envfile");

  // key = the /api/settings JSON key; isDir=false for the .db file field.
  // counts: what to report once the path resolves — media files for the image
  // library, account subfolders for the music library (its MP3s are one level
  // down), nothing for the single .db file.
  const FIELDS = [
    { key: "assetsdir",   el: "api-dir-assets",  status: "api-dir-assets-status",  isDir: true,  counts: "media" },
    { key: "sunolibrary", el: "api-dir-library", status: "api-dir-library-status", isDir: true,  counts: "subdirs" },
    { key: "sunometadb",  el: "api-dir-metadb",  status: "api-dir-metadb-status",  isDir: false, counts: null },
  ];
  for (const f of FIELDS) {
    f.input = document.getElementById(f.el);
    f.statusEl = document.getElementById(f.status);
  }

  const setStatus = (f, s) => {
    if (!f.statusEl) return;
    if (!s) { f.statusEl.textContent = ""; f.statusEl.className = "api-dir-status"; return; }
    if (!s.exists) {
      f.statusEl.textContent = "✕ not found";
      f.statusEl.className = "api-dir-status bad";
    } else if (f.isDir && !s.is_dir) {
      f.statusEl.textContent = "✕ not a folder";
      f.statusEl.className = "api-dir-status bad";
    } else {
      let detail = "";
      if (f.counts === "media" && s.media_files != null) {
        const n = s.media_files;
        detail = ` — ${n.toLocaleString()}${s.media_files_capped ? "+" : ""} media file${n === 1 ? "" : "s"} here`;
      } else if (f.counts === "subdirs" && s.subdirs != null) {
        const n = s.subdirs;
        detail = ` — ${n.toLocaleString()} account folder${n === 1 ? "" : "s"}`;
      }
      f.statusEl.textContent = `✓ found${detail}`;
      f.statusEl.className = "api-dir-status ok";
    }
  };

  // Validate a typed path against the server without saving it.
  const checkPath = debounce(async (f) => {
    const v = f.input?.value?.trim();
    if (!v) return setStatus(f, null);
    try {
      const r = await fetch(`/api/settings/check?path=${encodeURIComponent(v)}&dir=${f.isDir}`);
      setStatus(f, await r.json());
    } catch (e) { setStatus(f, null); }
  }, 400);

  for (const f of FIELDS) {
    f.input?.addEventListener("input", () => checkPath(f));
  }

  // 📁 buttons — pick a folder (or the .db file) instead of typing a path.
  for (const btnEl of document.querySelectorAll(".api-dir-browse")) {
    const f = FIELDS.find((x) => x.el === btnEl.dataset.browse);
    if (!f) continue;
    btnEl.onclick = async () => {
      const chosen = await openFsPicker({
        start: f.input?.value?.trim() || "",
        mode: f.isDir ? "dir" : "file",
        title: f.isDir ? "CHOOSE FOLDER" : "CHOOSE DATABASE FILE",
      });
      if (!chosen) return;
      f.input.value = chosen;
      checkPath(f);
      if (msg) msg.textContent = "Press SAVE & RESCAN to apply.";
    };
  }

  const loadSettings = async () => {
    const r = await fetch("/api/settings");
    const s = await r.json();
    for (const f of FIELDS) {
      if (f.input) f.input.value = s[f.key] || "";
      setStatus(f, s.status?.[f.key]);
    }
    if (envfile) envfile.textContent = `Saved to ${s.envfile} — ${s.assets_indexed} media files indexed`;
  };

  btn.onclick = async () => {
    const stored = localStorage.getItem("myspot_api_base") || "";
    input.value = stored;
    current.textContent = stored ? `Active: ${stored}` : "Local mode (same-origin)";
    if (msg) msg.textContent = "";
    try {
      await loadSettings();
    } catch (e) { /* server may be on a different origin */ }
    pop.hidden = !pop.hidden;
  };

  document.getElementById("api-save").onclick = async () => {
    const saveBtn = document.getElementById("api-save");
    const v = input.value.trim().replace(/\/$/, "");
    if (v) localStorage.setItem("myspot_api_base", v);
    else localStorage.removeItem("myspot_api_base");

    const payload = {};
    for (const f of FIELDS) {
      const val = f.input?.value?.trim();
      if (val) payload[f.key] = val;
    }
    saveBtn.disabled = true;
    if (msg) { msg.textContent = "Saving…"; msg.className = "muted small"; }
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!data.ok) {
        // Bad path: keep the popover open so the typo can be fixed.
        if (msg) { msg.textContent = data.error || "Save failed"; msg.className = "small bad"; }
        saveBtn.disabled = false;
        return;
      }
      if (data.reindex_triggered) {
        toast("Library folders saved — rescanning");
        // Scanning a big folder takes minutes (dimensions + perceptual hash per
        // image), so report progress and reload only once it's done.
        if (msg) {
          msg.className = "muted small";
          msg.innerHTML = `Saved. Rescanning… <a href="#" id="api-skip-wait">reload now</a>`;
          document.getElementById("api-skip-wait").onclick = (ev) => {
            ev.preventDefault();
            location.reload();
          };
        }
        await waitForReindex((n, secs) => {
          const link = msg?.querySelector("#api-skip-wait");
          if (msg) msg.firstChild.textContent =
            `Saved. Rescanning — ${n.toLocaleString()} files indexed (${secs}s)… `;
          if (link) link.textContent = "reload now";
        });
      } else {
        toast("Settings saved");
      }
      location.reload();
    } catch (e) {
      if (msg) { msg.textContent = "Save failed: " + e.message; msg.className = "small bad"; }
      saveBtn.disabled = false;
    }
  };

  document.getElementById("api-clear").onclick = () => {
    localStorage.removeItem("myspot_api_base");
    location.reload();
  };

  document.addEventListener("click", (e) => {
    // Clicks in the folder picker are "inside" Settings as far as the user is
    // concerned — the picker layers over the popover, so collapsing the popover
    // behind it would throw away whatever they were editing.
    if (fsPickerOpen) return;
    if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true;
  });
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", async () => {
  initPersistentPlayer();
  bindGlobal();
  bindHelp();
  bindThemePopover();
  bindApiPopover();
  await Promise.all([loadChannels(), loadAssetFolders(), loadSmartTags(), loadStats()]);
  await route();
});
