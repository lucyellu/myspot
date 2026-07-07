import { api, mediaUrl } from "../api.js";
import { fmtDuration, fmtAccount, el, clear, toast, channelColor } from "../util.js";
import { renderTab, currentTab, setSong } from "../sidepanel.js?v=lyric-export1";
import { attachHalftone } from "../components/halftone.js";
import { applyDesignSettings } from "../tabs/design.js";
import { loadPlayerSong, setPlayerContext, queueAutoplayForRoute, getAudio } from "../player.js?v=radio-longform1";

let currentAudio = null;
let _related = [];
let _keyAbort = null;
let _watchAudioAbort = null;
let _track = [];          // ordered list of completed gens for the song
let _activeClipIdx = -1;
let _currentSong = null;
let _slideshowMode = false;  // off by default — only first gen plays unless user opts in
let _traySelected = new Set();  // tray ids picked via multi-select
let _trackSelected = new Set();  // track-clip gen ids picked for batch delete

const SLIDESHOW_KEY = "myspot.slideshow.v1";  // { [songId]: bool }
const WATCH_LAYOUT_KEY = "myspot.watch.layout.v1";
const WATCH_DEFAULTS = {
  order: ["stage", "media", "studio"],
  widths: { stage: 560, media: 360, studio: 420 },
  collapsed: {},
};
function loadSlideshowMode(songId) {
  try { return !!(JSON.parse(localStorage.getItem(SLIDESHOW_KEY) || "{}")[songId]); }
  catch { return false; }
}
function saveSlideshowMode(songId, on) {
  try {
    const all = JSON.parse(localStorage.getItem(SLIDESHOW_KEY) || "{}");
    all[songId] = !!on;
    localStorage.setItem(SLIDESHOW_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

function loadWatchLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(WATCH_LAYOUT_KEY) || "{}");
    const order = Array.isArray(saved.order) ? saved.order.filter((x) => WATCH_DEFAULTS.order.includes(x)) : [];
    for (const key of WATCH_DEFAULTS.order) if (!order.includes(key)) order.push(key);
    return {
      order,
      widths: { ...WATCH_DEFAULTS.widths, ...(saved.widths || {}) },
      collapsed: { ...(saved.collapsed || {}) },
    };
  } catch {
    return { ...WATCH_DEFAULTS, widths: { ...WATCH_DEFAULTS.widths }, collapsed: {} };
  }
}

function saveWatchLayout(layout) {
  try { localStorage.setItem(WATCH_LAYOUT_KEY, JSON.stringify(layout)); } catch { /* ignore */ }
}

function bindWatchLayout() {
  const watch = document.getElementById("watch-lanes");
  if (!watch) return;
  let layout = loadWatchLayout();

  const lanes = new Map([...watch.querySelectorAll(".watch-lane")].map((lane) => [lane.dataset.lane, lane]));
  const makeResizer = (before, after) => {
    const r = el("div", {
      class: "lane-resizer",
      "data-resize-before": before,
      "data-resize-after": after,
      title: "Resize lanes",
    });
    return r;
  };

  const rebuild = () => {
    const order = layout.order.filter((key) => lanes.has(key));
    watch.innerHTML = "";
    order.forEach((key, idx) => {
      const lane = lanes.get(key);
      watch.append(lane);
      if (idx < order.length - 1) watch.append(makeResizer(key, order[idx + 1]));
    });
    applyLayout();
    bindLaneControls();
    bindResizers();
  };

  const colFor = (key) => layout.collapsed[key] ? "44px" : `${Math.max(220, Number(layout.widths[key]) || WATCH_DEFAULTS.widths[key])}px`;
  const applyLayout = () => {
    for (const [key, lane] of lanes) {
      const collapsed = !!layout.collapsed[key];
      lane.classList.toggle("collapsed", collapsed);
      const btn = lane.querySelector(".lane-collapse");
      if (btn) btn.textContent = collapsed ? "+" : "−";
    }
    if (window.matchMedia("(max-width: 800px)").matches) {
      watch.style.gridTemplateColumns = "";
      return;
    }
    watch.style.gridTemplateColumns = layout.order.map(colFor).join(" 10px ");
  };

  const bindLaneControls = () => {
    for (const [key, lane] of lanes) {
      const btn = lane.querySelector(".lane-collapse");
      if (btn) {
        btn.onclick = (e) => {
          e.stopPropagation();
          layout.collapsed[key] = !layout.collapsed[key];
          saveWatchLayout(layout);
          applyLayout();
        };
      }
      const head = lane.querySelector(".lane-head");
      if (head) {
        head.ondblclick = () => {
          layout.collapsed[key] = !layout.collapsed[key];
          saveWatchLayout(layout);
          applyLayout();
        };
      }
      lane.ondragstart = (e) => {
        if (!e.target.closest(".lane-head")) { e.preventDefault(); return; }
        lane.classList.add("dragging");
        e.dataTransfer.setData("text/plain", key);
        e.dataTransfer.effectAllowed = "move";
      };
      lane.ondragend = () => lane.classList.remove("dragging");
      lane.ondragover = (e) => {
        const from = e.dataTransfer.getData("text/plain");
        if (!from || from === key) return;
        e.preventDefault();
        lane.classList.add("drop-target");
      };
      lane.ondragleave = () => lane.classList.remove("drop-target");
      lane.ondrop = (e) => {
        e.preventDefault();
        lane.classList.remove("drop-target");
        const from = e.dataTransfer.getData("text/plain");
        if (!from || from === key) return;
        const order = layout.order.filter((x) => x !== from);
        const at = order.indexOf(key);
        order.splice(at, 0, from);
        layout.order = order;
        saveWatchLayout(layout);
        rebuild();
      };
    }
  };

  const bindResizers = () => {
    watch.querySelectorAll(".lane-resizer").forEach((resizer) => {
      resizer.onpointerdown = (e) => {
        e.preventDefault();
        const before = resizer.dataset.resizeBefore;
        const after = resizer.dataset.resizeAfter;
        if (!before || !after || layout.collapsed[before] || layout.collapsed[after]) return;
        const startX = e.clientX;
        const startBefore = lanes.get(before).getBoundingClientRect().width;
        const startAfter = lanes.get(after).getBoundingClientRect().width;
        resizer.setPointerCapture(e.pointerId);
        resizer.classList.add("resizing");
        const move = (ev) => {
          const dx = ev.clientX - startX;
          layout.widths[before] = Math.max(220, startBefore + dx);
          layout.widths[after] = Math.max(220, startAfter - dx);
          applyLayout();
        };
        const up = () => {
          resizer.classList.remove("resizing");
          saveWatchLayout(layout);
          resizer.removeEventListener("pointermove", move);
          resizer.removeEventListener("pointerup", up);
          resizer.removeEventListener("pointercancel", up);
        };
        resizer.addEventListener("pointermove", move);
        resizer.addEventListener("pointerup", up);
        resizer.addEventListener("pointercancel", up);
      };
    });
  };

  rebuild();
  window.addEventListener("resize", applyLayout, { once: true });
}

