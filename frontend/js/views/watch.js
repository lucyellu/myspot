import { api, mediaUrl } from "../api.js";
import { fmtDuration, fmtAccount, el, clear, toast } from "../util.js";
import { renderTab, currentTab, setSong } from "../sidepanel.js";
import { attachHalftone } from "../components/halftone.js";

let currentAudio = null;
let _related = [];
let _keyAbort = null;
let _track = [];          // ordered list of completed gens for the song
let _activeClipIdx = -1;
let _currentSong = null;

export async function renderWatch(songId) {
  const view = document.getElementById("view");
  clear(view);
  const tpl = document.getElementById("tpl-watch").content.cloneNode(true);
  view.append(tpl);

  const song = await api.song(songId);
  if (!song) { view.innerHTML = "<p class='empty-state'>Song not found.</p>"; return; }

  document.title = `myspot · ${song.title}`;

  _currentSong = song;
  _track = (song.gens || []).filter((g) => g.status === "completed" && g.file_path);
  paintVisual(document.getElementById("visual"), song);
  renderTrackStrip(song);
  bindCanvasDrops(song);
  initMediaTray(song);
  const audio = document.getElementById("audio");
  audio.src = mediaUrl.audio(song.id);
  audio.crossOrigin = "anonymous"; // needed for Web Audio analyser
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
  audio.addEventListener("loadedmetadata", updateLcd);
  audio.addEventListener("timeupdate", updateLcd);
  updateLcd();
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
  audio.addEventListener("timeupdate", checkPlay);
  // Also tell the extension which song is open
  api.setExtensionCurrentSong(song.id).catch(() => {});

  // Up next
  const upNext = document.getElementById("up-next");
  clear(upNext);
  _related = await api.related(song.id, 24);
  for (const r of _related) upNext.append(upRow(r));

  // Sidepanel
  setSong(song);
  bindTabs();
  renderTab(currentTab());

  // Auto-play next sibling/derivative when current ends
  audio.addEventListener("ended", () => {
    const next = _related[0];
    if (next) location.hash = `#/song/${next.id}`;
  });

  bindShortcuts(song);

  // Lyrics scroll sync (simple progress-based highlight; estimate timestamps later)
  // Plus live slideshow: advance visual based on playback position when >= 2 clips
  audio.addEventListener("timeupdate", () => {
    const total = audio.duration || song.duration;
    const t = audio.currentTime;
    const detail = { t, total };
    document.dispatchEvent(new CustomEvent("audio:tick", { detail }));
    if (_track.length >= 2 && total) {
      const idx = Math.min(_track.length - 1, Math.floor((t / total) * _track.length));
      if (idx !== _activeClipIdx) {
        _activeClipIdx = idx;
        showClip(_track[idx]);
        highlightActiveClip();
      }
    }
  });
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
  if (!_track.length) {
    strip.append(el("div", { class: "track-empty" },
      "Drop images / videos / assets onto the player to build your visual track. They'll play in sequence with the audio."));
    return;
  }
  _track.forEach((g, i) => {
    const clip = el("div", { class: "track-clip", "data-idx": i });
    if (i === _activeClipIdx) clip.classList.add("active");
    if (g.kind === "video") {
      clip.append(el("video", { src: mediaUrl.gen(g.id), muted: true, loop: true, playsinline: true }));
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

let _trayFolder = "_gens";
let _trayOffset = 0;
let _trayTotal = 0;
const _PAGE = 60;

async function initMediaTray(song) {
  const select = document.getElementById("media-tray-folder");
  if (!select) return;
  // Build folder dropdown
  let folders = [{ folder: "_gens", n: 0, label: "Gens (output)" }];
  try {
    const list = await api.assetFolders();
    for (const f of list) {
      if (f.folder === "_gens") {
        folders[0].n = f.n;
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
  select.value = _trayFolder;
  select.onchange = () => loadTray(select.value);

  document.getElementById("media-tray-more").onclick = () => loadTrayMore();

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
  // Open the tray if it's collapsed
  const tray = document.getElementById("media-tray");
  if (tray) tray.open = true;
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
      path = "C:\\Users\\lucyl\\Desktop\\myspot\\data\\gens\\";
      const r = await api.gensBrowse({ limit: _PAGE, offset: 0 });
      items = (r.items || []).map((g) => ({
        kind: g.kind, src: mediaUrl.gen(g.id), tag: `${g.tool} • #${g.song_id}`,
        attach: () => attachGenToCurrent(g),
      }));
      _trayTotal = r.total;
    } else {
      path = `C:\\Users\\lucyl\\Desktop\\myspot\\assets\\${folder}\\`;
      const r = await api.assets({ folder, limit: _PAGE, offset: 0 });
      items = (r.items || []).map((a) => ({
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
        kind: g.kind, src: mediaUrl.gen(g.id), tag: `${g.tool} • #${g.song_id}`,
        attach: () => attachGenToCurrent(g),
      }));
    } else {
      const r = await api.assets({ folder: _trayFolder, limit: _PAGE, offset: _trayOffset });
      items = (r.items || []).map((a) => ({
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
  const tile = el("div", { class: "media-tray-tile", title: "Click to attach to current song" });
  if (item.kind === "video") {
    tile.append(el("video", { src: item.src, muted: true, loop: true, playsinline: true,
      onmouseenter: (e) => e.currentTarget.play().catch(() => {}),
      onmouseleave: (e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; },
    }));
  } else {
    tile.append(el("img", { src: item.src, loading: "lazy", alt: "" }));
  }
  tile.append(el("span", { class: "tray-tile-tag" }, item.tag || ""));
  tile.append(el("span", { class: "tray-tile-attach" }, "+ track"));
  tile.onclick = item.attach;
  return tile;
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
  const TAB_NAMES = ["generate", "lyrics", "sources", "prompts", "queue", "notes"];

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
      if (nx) location.hash = `#/song/${nx.id}`; else toast("No next song.");
    } else if (k === "p") {
      e.preventDefault();
      const sources = song.sources || [];
      if (sources.length) location.hash = `#/song/${sources[0].id}`;
      else toast("No source/parent.");
    } else if (k >= "1" && k <= "6") {
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
    // Suno cover — only 40x40 in this library, so blur-backdrop + centered sharp.
    visual.classList.add("with-art");
    const url = mediaUrl.cover(song.id);
    const bg = el("div", { class: "blur-bg" });
    bg.style.backgroundImage = `url(${url})`;
    const wrap = el("div", { class: "center-art" });
    wrap.append(el("img", { src: url, alt: "" }));
    visual.append(bg, wrap);
  }
}

export function getCurrentAudio() { return currentAudio; }
