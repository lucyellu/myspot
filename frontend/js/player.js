import { api, mediaUrl } from "./api.js";
import { fmtDuration, fmtAccount, toast } from "./util.js";

let _audio = null;
let _song = null;
let _related = [];
let _sources = [];
let _routeAutoplay = false;
let _scrubbing = false;

function ensureAudio() {
  if (!_audio) {
    _audio = document.getElementById("global-audio");
    if (!_audio) {
      _audio = document.createElement("audio");
      _audio.id = "global-audio";
      _audio.preload = "metadata";
      document.body.append(_audio);
    }
    _audio.crossOrigin = "anonymous";
  }
  return _audio;
}

function mini() {
  return {
    root: document.getElementById("persistent-player"),
    art: document.getElementById("pp-art"),
    title: document.getElementById("pp-title"),
    meta: document.getElementById("pp-meta"),
    time: document.getElementById("pp-time"),
    scrub: document.getElementById("pp-scrub"),
    play: document.getElementById("pp-play"),
    stop: document.getElementById("pp-stop"),
    prev: document.getElementById("pp-prev"),
    next: document.getElementById("pp-next"),
    mute: document.getElementById("pp-mute"),
    vol: document.getElementById("pp-vol"),
    close: document.getElementById("pp-close"),
    collapse: document.getElementById("pp-collapse"),
    open: document.getElementById("pp-art"),
  };
}

function showMini(show = true) {
  const p = mini();
  if (!p.root) return;
  p.root.hidden = !show;
  document.body.classList.toggle("has-persistent-player", show);
}

function updateMediaSession() {
  if (!("mediaSession" in navigator) || !_song) return;
  const artwork = _song.jpg_path ? [{ src: mediaUrl.cover(_song.id), sizes: "512x512", type: "image/jpeg" }] : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: _song.title || "Untitled",
    artist: fmtAccount(_song.account),
    album: "myspot",
    artwork,
  });
}

function renderMini() {
  const audio = ensureAudio();
  const p = mini();
  if (!p.root || !_song) return;
  showMini(true);
  p.title.textContent = _song.title || "Untitled";
  p.title.href = `#/song/${_song.id}`;
  p.meta.textContent = [fmtAccount(_song.account), _song.genre].filter(Boolean).join(" · ");
  if (_song.jpg_path) {
    p.art.style.backgroundImage = `url(${mediaUrl.cover(_song.id)})`;
    p.art.textContent = "";
  } else {
    p.art.style.backgroundImage = "";
    p.art.textContent = "♫";
  }
  p.play.textContent = audio.paused ? "▶" : "❚❚";
  p.mute.textContent = audio.muted ? "🔇" : "🔊";
  p.vol.value = String(Math.round(audio.volume * 100));
  updateProgress();
  updateMediaSession();
}

function updateProgress() {
  const audio = ensureAudio();
  const p = mini();
  if (!p.scrub || !p.time) return;
  const total = audio.duration || _song?.duration || 0;
  const cur = audio.currentTime || 0;
  if (!_scrubbing) p.scrub.value = total ? String(Math.round((cur / total) * 1000)) : "0";
  p.time.textContent = `${fmtDuration(cur)} / ${fmtDuration(total)}`;
  document.dispatchEvent(new CustomEvent("audio:tick", { detail: { t: cur, total } }));
}

async function hydrateRelated(songId) {
  try { _related = await api.related(songId, 24); }
  catch { _related = []; }
}