export async function renderWatch(songId) {
  const view = document.getElementById("view");
  clear(view);
  const tpl = document.getElementById("tpl-watch").content.cloneNode(true);
  view.append(tpl);
  bindWatchLayout();
  // Snap to top so the player is in view immediately, regardless of where
  // the user was scrolled in the previous (home / search / channel) page.
  window.scrollTo({ top: 0, behavior: "instant" });

  const song = await api.song(songId);
  if (!song) { view.innerHTML = "<p class='empty-state'>Song not found.</p>"; return; }

  document.title = `myspot · ${song.title}`;

  _currentSong = song;
  _track = (song.gens || []).filter((g) => g.status === "completed" && g.file_path);
  _slideshowMode = loadSlideshowMode(song.id);
  _traySelected = new Set();
  paintVisual(document.getElementById("visual"), song);
  renderTrackStrip(song);
  bindCanvasDrops(song);
  initMediaTray(song);
  if (_watchAudioAbort) _watchAudioAbort.abort();
  _watchAudioAbort = new AbortController();
  const audioSignal = _watchAudioAbort.signal;
  const audio = loadPlayerSong(song);
  currentAudio = audio;

  // Wire halftone visualizer to the audio element (idempotent across songs)
  const halftoneCanvas = document.getElementById("halftone");
  if (halftoneCanvas) attachHalftone(halftoneCanvas, audio);

  // LCD time displays
  const lcdCur = document.getElementById("lcd-time-cur");
  const lcdTot = document.getElementById("lcd-time-tot");
  const updateLcd = () => {
    if (lcdCur) lcdCur.textContent = fmtDuration(audio.currentTime);
    if (lcdTot) lcdTot.textContent = fmtDuration(audio.duration || song.duration);
  };
  audio.addEventListener("loadedmetadata", updateLcd, { signal: audioSignal });
  audio.addEventListener("timeupdate", updateLcd, { signal: audioSignal });
  updateLcd();

  bindTransport(audio, song, audioSignal);
  bindKaraoke(audio, song, audioSignal);
  const lcdBpm = document.getElementById("lcd-bpm");
  if (lcdBpm && song.bpm) { lcdBpm.textContent = song.bpm + " BPM"; lcdBpm.hidden = false; }
  const lcdVer = document.getElementById("lcd-version");
  if (lcdVer && song.version > 1) { lcdVer.textContent = "v" + song.version; lcdVer.hidden = false; }

  document.getElementById("song-title").textContent = song.title;

  const accountChip = document.getElementById("meta-account");
  accountChip.textContent = fmtAccount(song.account);
  accountChip.href = `#/channel/${encodeURIComponent(song.account)}`;

  const verChip = document.getElementById("meta-version");
  if (song.version > 1) {
    verChip.textContent = `v${song.version}`;
    verChip.hidden = false;
  }
  document.getElementById("meta-duration").textContent = fmtDuration(song.duration);
  if (song.bpm) {
    const b = document.getElementById("meta-bpm");
    b.textContent = `${song.bpm} BPM`;
    b.hidden = false;
  }
  if (song.suno_date) {
    const d = document.getElementById("meta-date");
    d.textContent = song.suno_date;
    d.hidden = false;
  }
  document.getElementById("meta-genre").textContent = song.genre || "";

  // Like toggle
  const likeBtn = document.getElementById("btn-like");
  if (likeBtn) {
    const renderLike = (liked) => {
      likeBtn.textContent = liked ? "♥" : "♡";
      likeBtn.classList.toggle("liked", !!liked);
    };
    renderLike(song.liked);
    likeBtn.onclick = async () => {
      try {
        const r = await api.toggleLike(song.id);
        renderLike(r.liked);
      } catch (e) { toast("Like failed: " + e.message); }
    };
  }

  // Record a play after the user has actually listened for >5s
  let playRecorded = false;
  const checkPlay = () => {
    if (playRecorded) return;
    if (audio.currentTime >= 5) {
      playRecorded = true;
      api.recordPlay(song.id, Math.floor(audio.currentTime * 1000)).catch(() => {});
    }
  };
  audio.addEventListener("timeupdate", checkPlay, { signal: audioSignal });
  // Also tell the extension which song is open
  api.setExtensionCurrentSong(song.id).catch(() => {});

  // Up next
  const upNext = document.getElementById("up-next");
  clear(upNext);
  _related = await api.related(song.id, 24);
  setPlayerContext({ related: _related, sources: song.sources || [] });
  for (const r of _related) upNext.append(upRow(r));

  // Sidepanel
  setSong(song);
  bindTabs();
  renderTab(currentTab());

  bindShortcuts(song);

  // Lyrics scroll sync (simple progress-based highlight; estimate timestamps later)
  // Slideshow auto-advance only runs when the user explicitly enables it on this
  // song — by default a song shows just its primary visual, no rotation.
  audio.addEventListener("timeupdate", () => {
    const total = audio.duration || song.duration;
    const t = audio.currentTime;
    const detail = { t, total };
    document.dispatchEvent(new CustomEvent("audio:tick", { detail }));
    if (_slideshowMode && _track.length >= 2 && total) {
      const idx = Math.min(_track.length - 1, Math.floor((t / total) * _track.length));
      if (idx !== _activeClipIdx) {
        _activeClipIdx = idx;
        showClip(_track[idx]);
        highlightActiveClip();
      }
    }
  }, { signal: audioSignal });
}

