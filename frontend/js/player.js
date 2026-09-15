import { api, mediaUrl } from "./api.js";
import { fmtDuration, fmtAccount, toast } from "./util.js";

const SESSION_KEY = "myspot.playlist.v2";

let _audio = null;
let _song = null;
let _related = [];
let _sources = [];
let _playlist = [];
let _playlistIndex = -1;
let _query = null;
let _contextName = "";
let _isFetchingMore = false;
let _routeAutoplay = false;
let _scrubbing = false;

function loadPersistedPlaylist() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.playlist)) _playlist = data.playlist;
    if (typeof data.index === "number") _playlistIndex = data.index;
    if (data.query) _query = data.query;
    if (data.contextName) _contextName = data.contextName;
  } catch { /* ignore */ }
}

function savePersistedPlaylist() {
  try {
    const items = _playlist.slice(0, 200).map((s) => ({
      id: s.id,
      title: s.title,
      account: s.account,
      duration: s.duration,
      jpg_path: s.jpg_path,
      video_path: s.video_path,
      video_only: s.video_only,
      version: s.version,
      genre: s.genre,
      liked: s.liked,
      suno_id: s.suno_id,
      suno_date: s.suno_date,
      bpm: s.bpm,
    }));
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        playlist: items,
        index: _playlistIndex,
        query: _query,
        contextName: _contextName,
      })
    );
  } catch { /* ignore */ }
}

loadPersistedPlaylist();

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
    album: _contextName || "myspot",
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

export function setPlaylistContext({ playlist = [], index = -1, query = null, contextName = "", song = null } = {}) {
  if (Array.isArray(playlist) && playlist.length > 0) {
    _playlist = [...playlist];
    if (song) {
      const foundIdx = _playlist.findIndex((s) => s.id === song.id);
      _playlistIndex = foundIdx >= 0 ? foundIdx : (index >= 0 ? index : 0);
    } else {
      _playlistIndex = index >= 0 ? index : 0;
    }
  }
  if (query !== undefined) _query = query;
  if (contextName !== undefined) _contextName = contextName;
  savePersistedPlaylist();
}

export function appendPlaylistSongs(songs = [], { total = null } = {}) {
  if (!Array.isArray(songs) || !songs.length) return;
  const existingIds = new Set(_playlist.map((s) => s.id));
  const newItems = songs.filter((s) => !existingIds.has(s.id));
  if (newItems.length) {
    _playlist.push(...newItems);
  }
  if (total !== null && _query) {
    _query.total = total;
  }
  savePersistedPlaylist();
}

export function getPlaylistContext() {
  return {
    playlist: _playlist,
    index: _playlistIndex,
    query: _query,
    contextName: _contextName,
  };
}

export function getUpcomingSongs(limit = 24) {
  if (_playlist.length > 0 && _playlistIndex >= 0) {
    const upcoming = _playlist.slice(_playlistIndex + 1, _playlistIndex + 1 + limit);
    if (upcoming.length < limit && _query && (_query.total == null || _playlist.length < _query.total) && !_isFetchingMore) {
      prefetchNextBatch();
    }
    return upcoming;
  }
  return _related.slice(0, limit);
}

async function prefetchNextBatch() {
  if (!_query || _isFetchingMore) return;
  _isFetchingMore = true;
  try {
    const offset = _playlist.length;
    const res = await api.songs({ ..._query, offset, limit: 60 });
    if (res && res.items && res.items.length) {
      appendPlaylistSongs(res.items, { total: res.total });
    }
  } catch { /* ignore */ }
  finally { _isFetchingMore = false; }
}

export async function getNextSongAsync() {
  if (_playlist.length > 0) {
    if (_playlistIndex + 1 < _playlist.length) {
      return _playlist[_playlistIndex + 1];
    }
    if (_query && (_query.total == null || _playlist.length < _query.total)) {
      await prefetchNextBatch();
      if (_playlistIndex + 1 < _playlist.length) {
        return _playlist[_playlistIndex + 1];
      }
    }
    return null;
  }
  return _related[0] || null;
}

export function getPrevSong() {
  if (_playlist.length > 0 && _playlistIndex > 0) {
    return _playlist[_playlistIndex - 1];
  }
  if (_sources && _sources.length) {
    return _sources[0];
  }
  return null;
}

export async function playNextSong({ autoplay = true } = {}) {
  const audio = ensureAudio();
  const next = await getNextSongAsync();
  if (next) {
    _routeAutoplay = autoplay || !audio.paused;
    location.hash = `#/song/${next.id}`;
    return next;
  }
  toast("No next song.");
  return null;
}

export function playPrevSong({ autoplay = true } = {}) {
  const audio = ensureAudio();
  const prev = getPrevSong();
  if (prev) {
    _routeAutoplay = autoplay || !audio.paused;
    location.hash = `#/song/${prev.id}`;
    return prev;
  }
  toast("No previous song.");
  return null;
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
  p.prev.onclick = () => playPrevSong();
  p.next.onclick = () => playNextSong();
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
    playNextSong({ autoplay: true });
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
    setAction("nexttrack", () => playNextSong());
    setAction("previoustrack", () => playPrevSong());
  }

  showMini(false);
}

export function queueAutoplayForRoute() {
  _routeAutoplay = true;
}

export function setPlayerContext({ related = null, sources = null, playlist = null, index = -1, query = null, contextName = "" } = {}) {
  if (related) _related = related;
  if (sources) _sources = sources;
  if (playlist) {
    _playlist = playlist;
    _playlistIndex = index >= 0 ? index : 0;
    _query = query;
    _contextName = contextName;
    savePersistedPlaylist();
  } else if (related && !playlist) {
    _playlist = [];
    _playlistIndex = -1;
    _query = null;
    _contextName = contextName || "";
    savePersistedPlaylist();
  }
}

export function loadPlayerSong(song, { autoplay = false, preserveQueue = false } = {}) {
  const audio = ensureAudio();
  const nextSrc = mediaUrl.audio(song.id);
  const wasPlaying = !audio.paused;
  const sameSong = _song?.id === song.id && audio.src.includes(`/media/audio/${song.id}`);

  _song = song;
  _sources = song.sources || _sources || [];

  if (_playlist.length > 0) {
    const idx = _playlist.findIndex((s) => s.id === song.id);
    if (idx >= 0) {
      _playlistIndex = idx;
      savePersistedPlaylist();
    }
  }

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

export function playQueuedSong(song, { related = [], sources = [], playlist = null, index = -1 } = {}) {
  const audio = loadPlayerSong(song, { autoplay: true, preserveQueue: true });
  _related = related;
  _sources = sources;
  if (playlist) {
    _playlist = playlist;
    _playlistIndex = index >= 0 ? index : 0;
    savePersistedPlaylist();
  }
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