export function initPersistentPlayer() {
  const audio = ensureAudio();
  const p = mini();
  if (!p.root) return;

  p.play.onclick = () => {
    if (!_song) return;
    audio.paused ? audio.play().catch((e) => toast("Play failed: " + e.message)) : audio.pause();
  };
  p.stop.onclick = () => {
    audio.pause();
    audio.currentTime = 0;
    renderMini();
    toast("Playback stopped");
  };
  p.close.onclick = () => stopAndClear();
  p.prev.onclick = () => {
    const prev = _sources[0];
    if (!prev) return toast("No previous song.");
    _routeAutoplay = !audio.paused;
    location.hash = `#/song/${prev.id}`;
  };
  p.next.onclick = () => {
    const next = _related[0];
    if (!next) return toast("No next song.");
    _routeAutoplay = !audio.paused;
    location.hash = `#/song/${next.id}`;
  };
  p.mute.onclick = () => {
    audio.muted = !audio.muted;
    renderMini();
  };
  p.vol.oninput = () => {
    audio.volume = Number(p.vol.value) / 100;
    if (audio.volume > 0) audio.muted = false;
    renderMini();
  };
  p.scrub.addEventListener("input", () => {
    _scrubbing = true;
    const total = audio.duration || _song?.duration || 0;
    if (total) audio.currentTime = (Number(p.scrub.value) / 1000) * total;
    updateProgress();
  });
  p.scrub.addEventListener("change", () => { _scrubbing = false; updateProgress(); });
  p.collapse.onclick = () => {
    p.root.classList.toggle("compact");
    p.collapse.textContent = p.root.classList.contains("compact") ? "▴" : "▾";
  };
  p.open.onclick = () => {
    if (_song) location.hash = `#/song/${_song.id}`;
  };

  audio.addEventListener("play", renderMini);
  audio.addEventListener("pause", renderMini);
  audio.addEventListener("volumechange", renderMini);
  audio.addEventListener("loadedmetadata", updateProgress);
  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("ended", () => {
    const next = _related[0];
    if (next) {
      _routeAutoplay = true;
      location.hash = `#/song/${next.id}`;
    } else {
      renderMini();
    }
  });

  if ("mediaSession" in navigator) {
    const setAction = (name, handler) => {
      try { navigator.mediaSession.setActionHandler(name, handler); } catch { /* unsupported action */ }
    };
    setAction("play", () => audio.play().catch(() => {}));
    setAction("pause", () => audio.pause());
    setAction("stop", () => {
      audio.pause();
      audio.currentTime = 0;
      renderMini();
    });
    setAction("nexttrack", () => p.next.click());
    setAction("previoustrack", () => p.prev.click());
  }

  showMini(false);
}

export function queueAutoplayForRoute() {
  _routeAutoplay = true;
}

export function setPlayerContext({ related = null, sources = null } = {}) {
  if (related) _related = related;
  if (sources) _sources = sources;
}

export function loadPlayerSong(song, { autoplay = false, preserveQueue = false } = {}) {
  const audio = ensureAudio();
  const nextSrc = mediaUrl.audio(song.id);
  const wasPlaying = !audio.paused;
  const sameSong = _song?.id === song.id && audio.src.includes(`/media/audio/${song.id}`);

  _song = song;
  _sources = song.sources || _sources || [];
  if (!sameSong) {
    audio.src = nextSrc;
    audio.load();
    if (!preserveQueue) {
      _related = [];
      hydrateRelated(song.id).then(renderMini);
    }
  }

  renderMini();
  const shouldAutoplay = autoplay || _routeAutoplay || (wasPlaying && !sameSong);
  _routeAutoplay = false;
  if (shouldAutoplay) audio.play().catch((e) => toast("Play failed: " + e.message));
  return audio;
}

export function playSongNow(song) {
  return loadPlayerSong(song, { autoplay: true });
}

export function playQueuedSong(song, { related = [], sources = [] } = {}) {
  const audio = loadPlayerSong(song, { autoplay: true, preserveQueue: true });
  _related = related;
  _sources = sources;
  renderMini();
  return audio;
}

export function stopAndClear() {
  const audio = ensureAudio();
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  _song = null;
  _related = [];
  _sources = [];
  _routeAutoplay = false;
  showMini(false);
  document.dispatchEvent(new CustomEvent("myspot:playerstop"));
  toast("Player off");
}

export function getAudio() {
  return ensureAudio();
}