function stageUrl(src, kind) {
  const visual = document.getElementById("visual");
  if (!visual) return;
  visual.innerHTML = "";
  visual.classList.remove("with-art", "full-art");
  visual.classList.add("with-art", "full-art");
  const bg = el("div", { class: "blur-bg" });
  if (kind !== "video") bg.style.backgroundImage = `url(${src})`;
  visual.append(bg);
  const wrap = el("div", { class: "center-art" });
  if (kind === "video") {
    wrap.append(el("video", { src, autoplay: true, muted: true, loop: true, playsinline: true }));
  } else {
    wrap.append(el("img", { src, alt: "" }));
  }
  visual.append(wrap);
}

function showClip(gen) {
  const visual = document.getElementById("visual");
  if (!visual || !gen) return;
  visual.innerHTML = "";
  visual.classList.remove("with-art", "full-art");
  visual.classList.add("with-art", "full-art");
  const url = mediaUrl.gen(gen.id);
  // Blurred backdrop fills the letterbox dead zones for a polished look.
  const bg = el("div", { class: "blur-bg" });
  if (gen.kind === "image") bg.style.backgroundImage = `url(${url})`;
  visual.append(bg);
  const wrap = el("div", { class: "center-art" });
  if (gen.kind === "video") {
    wrap.append(el("video", {
      src: url,
      autoplay: true, muted: true, loop: true, playsinline: true,
    }));
  } else {
    wrap.append(el("img", { src: url, alt: "" }));
  }
  visual.append(wrap);
}

function renderTrackStrip(song) {
  const strip = document.getElementById("track-strip");
  if (!strip) return;
  strip.innerHTML = "";
  // Drop any selections that no longer correspond to a present clip
  for (const id of [..._trackSelected]) {
    if (!_track.some((g) => g.id === id)) _trackSelected.delete(id);
  }

  if (!_track.length) {
    strip.append(el("div", { class: "track-empty" },
      "Drop images / videos / assets onto the player to build your visual track."));
    return;
  }

  // Action row at the start of the strip — slideshow toggle + bulk actions
  const actions = el("div", { class: "track-actions" });
  if (_track.length >= 2) {
    const toggle = el("button", {
      class: "slideshow-toggle" + (_slideshowMode ? " on" : ""),
      type: "button",
      title: _slideshowMode
        ? "Slideshow ON — clips auto-advance with the song"
        : "Slideshow OFF — only the first clip plays",
    }, _slideshowMode ? "▶▶ ON" : "▶ OFF");
    toggle.onclick = (e) => {
      e.stopPropagation();
      _slideshowMode = !_slideshowMode;
      saveSlideshowMode(song.id, _slideshowMode);
      if (!_slideshowMode && _track.length) {
        _activeClipIdx = 0;
        showClip(_track[0]);
      }
      renderTrackStrip(song);
      highlightActiveClip();
    };
    actions.append(el("span", { class: "track-actions-label" }, "SLIDESHOW"));
    actions.append(toggle);
  }

  if (_trackSelected.size) {
    const delSel = el("button", { class: "track-action-btn danger", type: "button" },
      `Delete ${_trackSelected.size} selected`);
    delSel.onclick = async (e) => {
      e.stopPropagation();
      const n = _trackSelected.size;
      if (!confirm(`Delete ${n} selected clip${n === 1 ? "" : "s"}?`)) return;
      const ids = [..._trackSelected];
      let ok = 0, fail = 0;
      for (const id of ids) {
        try { await api.deleteGen(id); ok++; } catch { fail++; }
      }
      _trackSelected.clear();
      _track = _track.filter((g) => !ids.includes(g.id));
      _activeClipIdx = -1;
      renderTrackStrip(song);
      if (_track[0]) showClip(_track[0]);
      toast(`Deleted ${ok}${fail ? ` (${fail} failed)` : ""}`);
    };
    actions.append(delSel);
  }

  if (_track.length >= 2) {
    const removeAll = el("button", { class: "track-action-btn danger", type: "button", title: "Detach every clip from this song" },
      `Remove all (${_track.length})`);
    removeAll.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Remove all ${_track.length} clips from this song? (Source files stay on disk; this only detaches them.)`)) return;
      const ids = _track.map((g) => g.id);
      let ok = 0, fail = 0;
      for (const id of ids) {
        try { await api.deleteGen(id); ok++; } catch { fail++; }
      }
      _track = []; _trackSelected.clear(); _activeClipIdx = -1;
      renderTrackStrip(song);
      paintVisual(document.getElementById("visual"), { ...song, gens: [] });
      toast(`Removed ${ok}${fail ? ` (${fail} failed)` : ""}`);
    };
    actions.append(removeAll);
  }

  if (actions.children.length) strip.append(actions);

  _track.forEach((g, i) => {
    const clip = el("div", { class: "track-clip", "data-idx": i, "data-gen-id": g.id });
    if (i === _activeClipIdx) clip.classList.add("active");
    if (_trackSelected.has(g.id)) clip.classList.add("selected");

    const sel = el("input", { type: "checkbox", class: "track-clip-check", title: "Select for batch delete" });
    sel.checked = _trackSelected.has(g.id);
    sel.onclick = (e) => e.stopPropagation();
    sel.onchange = () => {
      if (sel.checked) _trackSelected.add(g.id); else _trackSelected.delete(g.id);
      clip.classList.toggle("selected", sel.checked);
      renderTrackStrip(song);  // re-render so the bulk delete button appears/updates
    };
    clip.append(sel);
    if (g.kind === "video") {
      // Don't auto-fetch the video file just to show a thumb — load metadata
      // only when the user hovers, otherwise stay as a lightweight placeholder.
      const v = el("video", {
        muted: true, loop: true, playsinline: true,
        preload: "none",
      });
      v.dataset.src = mediaUrl.gen(g.id);
      const loadOnHover = () => {
        if (!v.src) v.src = v.dataset.src;
        v.play().catch(() => {});
      };
      v.addEventListener("mouseenter", loadOnHover);
      v.addEventListener("mouseleave", () => { v.pause(); v.currentTime = 0; });
      clip.append(v);
    } else {
      clip.append(el("img", { src: mediaUrl.gen(g.id), loading: "lazy", alt: "" }));
    }
    clip.append(el("span", { class: "track-clip-idx" }, String(i + 1)));
    if (g.tool) clip.append(el("span", { class: "track-clip-tool" }, g.tool));
    // Animate buttons — only on completed image gens
    if (g.kind === "image") {
      const anim = el("button", { class: "track-clip-anim", title: "Animate via HF LTX-Video (~60s, ~$0.05)" }, "▶+");
      anim.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm("Animate this image to a 5-second video clip via HF LTX-Video?\n(Costs ~$0.05 of your HF credit per call.)")) return;
        anim.disabled = true; anim.textContent = "...";
        try {
          const r = await api.animateGen(g.id);
          if (r.error) toast("Animate failed: " + r.error.slice(0, 200));
          else {
            toast("Video generated ✓");
            const audio = currentAudio;
            if (audio) audio.pause();
            await refreshTrack();
          }
        } catch (err) { toast("Failed: " + err.message); }
        anim.disabled = false; anim.textContent = "▶+";
      };
      clip.append(anim);

      // Kling handoff — high quality, manual
      const kling = el("button", { class: "track-clip-kling", title: "Send to Kling.ai (manual paste, free 6/day on web)" }, "K");
      kling.onclick = async (e) => {
        e.stopPropagation();
        // Download the image so user can drag it into Kling
        const a = document.createElement("a");
        a.href = mediaUrl.gen(g.id);
        a.download = (g.file_path || "image").split("/").pop();
        document.body.appendChild(a); a.click(); a.remove();
        // Open Kling I2V in a new tab
        window.open("https://app.klingai.com/global/image-to-video/frame-mode/new", "_blank", "noopener");
        toast("Image downloaded — drag into Kling, then drop the resulting MP4 onto the player canvas.");
      };
      clip.append(kling);
    }
    const x = el("button", { class: "track-clip-x", title: "Remove from track" }, "✕");
    x.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Remove this clip?")) return;
      try {
        await api.deleteGen(g.id);
        _track.splice(i, 1);
        renderTrackStrip(song);
      } catch (err) { toast("Delete failed: " + err.message); }
    };
    clip.append(x);
    clip.onclick = () => {
      const audio = currentAudio;
      if (!audio) return;
      const total = audio.duration || song.duration || 0;
      if (total > 0 && _track.length) {
        const tgtT = (i / _track.length) * total + 0.01;
        audio.currentTime = tgtT;
        _activeClipIdx = i;
        showClip(g);
        highlightActiveClip();
      }
    };
    strip.append(clip);
  });
  // Trailing drop hint
  const more = el("div", { class: "track-empty", style: "min-width:140px;flex:0 0 auto;" }, "+ drop more");
  strip.append(more);
}

function highlightActiveClip() {
  const strip = document.getElementById("track-strip");
  if (!strip) return;
  strip.querySelectorAll(".track-clip").forEach((c) => {
    c.classList.toggle("active", parseInt(c.dataset.idx, 10) === _activeClipIdx);
  });
  // Scroll active into view
  const active = strip.querySelector(".track-clip.active");
  if (active) active.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
}

function bindCanvasDrops(song) {
  const player = document.querySelector(".player");
  const visual = document.getElementById("visual");
  const strip = document.getElementById("track-strip");
  if (!player || !visual || !strip) return;

  let dragCount = 0;
  const showOver = () => { dragCount++; player.classList.add("drag-over"); strip.classList.add("drag-over"); };
  const hideOver = () => { dragCount = Math.max(0, dragCount - 1); if (!dragCount) { player.classList.remove("drag-over"); strip.classList.remove("drag-over"); } };

  for (const target of [visual, strip]) {
    target.addEventListener("dragenter", (e) => { e.preventDefault(); showOver(); });
    target.addEventListener("dragleave", () => hideOver());
    target.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
    target.addEventListener("drop", async (e) => {
      e.preventDefault();
      dragCount = 0; player.classList.remove("drag-over"); strip.classList.remove("drag-over");
      const files = [...(e.dataTransfer.files || [])];
      if (!files.length) return;
      for (const f of files) {
        try {
          const kind = f.type.startsWith("video") ? "video" : "image";
          const r = await api.uploadGen(song.id, f, { tool: "drop", kind, prompt: "" });
          toast(`Added ${f.name}`);
          // Push into local track
          _track.push({ id: r.id, kind, file_path: r.file_path, tool: "drop", status: "completed" });
        } catch (err) { toast(`Upload failed: ${err.message}`); }
      }
      renderTrackStrip(song);
    });
  }
}

// ============ Media tray ============

let _trayFolder = "_root";
let _mediaRoots = {
  assets_dir: "L:/Media/Audio/suno/albumart",
  gens_dir: "C:/Users/lucyl/Desktop/hold/projects/myspot/data/gens",
};
let _trayOffset = 0;
let _trayTotal = 0;
const _PAGE = 60;

async function initMediaTray(song) {
  const select = document.getElementById("media-tray-folder");
  if (!select) return;
  try { _mediaRoots = await api.mediaRoots(); } catch { /* keep fallbacks */ }
  // Build folder dropdown
  let folders = [
    { folder: "_root", n: 0, label: "Album art root" },
    { folder: "_gens", n: 0, label: "Gens (output)" },
  ];
  try {
    const list = await api.assetFolders();
    for (const f of list) {
      if (f.folder === "_root") {
        folders[0].n = f.n;
        continue;
      }
      if (f.folder === "_gens") {
        folders[1].n = f.n;
        continue;
      }
      folders.push({ folder: f.folder, n: f.n, label: f.folder });
    }
  } catch { /* ignore */ }

  select.innerHTML = "";
  for (const f of folders) {
    const o = el("option", { value: f.folder }, `${f.label || f.folder} (${f.n})`);
    select.append(o);
  }
  if (!folders.some((f) => f.folder === _trayFolder)) {
    const root = folders.find((f) => f.folder === "_root" && f.n > 0);
    const firstReal = folders.find((f) => f.folder !== "_gens" && f.n > 0);
    _trayFolder = (root || firstReal || folders[0]).folder;
  }
  select.value = _trayFolder;
  select.onchange = () => loadTray(select.value);

  document.getElementById("media-tray-more").onclick = () => loadTrayMore();

  // Bulk-attach actions for the multi-select state
  const bulkAttach = document.getElementById("tray-bulk-attach");
  const bulkClear = document.getElementById("tray-bulk-clear");
  if (bulkAttach) bulkAttach.onclick = () => attachSelectedTrayItems();
  if (bulkClear) bulkClear.onclick = () => {
    _traySelected.clear();
    document.querySelectorAll(".tray-tile-check").forEach((c) => { c.checked = false; });
    updateTrayBulkBar();
  };

  await loadTray(_trayFolder);
}

async function attachSelectedTrayItems() {
  if (!_currentSong) { toast("No song open"); return; }
  if (!_traySelected.size) return;
  const tiles = [...document.querySelectorAll(".media-tray-tile")];
  const targets = tiles
    .map((t) => t.__item)
    .filter((it) => it && _traySelected.has(it.uid));
  let ok = 0, fail = 0;
  for (const it of targets) {
    try { await it.attach(); ok++; } catch { fail++; }
  }
  toast(`Attached ${ok}${fail ? ` (${fail} failed)` : ""}`);
  _traySelected.clear();
  updateTrayBulkBar();
  await refreshTrack();
  await loadTray(_trayFolder);
}

export async function setTrayFolder(folder) {
  const select = document.getElementById("media-tray-folder");
  if (!select) return;
  if (![...select.options].some((o) => o.value === folder)) {
    // Add it (in case the folder was created since the last init)
    select.append(el("option", { value: folder }, folder));
  }
  select.value = folder;
  await loadTray(folder);
}

async function loadTray(folder) {
  _trayFolder = folder;
  _trayOffset = 0;
  const grid = document.getElementById("media-tray-grid");
  const status = document.getElementById("media-tray-status");
  const pathEl = document.getElementById("media-tray-path");
  if (!grid) return;
  grid.innerHTML = "";

  let path = "";
  let items = [];
  try {
    if (folder === "_gens") {
      path = _mediaRoots.gens_dir || "data/gens";
      const r = await api.gensBrowse({ limit: _PAGE, offset: 0 });
      items = (r.items || []).map((g) => ({
        uid: `gen:${g.id}`, _gen: g,
        kind: g.kind, src: mediaUrl.gen(g.id), tag: `${g.tool} • #${g.song_id}`,
        attach: () => attachGenToCurrent(g),
      }));
      _trayTotal = r.total;
    } else {
      const root = _mediaRoots.assets_dir || "assets";
      path = folder === "_root" ? root : `${root}/${folder}`;
      const r = await api.assets({ folder, limit: _PAGE, offset: 0 });
      items = (r.items || []).map((a) => ({
        uid: `asset:${a.id}`, _asset: a,
        kind: a.kind, src: mediaUrl.asset(a.id), tag: a.kind,
        attach: () => attachAssetToCurrent(a),
      }));
      _trayTotal = r.total;
    }
  } catch (e) {
    grid.innerHTML = `<div class="media-tray-empty">Load failed: ${e.message}</div>`;
    return;
  }

  pathEl.textContent = path;
  if (!items.length) {
    grid.innerHTML = `<div class="media-tray-empty">No files in this folder yet.<br>Drop images into <code>${path}</code> to populate.</div>`;
    status.textContent = "0 / 0";
    document.getElementById("media-tray-more").disabled = true;
    return;
  }
  for (const it of items) grid.append(trayTile(it));
  _trayOffset = items.length;
  status.textContent = `${_trayOffset} / ${_trayTotal}`;
  document.getElementById("media-tray-more").disabled = _trayOffset >= _trayTotal;
}

async function loadTrayMore() {
  const grid = document.getElementById("media-tray-grid");
  const status = document.getElementById("media-tray-status");
  if (!grid) return;
  let items = [];
  try {
    if (_trayFolder === "_gens") {
      const r = await api.gensBrowse({ limit: _PAGE, offset: _trayOffset });
      items = (r.items || []).map((g) => ({
        uid: `gen:${g.id}`, _gen: g,
        kind: g.kind, src: mediaUrl.gen(g.id), tag: `${g.tool} • #${g.song_id}`,
        attach: () => attachGenToCurrent(g),
      }));
    } else {
      const r = await api.assets({ folder: _trayFolder, limit: _PAGE, offset: _trayOffset });
      items = (r.items || []).map((a) => ({
        uid: `asset:${a.id}`, _asset: a,
        kind: a.kind, src: mediaUrl.asset(a.id), tag: a.kind,
        attach: () => attachAssetToCurrent(a),
      }));
    }
  } catch { return; }
  for (const it of items) grid.append(trayTile(it));
  _trayOffset += items.length;
  status.textContent = `${_trayOffset} / ${_trayTotal}`;
  document.getElementById("media-tray-more").disabled = _trayOffset >= _trayTotal;
}

function trayTile(item) {
  const tile = el("div", {
    class: "media-tray-tile",
    title: "Click to attach · Shift-click or checkbox to multi-select · Drag onto Image inspiration to use as prompt source",
    draggable: "true",
  });
  tile.__item = item;  // for bulk-attach lookup by uid
  if (item.kind === "video") {
    tile.append(el("video", { src: item.src, muted: true, loop: true, playsinline: true,
      onmouseenter: (e) => e.currentTarget.play().catch(() => {}),
      onmouseleave: (e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; },
    }));
  } else {
    tile.append(el("img", { src: item.src, loading: "lazy", alt: "" }));
  }
  tile.append(el("span", { class: "tray-tile-tag" }, item.tag || ""));
  const attachBtn = el("button", { class: "tray-tile-attach", type: "button", title: "Add to track" }, "+ track");
  attachBtn.onclick = (e) => { e.stopPropagation(); item.attach(); };
  tile.append(attachBtn);

  // Multi-select checkbox (top-left). Stops click bubbling so the tile click still
  // does single-attach when used directly.
  const cb = el("input", { type: "checkbox", class: "tray-tile-check", title: "Select for batch attach" });
  cb.checked = _traySelected.has(item.uid);
  cb.onclick = (e) => e.stopPropagation();
  cb.onchange = () => {
    if (cb.checked) _traySelected.add(item.uid);
    else _traySelected.delete(item.uid);
    updateTrayBulkBar();
  };
  tile.append(cb);

  tile.onclick = (e) => {
    if (e.shiftKey) {
      cb.checked = !cb.checked;
      cb.onchange();
      return;
    }
    stageUrl(item.src, item.kind);
  };

  // Drag payload: serialize so the prompt-tab inspire-drop can fetch the asset.
  tile.addEventListener("dragstart", (e) => {
    const payload = JSON.stringify({ src: item.src, kind: item.kind, tag: item.tag });
    e.dataTransfer.setData("application/x-myspot-tray", payload);
    e.dataTransfer.setData("text/uri-list", item.src);
    e.dataTransfer.effectAllowed = "copy";
    tile.classList.add("dragging");
  });
  tile.addEventListener("dragend", () => tile.classList.remove("dragging"));
  return tile;
}

function updateTrayBulkBar() {
  const bar = document.getElementById("tray-bulk-bar");
  if (!bar) return;
  const n = _traySelected.size;
  bar.hidden = n === 0;
  const lbl = bar.querySelector(".tray-bulk-count");
  if (lbl) lbl.textContent = n ? `${n} selected` : "";
}

async function attachGenToCurrent(srcGen) {
  if (!_currentSong) { toast("No song open"); return; }
  if (srcGen.song_id === _currentSong.id) {
    toast("This gen is already on this song");
    return;
  }
  // Cross-attach: read the gen file as bytes and re-upload as a new gen on this song
  try {
    const r = await fetch(srcGen.src);
    const blob = await r.blob();
    const file = new File([blob], srcGen.src.split("/").pop() || "gen", { type: blob.type });
    await api.uploadGen(_currentSong.id, file, { tool: "tray-import", kind: srcGen.kind, prompt: "" });
    toast("Attached from tray");
    await refreshTrack();
  } catch (e) { toast("Attach failed: " + e.message); }
}

async function attachAssetToCurrent(asset) {
  if (!_currentSong) { toast("No song open"); return; }
  try {
    await api.attachAsset(_currentSong.id, asset.id);
    toast("Attached asset");
    await refreshTrack();
  } catch (e) { toast("Attach failed: " + e.message); }
}

export async function refreshTrack() {
  if (!_currentSong) return;
  try {
    const fresh = await api.song(_currentSong.id);
    _track = (fresh.gens || []).filter((g) => g.status === "completed" && g.file_path);
    _currentSong = fresh;
    renderTrackStrip(fresh);
    // Repaint visual to use first clip if no active yet
    if (_activeClipIdx < 0 && _track.length) showClip(_track[0]);
  } catch { /* ignore */ }
}

function upRow(r) {
  const a = el("a", { class: "up-row", href: `#/song/${r.id}` });
  const thumb = el("div", { class: "thumb" });
  if (r.jpg_path) thumb.append(el("img", { loading: "lazy", src: mediaUrl.cover(r.id), alt: "" }));
  a.append(thumb);
  const info = el("div");
  info.append(el("div", { class: "info-title" }, r.title));
  const sub = [fmtAccount(r.account)];
  if (r.version > 1) sub.push(`v${r.version}`);
  if (r.duration) sub.push(fmtDuration(r.duration));
  info.append(el("div", { class: "info-sub" }, sub.join(" · ")));
  a.append(info);
  return a;
}

function bindTabs() {
  const tabs = document.getElementById("tabs");
  tabs.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      tabs.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      renderTab(b.dataset.tab);
    };
  });
}

function bindShortcuts(song) {
  if (_keyAbort) _keyAbort.abort();
  _keyAbort = new AbortController();
  const audio = currentAudio;
  const TAB_NAMES = ["dj", "generate", "lyrics", "design", "sources", "prompts", "batch"];

  function focusedOnInput() {
    const t = document.activeElement;
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  }

  document.addEventListener("keydown", (e) => {
    if (focusedOnInput()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") {
      e.preventDefault();
      audio.paused ? audio.play() : audio.pause();
    } else if (k === "j") {
      e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - 10);
    } else if (k === "l") {
      e.preventDefault(); audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
    } else if (k === "m") {
      e.preventDefault(); audio.muted = !audio.muted;
    } else if (k === "n") {
      e.preventDefault();
      const nx = _related[0];
      if (nx) { queueAutoplayForRoute(); location.hash = `#/song/${nx.id}`; } else toast("No next song.");
    } else if (k === "p") {
      e.preventDefault();
      const sources = song.sources || [];
      if (sources.length) { queueAutoplayForRoute(); location.hash = `#/song/${sources[0].id}`; }
      else toast("No source/parent.");
    } else if (k >= "1" && k <= "7") {
      e.preventDefault();
      const idx = parseInt(k, 10) - 1;
      const tabName = TAB_NAMES[idx];
      const btn = document.querySelector(`#tabs button[data-tab="${tabName}"]`);
      if (btn) btn.click();
    } else if (k === "/") {
      e.preventDefault();
      document.getElementById("search").focus();
    }
  }, { signal: _keyAbort.signal });
}

function bindTransport(audio, song, signal) {
  const playBtn = document.getElementById("tp-play");
  const prevBtn = document.getElementById("tp-prev");
  const nextBtn = document.getElementById("tp-next");
  const scrub = document.getElementById("tp-scrub");
  const muteBtn = document.getElementById("tp-mute");
  const vol = document.getElementById("tp-vol");
  const status = document.getElementById("lcd-status");
  if (!playBtn || !scrub) return;

  const refreshPlay = () => {
    const playing = !audio.paused;
    playBtn.textContent = playing ? "❚❚" : "▶";
    if (status) status.textContent = playing ? "▶" : "❚❚";
  };
  playBtn.onclick = () => { audio.paused ? audio.play() : audio.pause(); };
  audio.addEventListener("play", refreshPlay, { signal });
  audio.addEventListener("pause", refreshPlay, { signal });
  refreshPlay();

  // Scrub bar — uses 0..1000 to keep granularity without bothering with float steps
  let scrubbing = false;
  const scrubFromAudio = () => {
    if (scrubbing) return;
    const total = audio.duration || song.duration || 0;
    if (!total) return;
    scrub.value = String(Math.round((audio.currentTime / total) * 1000));
  };
  audio.addEventListener("timeupdate", scrubFromAudio, { signal });
  audio.addEventListener("loadedmetadata", scrubFromAudio, { signal });
  scrub.addEventListener("input", () => {
    scrubbing = true;
    const total = audio.duration || song.duration || 0;
    if (total) audio.currentTime = (Number(scrub.value) / 1000) * total;
  });
  scrub.addEventListener("change", () => { scrubbing = false; });

  // Volume + mute
  vol.value = String(Math.round(audio.volume * 100));
  vol.oninput = () => { audio.volume = Number(vol.value) / 100; if (audio.volume > 0) audio.muted = false; };
  muteBtn.onclick = () => { audio.muted = !audio.muted; muteBtn.textContent = audio.muted ? "🔇" : "🔊"; };

  prevBtn.onclick = () => {
    const sources = song.sources || [];
    if (sources.length) { queueAutoplayForRoute(); location.hash = `#/song/${sources[0].id}`; }
    else toast("No source/parent.");
  };
  nextBtn.onclick = () => {
    const next = _related[0];
    if (next) { queueAutoplayForRoute(); location.hash = `#/song/${next.id}`; }
    else toast("No next song.");
  };
}

let _karaokeOn = true;
function bindKaraoke(audio, song, signal) {
  const overlay = document.getElementById("lyric-overlay");
  const toggle = document.getElementById("tp-karaoke");
  if (!overlay || !toggle) return;

  // Apply persisted design settings (font, color, effects) before we render.
  try { applyDesignSettings(song.id); }
  catch (e) { console.warn("design settings failed", e); }

  const apply = () => {
    overlay.hidden = !_karaokeOn;
    toggle.classList.toggle("on", _karaokeOn);
  };
  toggle.onclick = () => { _karaokeOn = !_karaokeOn; apply(); };
  apply();

  if (!song.lyrics || !song.lyrics.length) {
    overlay.hidden = true;
    return;
  }

  const lines = song.lyrics.filter((l) => l.text && l.text.trim());
  let lastIdx = -1;
  const handler = (e) => {
    if (overlay.hidden) return;
    const { t, total } = e.detail;
    if (!total || !lines.length) return;
    const segment = total / lines.length;
    const idx = Math.min(lines.length - 1, Math.floor(t / segment));
    const lineProgress = Math.min(1, Math.max(0, (t - idx * segment) / segment));

    if (idx !== lastIdx) {
      const lineMode = overlay.dataset.lineMode || "line";
      if (lineMode === "paragraph") {
        // Show a window of 10 lines: 2 past + current + 7 upcoming
        const winStart = Math.max(0, idx - 2);
        const winEnd = Math.min(lines.length - 1, idx + 7);
        let html = "";
        for (let i = winStart; i <= winEnd; i++) {
          const txt = escapeHtml(lines[i].text);
          if (i === idx) {
            html += `<div class="lyric-line-current" data-text="${txt}">${txt}</div>`;
          } else {
            const cls = i < idx ? "lyric-line-para past" : "lyric-line-para";
            html += `<div class="${cls}">${txt}</div>`;
          }
        }
        overlay.innerHTML = html;
      } else {
        const cur = lines[idx]?.text || "";
        const nxt = lines[idx + 1]?.text || "";
        overlay.innerHTML =
          `<div class="lyric-line-current" data-text="${escapeHtml(cur)}">${escapeHtml(cur)}</div>` +
          (nxt ? `<div class="lyric-line-next">${escapeHtml(nxt)}</div>` : "");
      }
      lastIdx = idx;
    }
    overlay.style.setProperty("--fill-progress", lineProgress.toFixed(3));
  };
  document.addEventListener("audio:tick", handler, { signal });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function refreshPlayerVisual(song) {
  const visual = document.getElementById("visual");
  if (!visual) return;
  api.song(song.id).then((fresh) => {
    _currentSong = fresh;
    _track = (fresh.gens || []).filter((g) => g.status === "completed" && g.file_path);
    _activeClipIdx = -1;
    paintVisual(visual, fresh);
    renderTrackStrip(fresh);
  }).catch(() => { /* ignore */ });
}

function paintVisual(visual, song) {
  visual.innerHTML = "";
  visual.classList.remove("with-art", "full-art");
  const completedGens = (song.gens || []).filter((g) => g.status === "completed" && g.file_path);
  const firstGen = completedGens[0];

  if (firstGen) {
    // First in track plays first; auto-advance handled by audio:timeupdate.
    _activeClipIdx = 0;
    showClip(firstGen);
    return;
  }

  if (song.jpg_path) {
    visual.classList.add("with-art");
    const url = mediaUrl.cover(song.id);
    const bg = el("div", { class: "blur-bg" });
    bg.style.backgroundImage = `url(${url})`;
    const wrap = el("div", { class: "center-art" });
    const coverImg = el("img", { src: url, alt: "" });
    coverImg.addEventListener("load", () => {
      if (coverImg.naturalWidth && coverImg.naturalWidth < 200) {
        coverImg.classList.add("lowres");
      }
    }, { once: true });
    wrap.append(coverImg);
    visual.append(bg, wrap);
  } else {
    const c = channelColor(song.account);
    visual.style.background = `linear-gradient(150deg, ${c}3 0%, ${c}9 100%)`;
  }
}

export function getCurrentAudio() { return currentAudio || getAudio(); }
