import { api, mediaUrl } from "../api.js?v=radio2";
import { el, clear, fmtDuration, fmtAccount, toast } from "../util.js";
import { getAudio, playQueuedSong, setPlayerContext } from "../player.js?v=radio-longform1";

const STORE_KEY = "myspot.radio.v1";
const HISTORY_KEY = "myspot.radio.history.v1";
const DEFAULTS = {
  place: "Vancouver",
  host: "pop-theory-cool-kid",
  mood: "auto",
  brands: "Teenage Engineering, Muji, Bandcamp, Criterion, local coffee, weird synth shops",
  buildZone: "America/New_York",
  airZone: "America/Los_Angeles",
  leadMinutes: 45,
  showDate: "",
  airTime: "06:00",
  targetHours: 1,
  showFormat: "morning",
  dailyAgenda: "",
  bookmarkNotes: "",
};

const HOSTS = [
  ["pop-theory-cool-kid", "Pop-Theory Cool Kid"],
  ["crate-digger", "Crate-Digging Producer"],
  ["cosmic-fm", "Late-Night Cosmic FM"],
  ["comedy-story-editor", "Comedy Story Editor"],
  ["luxury-bumper", "Luxury Bumper Voice"],
];

const SHOW_FORMATS = [
  ["morning", "Morning Show"],
  ["freeform", "Freeform Tape"],
  ["late", "Late Show"],
];

function prefs() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    const out = { ...DEFAULTS, ...stored };
    if ((out.showFormat || "morning") === "morning" && Number(out.targetHours) === 3) out.targetHours = 1;
    return out;
  }
  catch { return { ...DEFAULTS }; }
}

function savePrefs(p) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export async function renderRadio() {
  if (window.__myspotRadioAbort) window.__myspotRadioAbort.abort();
  const events = new AbortController();
  window.__myspotRadioAbort = events;
  const view = document.getElementById("view");
  clear(view);
  const p = prefs();

  const shell = el("section", { class: "radio-page" });
  const head = el("header", { class: "radio-head" });
  head.append(
    el("div", {},
      el("h1", {}, "AI RADIO"),
      el("p", {}, "A host-led station for your library: music taste, weather, dream sponsors, and quick song picks.")),
  );
  const live = el("div", { class: "radio-live" }, "LIVE LOCAL");
  head.append(live);

  const receiver = el("section", { class: "radio-receiver", "aria-label": "Classic radio tuner" });
  const receiverArt = el("div", { class: "radio-receiver-art" }, "♫");
  const receiverTitle = el("strong", {}, "Tuning station...");
  const receiverSub = el("span", {}, "Daily pick is warming up.");
  const receiverContext = el("div", { class: "radio-receiver-context" }, "LOCAL SIGNAL");
  const receiverNeedle = el("span", { class: "radio-needle" });
  const receiverPreload = el("span", { class: "radio-preload" }, "BUFFERING");
  const receiverTime = el("span", {}, "0:00 / 0:00");
  const replayState = el("strong", {}, "LIVE");
  const replayScrub = el("input", { class: "radio-replay-scrub", type: "range", min: "0", max: "1000", value: "0", step: "1", "aria-label": "Scrub current song" });
  const rewindBtn = el("button", { class: "radio-mini-btn", type: "button", title: "Replay previous aired song" }, "⏮");
  const forwardBtn = el("button", { class: "radio-mini-btn", type: "button", title: "Next show segment" }, "⏭");
  const liveBtn = el("button", { class: "radio-mini-btn wide", type: "button", title: "Jump to the current live station pick" }, "LIVE");
  const offBtn = el("button", { class: "radio-off-btn", type: "button", title: "Stop all radio audio and voice" }, "OFF");
  const tuneBtn = el("button", { class: "radio-tune-btn", type: "button" },
    el("span", {}, "Tune In"),
    el("small", {}, "play today's signal"),
  );
  receiver.append(
    el("div", { class: "radio-speaker", "aria-hidden": "true" },
      el("span"), el("span"), el("span"), el("span"), el("span")),
    el("div", { class: "radio-face" },
      el("div", { class: "radio-dial-top" },
        el("span", {}, "MYSPOT FM"),
        receiverPreload),
      el("div", { class: "radio-dial" },
        el("div", { class: "radio-dial-scale" },
          el("span", {}, "88"), el("span", {}, "94"), el("span", {}, "101"), el("span", {}, "108"),
          receiverNeedle),
        receiverContext),
      el("div", { class: "radio-receiver-song" },
        receiverArt,
        el("div", {}, receiverTitle, receiverSub)),
      el("div", { class: "radio-replay-bar" },
        el("div", { class: "radio-replay-meta" },
          replayState,
          receiverTime),
        replayScrub)),
    el("div", { class: "radio-knob-wrap" },
      tuneBtn,
      el("div", { class: "radio-skip-row" }, rewindBtn, liveBtn, forwardBtn),
      offBtn,
      el("div", { class: "radio-knob", "aria-hidden": "true" }, el("span"))),
  );

  const grid = el("div", { class: "radio-grid" });
  const station = el("section", { class: "radio-pane radio-station" });
  const now = el("section", { class: "radio-pane radio-now" });
  const host = el("section", { class: "radio-pane radio-host" });
  grid.append(station, now, host);
  shell.append(head, receiver, grid);
  view.append(shell);

  let context = fallbackContext(p.place);
  let selected = null;
  let songs = [];
  let prebufferedId = null;
  let liveSong = null;
  let replayIndex = -1;
  let replayQueue = [];
  let scrubbingReplay = false;
  let showSegments = [];
  let currentSegmentIndex = -1;
  let showPlaying = false;
  let currentUtterance = null;
  let currentSpeechTimer = null;
  let currentShowId = null;

  station.append(el("h2", {}, "Station"));
  const formatSel = el("select", {});
  SHOW_FORMATS.forEach(([id, label]) => formatSel.append(el("option", { value: id }, label)));
  formatSel.value = p.showFormat || "morning";
  const hostSel = el("select", {});
  HOSTS.forEach(([id, label]) => hostSel.append(el("option", { value: id }, label)));
  hostSel.value = p.host;
  const moodSel = el("select", {});
  ["auto", "late-night", "rainy", "psychedelic", "funny", "tender", "party", "weird"].forEach((m) =>
    moodSel.append(el("option", { value: m }, m.toUpperCase())));
  moodSel.value = p.mood;
  const placeInput = el("input", { value: p.place, placeholder: "Weather city" });
  const buildZoneSel = el("select", {});
  const airZoneSel = el("select", {});
  [
    ["America/New_York", "NEW YORK"],
    ["America/Chicago", "CHICAGO"],
    ["America/Denver", "DENVER"],
    ["America/Los_Angeles", "LOS ANGELES"],
    ["America/Vancouver", "VANCOUVER"],
    ["UTC", "UTC"],
  ].forEach(([value, label]) => {
    buildZoneSel.append(el("option", { value }, label));
    airZoneSel.append(el("option", { value }, label));
  });
  buildZoneSel.value = p.buildZone;
  airZoneSel.value = p.airZone;
  const leadInput = el("input", { type: "number", min: "0", max: "240", step: "5", value: String(p.leadMinutes) });
  if (!p.showDate) p.showDate = localDateInputValue(new Date());
  const showDateInput = el("input", { type: "date", value: p.showDate });
  const airTimeInput = el("input", { type: "time", value: p.airTime || "06:00" });
  const targetHoursInput = el("input", { type: "number", min: "0.25", max: "12", step: "0.25", value: String(p.targetHours) });
  const brands = el("textarea", {}, p.brands);
  const dailyAgenda = el("textarea", { placeholder: "Optional: meetings, birthdays, plans, things the host should mention." }, p.dailyAgenda || "");
  const bookmarkNotes = el("textarea", { placeholder: "Optional: paste bookmark/export notes until X auth is wired." }, p.bookmarkNotes || "");
  station.append(
    el("label", {}, "Show format", formatSel),
    el("label", {}, "Host voice", hostSel),
    el("label", {}, "Mood", moodSel),
    el("label", {}, "Weather", placeInput),
    el("label", {}, "Build timezone", buildZoneSel),
    el("label", {}, "Air timezone", airZoneSel),
    el("label", {}, "Lead minutes", leadInput),
    el("label", {}, "Show date", showDateInput),
    el("label", {}, "Air time", airTimeInput),
    el("label", {}, "Target hours", targetHoursInput),
    el("label", {}, "Dream sponsor taste", brands),
    el("label", {}, "Calendar / day notes", dailyAgenda),
    el("label", {}, "Bookmark notes", bookmarkNotes),
  );

  const stationActions = el("div", { class: "radio-actions" });
  const morningPresetBtn = el("button", { class: "btn primary", type: "button" }, "Today 1H");
  const weekdayOneHourBtn = el("button", { class: "btn", type: "button" }, "Build Today");
  const loadBackgroundBtn = el("button", { class: "btn", type: "button" }, "Load Today");
  const refresh = el("button", { class: "btn", type: "button" }, "Refresh Context");
  const makeShowBtn = el("button", { class: "btn", type: "button" }, "Make Show");
  const tomorrowBtn = el("button", { class: "btn", type: "button" }, "Tomorrow 1H");
  const addHourBtn = el("button", { class: "btn", type: "button" }, "Add Hour");
  const auto = el("button", { class: "btn", type: "button" }, "Auto Pick");
  stationActions.append(morningPresetBtn, weekdayOneHourBtn, loadBackgroundBtn, refresh, makeShowBtn, tomorrowBtn, addHourBtn, auto);
  station.append(stationActions);
  const connectorBox = el("div", { class: "radio-connectors" });
  station.append(connectorBox);
  const contextBox = el("div", { class: "radio-context" });
  station.append(contextBox);
  const scheduleBox = el("div", { class: "radio-schedule-box" });
  station.append(scheduleBox);

  now.append(el("h2", {}, "Now Playing"));
  const nowBody = el("div", { class: "radio-now-body" }, "Loading library...");
  now.append(nowBody);
  const songList = el("div", { class: "radio-song-list" });
  now.append(songList);

  host.append(el("h2", {}, "Show Rundown"));
  const hostActions = el("div", { class: "radio-actions" });
  const introBtn = el("button", { class: "btn", type: "button" }, "Write Intro");
  const weatherBtn = el("button", { class: "btn", type: "button" }, "Weather Break");
  const sponsorBtn = el("button", { class: "btn", type: "button" }, "Dream Sponsor");
  hostActions.append(introBtn, weatherBtn, sponsorBtn);
  host.append(hostActions);
  const historyActions = el("div", { class: "radio-history-actions" });
  const saveShowBtn = el("button", { class: "btn primary", type: "button" }, "Save Show");
  const historySelect = el("select", { class: "radio-history-select", "aria-label": "Saved radio shows" });
  const loadShowBtn = el("button", { class: "btn", type: "button" }, "Load");
  const deleteShowBtn = el("button", { class: "btn", type: "button" }, "Delete");
  historyActions.append(saveShowBtn, historySelect, loadShowBtn, deleteShowBtn);
  host.append(historyActions);
  const hostOut = el("div", { class: "radio-copy-list" });
  host.append(hostOut);

  const persist = () => {
    Object.assign(p, {
      showFormat: formatSel.value,
      host: hostSel.value,
      mood: moodSel.value,
      place: placeInput.value.trim() || "Vancouver",
      buildZone: buildZoneSel.value,
      airZone: airZoneSel.value,
      leadMinutes: Math.max(0, Math.min(240, Number(leadInput.value) || 0)),
      showDate: showDateInput.value || localDateInputValue(new Date()),
      airTime: airTimeInput.value || "06:00",
      targetHours: Math.max(0.25, Math.min(12, Number(targetHoursInput.value) || 1)),
      brands: brands.value,
      dailyAgenda: dailyAgenda.value,
      bookmarkNotes: bookmarkNotes.value,
    });
    savePrefs(p);
  };
  [formatSel, hostSel, moodSel, placeInput, buildZoneSel, airZoneSel, leadInput, showDateInput, airTimeInput, targetHoursInput, brands, dailyAgenda, bookmarkNotes].forEach((node) => {
    node.addEventListener("input", persist);
    node.addEventListener("change", persist);
  });
  [formatSel, buildZoneSel, airZoneSel, leadInput, showDateInput, airTimeInput, targetHoursInput, dailyAgenda, bookmarkNotes].forEach((node) => {
    node.addEventListener("input", () => { persist(); paintConnectors(); paintSchedule(); });
    node.addEventListener("change", () => { persist(); paintConnectors(); paintSchedule(); });
  });

  async function loadContext() {
    persist();
    refresh.disabled = true;
    try { context = await api.djContext({ place: p.place }); }
    catch { context = fallbackContext(p.place); }
    paintContext(contextBox, context);
    paintConnectors();
    paintReceiver();
    refresh.disabled = false;
  }

  async function loadSongs() {
    const data = await api.songs({ limit: 360, sort: "recent", dir: "desc" });
    songs = data.items || [];
    selected = songs[0] || null;
  }

  function paintSongs() {
    clear(songList);
    songs.forEach((s) => {
      const row = el("button", { class: "radio-song-row" + (selected?.id === s.id ? " active" : ""), type: "button" });
      row.append(
        cover(s),
        el("span", {}, el("strong", {}, s.title), el("small", {}, `${fmtAccount(s.account)} · ${fmtDuration(s.duration)}`)),
      );
      row.onclick = async () => {
        selectStationSong(s, { play: false, mode: "REPLAY" });
      };
      songList.append(row);
    });
  }

  async function ensureFullSong() {
    if (!selected) return null;
    if (!selected.lyrics) selected = await api.song(selected.id);
    return selected;
  }

  function paintNow() {
    clear(nowBody);
    if (!selected) {
      nowBody.textContent = "No songs loaded.";
      return;
    }
    const play = el("button", { class: "radio-play", type: "button" }, "▶");
    play.onclick = () => selectStationSong(selected, { play: true, mode: selected?.id === liveSong?.id ? "LIVE" : "REPLAY" });
    nowBody.append(cover(selected, "large"));
    nowBody.append(el("div", { class: "radio-now-copy" },
      el("h3", {}, selected.title),
      el("p", {}, [fmtAccount(selected.account), selected.genre, fmtDuration(selected.duration)].filter(Boolean).join(" · ")),
      play,
      el("a", { class: "btn", href: `#/song/${selected.id}` }, "Open Song Studio"),
    ));
  }

  function paintReceiver() {
    const wx = context.weather
      ? `${context.weather.summary} · ${weatherTemp(context.weather)}`
      : "weather warming up";
    receiverContext.textContent = `${(context.daypart || "local").toUpperCase()} / ${wx}`;
    const segment = showSegments[currentSegmentIndex] || null;
    if (segment?.type === "talk") {
      receiverTitle.textContent = segment.title;
      receiverSub.textContent = `host voice clip · ~${fmtDuration(segment.duration || estimateSpeechDuration(segment.text))}`;
      receiverArt.style.backgroundImage = "";
      receiverArt.textContent = "HOST";
      receiverNeedle.style.left = `${18 + (currentSegmentIndex % 6) * 12}%`;
      replayState.textContent = showPlaying ? "HOST" : "SCRIPT";
      tuneBtn.querySelector("span").textContent = showPlaying ? "Stop" : "Play Show";
      tuneBtn.querySelector("small").textContent = "spoken break";
      return;
    }
    if (!selected) {
      receiverTitle.textContent = "Tuning station...";
      receiverSub.textContent = "Daily pick is warming up.";
      receiverArt.style.backgroundImage = "";
      receiverArt.textContent = "♫";
      receiverNeedle.style.left = "18%";
      return;
    }
    receiverTitle.textContent = selected.title || "Untitled";
    receiverSub.textContent = [dailySignalLabel(context), fmtAccount(selected.account), fmtDuration(selected.duration)].filter(Boolean).join(" · ");
    if (selected.jpg_path) {
      receiverArt.style.backgroundImage = `url(${mediaUrl.cover(selected.id)})`;
      receiverArt.textContent = "";
    } else {
      receiverArt.style.backgroundImage = "";
      receiverArt.textContent = "♫";
    }
    receiverNeedle.style.left = `${frequencyPercent(selected, context)}%`;
    replayState.textContent = showSegments.length ? (selected?.id === liveSong?.id ? "LIVE" : "REPLAY") : "NO SHOW";
    tuneBtn.querySelector("span").textContent = showPlaying ? "Stop" : (showSegments.length ? "Play Show" : "Tune In");
    tuneBtn.querySelector("small").textContent = showSegments.length
      ? "host + songs"
      : (selected?.id === liveSong?.id ? "play today's signal" : "play replay buffer");
  }

  function prebufferSelected() {
    if (!selected || showSegments[currentSegmentIndex]?.type === "talk") return;
    const audio = getAudio();
    const player = document.getElementById("persistent-player");
    if (!audio || (player && !player.hidden)) {
      receiverPreload.textContent = audio?.paused === false ? "ON AIR" : "READY";
      return;
    }
    const src = mediaUrl.audio(selected.id);
    if (prebufferedId !== selected.id || !audio.src.includes(`/media/audio/${selected.id}`)) {
      audio.preload = "auto";
      audio.src = src;
      audio.load();
      prebufferedId = selected.id;
    }
    receiverPreload.textContent = "PRELOADED";
  }

  function paintReplayProgress() {
    const audio = getAudio();
    const segment = showSegments[currentSegmentIndex] || null;
    if (segment?.type === "talk") {
      const total = segment.duration || estimateSpeechDuration(segment.text);
      replayScrub.value = showPlaying ? "120" : "0";
      receiverTime.textContent = `${showPlaying ? "0:02" : "0:00"} / ${fmtDuration(total)}`;
      return;
    }
    const total = audio.duration || selected?.duration || 0;
    const cur = audio.currentTime || 0;
    if (!scrubbingReplay) replayScrub.value = total ? String(Math.round((cur / total) * 1000)) : "0";
    receiverTime.textContent = `${fmtDuration(cur)} / ${fmtDuration(total)}`;
  }

  function stationContext() {
    const prev = replayQueue.slice(0, Math.max(0, replayIndex)).reverse();
    const next = replayQueue.slice(replayIndex + 1);
    return { sources: prev, related: next };
  }

  function setPlayerQueueContext() {
    setPlayerContext(stationContext());
  }

  async function selectStationSong(song, { play = false, mode = null } = {}) {
    if (!song) return;
    selected = song.lyrics ? song : await api.song(song.id);
    replayIndex = Math.max(0, replayQueue.findIndex((s) => s.id === selected.id));
    setPlayerQueueContext();
    paintSongs();
    paintNow();
    paintReceiver();
    if (play) {
      receiverPreload.textContent = "ON AIR";
      playQueuedSong(selected, stationContext());
      paintReplayProgress();
    } else {
      prebufferSelected();
    }
    if (mode) replayState.textContent = mode;
  }

  function tuneIn() {
    if (showPlaying) {
      stopShow();
      return;
    }
    if (!showSegments.length) makeShow();
    playSegment(Math.max(0, currentSegmentIndex));
  }

  function replayPrevious() {
    if (!replayQueue.length) return;
    const idx = replayIndex > 0 ? replayIndex - 1 : replayQueue.length - 1;
    selectStationSong(replayQueue[idx], { play: true, mode: "REPLAY" });
  }

  function skipForward() {
    if (showSegments.length) {
      const next = currentSegmentIndex >= 0 ? currentSegmentIndex + 1 : 0;
      if (next >= showSegments.length) return stopShow();
      playSegment(next);
      return;
    }
    if (!replayQueue.length) return;
    const idx = replayIndex >= 0 ? (replayIndex + 1) % replayQueue.length : 0;
    selectStationSong(replayQueue[idx], { play: true, mode: replayQueue[idx]?.id === liveSong?.id ? "LIVE" : "REPLAY" });
  }

  function jumpLive() {
    if (!liveSong) return;
    const liveIndex = showSegments.findIndex((s) => s.type === "song" && s.song?.id === liveSong.id);
    if (liveIndex >= 0) playSegment(liveIndex);
    else selectStationSong(liveSong, { play: true, mode: "LIVE" });
  }

  function makeShow() {
    if (!songs.length) return toast("No songs loaded yet.");
    persist();
    const targetSeconds = Math.round((Number(p.targetHours) || 1) * 3600);
    const picks = choosePicksForRuntime(buildReplayQueue(songs, liveSong), targetSeconds);
    showSegments = buildShowSegments(picks, context, p);
    currentSegmentIndex = 0;
    replayQueue = picks;
    liveSong = picks.find((s) => s.id === liveSong?.id) || picks[0];
    selected = picks[0] || selected;
    replayIndex = Math.max(0, replayQueue.findIndex((s) => s.id === selected?.id));
    setPlayerQueueContext();
    paintSongs();
    paintNow();
    paintReceiver();
    paintRundown();
    paintSchedule();
    prebufferSelected();
    saveCurrentShow({ silent: true });
    populateHistorySelect();
    toast(`Radio show built: ${fmtDuration(showSegments.reduce((sum, segment) => sum + (segment.duration || 0), 0))}`);
  }

  function makeTomorrowShow() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    showDateInput.value = localDateInputValue(tomorrow);
    persist();
    makeShow();
  }

  function applyMorningPreset({ tomorrow = false } = {}) {
    const date = new Date();
    if (tomorrow) date.setDate(date.getDate() + 1);
    formatSel.value = "morning";
    moodSel.value = "auto";
    airTimeInput.value = "06:00";
    targetHoursInput.value = "1";
    leadInput.value = "45";
    showDateInput.value = localDateInputValue(date);
    persist();
    paintConnectors();
    makeShow();
  }

  async function buildWeekdayOneHour({ date = null, force = true } = {}) {
    persist();
    weekdayOneHourBtn.disabled = true;
    try {
      const saved = await api.buildWeekdayMorningShow({
        date: date || showDateInput.value || null,
        place: placeInput.value.trim() || "Vancouver",
        targetHours: 1,
        airTime: "06:00",
        force,
      });
      if (saved?.skipped) return toast(saved.reason || "Weekday show skipped.");
      loadShowSnapshot(saved, { persistLocal: true });
      toast(saved?.alreadyExists ? "Loaded existing 1-hour show" : "Built 1-hour morning show");
    } catch (e) {
      toast(`Could not build 1-hour show: ${e.message || e}`);
    } finally {
      weekdayOneHourBtn.disabled = false;
    }
  }

  async function loadBackgroundShow() {
    loadBackgroundBtn.disabled = true;
    try {
      const saved = await api.buildWeekdayMorningShow({
        date: null,
        place: placeInput.value.trim() || "Vancouver",
        targetHours: 1,
        airTime: "06:00",
        force: false,
      });
      if (saved?.skipped) return toast(saved.reason || "Weekday show skipped.");
      loadShowSnapshot(saved, { persistLocal: true });
      toast(saved?.alreadyExists ? "Today's show loaded" : "Today's show built");
    } catch (e) {
      toast(`No show ready: ${e.message || e}`);
    } finally {
      loadBackgroundBtn.disabled = false;
    }
  }

  function addHour() {
    if (!showSegments.length) makeShow();
    const used = new Set(showSegments.filter((s) => s.type === "song").map((s) => s.song?.id));
    const candidates = buildReplayQueue(songs, liveSong).filter((song) => !used.has(song.id));
    const picks = choosePicksForRuntime(candidates.length ? candidates : buildReplayQueue(songs, liveSong), 3600);
    const more = buildShowSegments(picks, context, { ...p, targetHours: 1 }).filter((segment, idx, arr) => {
      if (idx === 0 && segment.type === "talk") return true;
      if (idx === arr.length - 1 && segment.title === "Signoff") return false;
      return true;
    });
    const signoff = showSegments.find((s) => s.type === "talk" && s.title === "Signoff");
    showSegments = [...showSegments.filter((s) => !(s.type === "talk" && s.title === "Signoff")), ...more];
    if (signoff) showSegments.push(signoff);
    replayQueue = showSegments.filter((segment) => segment.type === "song").map((segment) => segment.song);
    setPlayerQueueContext();
    paintRundown();
    paintSchedule();
    saveCurrentShow({ silent: true });
    populateHistorySelect();
    toast("Added roughly one hour");
  }

  function paintSchedule() {
    clear(scheduleBox);
    const total = showSegments.reduce((sum, segment) => sum + (segment.duration || 0), 0);
    const rulerSeconds = total || Math.round((Number(p.targetHours) || 1) * 3600);
    const airLabel = formatClock(p.airTime || "06:00");
    const buildLabel = offsetClock(p.airTime || "06:00", -(Number(p.leadMinutes) || 0));
    const endLabel = offsetClock(p.airTime || "06:00", Math.round(rulerSeconds / 60));
    scheduleBox.append(
      el("strong", {}, "Make-ahead clock"),
      el("div", { class: "radio-time-ruler", "aria-label": "Show timing" },
        timeNotch("PLAN", buildLabel, zoneLabel(p.buildZone)),
        timeNotch("AIR", airLabel, zoneLabel(p.airZone)),
        timeNotch("END", endLabel, `${fmtDuration(rulerSeconds)} tape`)
      ),
      el("span", { class: "radio-schedule-summary" }, `${showLabel(p)} · ${p.showDate || localDateInputValue(new Date())} · runtime ${fmtDuration(total)} / target ${formatHours(p.targetHours)} · lead ${p.leadMinutes} min`),
      el("small", {}, showSegments.length ? "The tape is built as editable voice and song segments, so the 6 AM show can be replayed, skipped, or stopped." : "Use Today 1H to stage the daily one-hour morning show; Tomorrow 1H builds one day ahead."),
    );
  }

  function paintConnectors() {
    clear(connectorBox);
    const agenda = (p.dailyAgenda || "").trim();
    const bookmarks = (p.bookmarkNotes || "").trim();
    connectorBox.append(
      el("strong", {}, "Daily briefing sources"),
      connectorPill("News / holidays", "draft", "Built from date, weather, and local fallback facts for now."),
      connectorPill("Google Calendar", agenda ? "manual notes" : "not connected", agenda ? "Using pasted day notes until OAuth is wired." : "Next step: OAuth Calendar read-only events."),
      connectorPill("X bookmarks", bookmarks ? "manual notes" : "not connected", bookmarks ? "Using pasted bookmark notes until X OAuth is wired." : "Needs an approved X app with bookmark.read scope."),
    );
  }

  function paintRundown() {
    clear(hostOut);
    if (!showSegments.length) {
      hostOut.append(el("div", { class: "radio-empty-show" }, "Make Show builds a broadcast tape: host intro, songs, weather, sponsor, and back-announces."));
      return;
    }
    showSegments.forEach((segment, idx) => {
      const row = el("article", {
        class: "radio-rundown-row" + (idx === currentSegmentIndex ? " active" : ""),
      });
      const play = el("button", { class: "radio-rundown-play", type: "button" }, idx === currentSegmentIndex && showPlaying ? "ON" : "PLAY");
      play.onclick = () => playSegment(idx);
      const main = el("span", {},
        el("strong", {}, segment.title),
      );
      if (segment.type === "talk") {
        const text = el("textarea", { class: "radio-script-edit" }, segment.text);
        text.oninput = () => {
          segment.text = text.value;
          segment.duration = estimateSpeechDuration(segment.text);
          paintSchedule();
          if (idx === currentSegmentIndex) {
            paintReceiver();
            paintReplayProgress();
          }
        };
        text.onchange = () => saveCurrentShow({ silent: true });
        main.append(text);
      } else {
        main.append(el("small", {}, `${fmtAccount(segment.song?.account)} · ${fmtDuration(segment.song?.duration)}`));
      }
      row.append(
        el("span", { class: `radio-rundown-type ${segment.type}` }, segment.type === "talk" ? "VOICE" : "SONG"),
        main,
        el("em", {}, fmtDuration(segment.duration || segment.song?.duration || estimateSpeechDuration(segment.text))),
        play,
      );
      hostOut.append(row);
    });
  }

  function saveCurrentShow({ silent = false } = {}) {
    if (!showSegments.length) {
      if (!silent) toast("Make a show first.");
      return null;
    }
    const history = loadShowHistory();
    const snapshot = buildShowSnapshot();
    const idx = history.findIndex((item) => item.id === snapshot.id);
    if (idx >= 0) history[idx] = snapshot;
    else history.unshift(snapshot);
    saveShowHistory(history.slice(0, 30));
    currentShowId = snapshot.id;
    populateHistorySelect();
    if (!silent) toast("Show saved");
    return snapshot;
  }

  function buildShowSnapshot() {
    const total = showSegments.reduce((sum, segment) => sum + (segment.duration || 0), 0);
    const firstSong = showSegments.find((s) => s.type === "song")?.song;
    const id = currentShowId || `show-${Date.now().toString(36)}`;
    return {
      id,
      title: `${context.date || "Radio Show"} · ${firstSong?.title || "myspot"}`,
      savedAt: new Date().toISOString(),
      context,
      prefs: { ...p },
      total,
      currentSegmentIndex,
      liveSongId: liveSong?.id || null,
      segments: showSegments.map((segment) => segment.type === "talk"
        ? { type: "talk", title: segment.title, text: segment.text, duration: estimateSpeechDuration(segment.text) }
        : { type: "song", title: segment.title, song: compactSong(segment.song), duration: segment.song?.duration }),
    };
  }

  function populateHistorySelect() {
    clear(historySelect);
    const history = loadShowHistory();
    if (!history.length) {
      historySelect.append(el("option", { value: "" }, "No saved shows"));
      return;
    }
    history.forEach((item) => {
      historySelect.append(el("option", { value: item.id }, `${formatSavedDate(item.savedAt)} · ${item.title}`));
    });
    if (currentShowId) historySelect.value = currentShowId;
  }

  function loadSavedShow(id) {
    const saved = loadShowHistory().find((item) => item.id === id);
    if (!saved) return toast("Saved show not found.");
    loadShowSnapshot(saved);
  }

  function loadShowSnapshot(saved, { persistLocal = false } = {}) {
    stopShow();
    currentShowId = saved.id;
    Object.assign(p, DEFAULTS, saved.prefs || {});
    formatSel.value = p.showFormat || "morning";
    hostSel.value = p.host;
    moodSel.value = p.mood;
    placeInput.value = p.place;
    buildZoneSel.value = p.buildZone;
    airZoneSel.value = p.airZone;
    leadInput.value = String(p.leadMinutes);
    showDateInput.value = p.showDate || localDateInputValue(new Date());
    airTimeInput.value = p.airTime || "06:00";
    targetHoursInput.value = String(p.targetHours || 1);
    brands.value = p.brands;
    dailyAgenda.value = p.dailyAgenda || "";
    bookmarkNotes.value = p.bookmarkNotes || "";
    savePrefs(p);
    context = saved.context || context;
    showSegments = (saved.segments || []).map((segment) => segment.type === "talk"
      ? { ...segment, duration: estimateSpeechDuration(segment.text) }
      : { ...segment, song: segment.song, duration: segment.duration || segment.song?.duration });
    replayQueue = showSegments.filter((segment) => segment.type === "song").map((segment) => segment.song);
    liveSong = replayQueue.find((song) => song.id === saved.liveSongId) || replayQueue[0] || null;
    currentSegmentIndex = Math.max(0, Math.min(saved.currentSegmentIndex || 0, showSegments.length - 1));
    const active = showSegments[currentSegmentIndex];
    selected = active?.type === "song" ? active.song : liveSong || replayQueue[0] || selected;
    replayIndex = Math.max(0, replayQueue.findIndex((song) => song.id === selected?.id));
    setPlayerQueueContext();
    paintContext(contextBox, context);
    paintConnectors();
    paintSongs();
    paintNow();
    paintReceiver();
    paintRundown();
    paintSchedule();
    prebufferSelected();
    paintReplayProgress();
    populateHistorySelect();
    if (persistLocal) saveCurrentShow({ silent: true });
    toast("Show loaded");
  }

  function deleteSavedShow(id) {
    if (!id) return;
    const history = loadShowHistory().filter((item) => item.id !== id);
    saveShowHistory(history);
    if (currentShowId === id) currentShowId = null;
    populateHistorySelect();
    toast("Saved show deleted");
  }

  async function playSegment(idx) {
    if (!showSegments.length) makeShow();
    const segment = showSegments[idx];
    if (!segment) return stopShow();
    cancelSpeech();
    currentSegmentIndex = idx;
    showPlaying = true;
    paintRundown();
    if (segment.type === "talk") {
      getAudio().pause();
      receiverPreload.textContent = "HOST";
      paintReceiver();
      speakSegment(segment);
      paintReplayProgress();
      return;
    }
    if (segment.song) {
      await selectStationSong(segment.song, { play: false, mode: segment.song.id === liveSong?.id ? "LIVE" : "REPLAY" });
      showPlaying = true;
      receiverPreload.textContent = "ON AIR";
      playQueuedSong(selected, { related: [], sources: [] });
      paintReceiver();
      paintReplayProgress();
    }
  }

  function speakSegment(segment) {
    cancelSpeech();
    const finishSpeech = () => {
      if (!showPlaying || showSegments[currentSegmentIndex] !== segment) return;
      advanceShow(1);
    };
    currentSpeechTimer = window.setTimeout(finishSpeech, Math.min(45000, ((segment.duration || 6) + 2) * 1000));
    if (!("speechSynthesis" in window)) {
      toast("Text-to-speech is not available in this browser.");
      return;
    }
    currentUtterance = new SpeechSynthesisUtterance(segment.text);
    currentUtterance.rate = 1.02;
    currentUtterance.pitch = p.host === "cosmic-fm" ? 0.88 : 1.06;
    currentUtterance.onend = finishSpeech;
    currentUtterance.onerror = finishSpeech;
    window.speechSynthesis.speak(currentUtterance);
  }

  function cancelSpeech() {
    if (currentSpeechTimer) window.clearTimeout(currentSpeechTimer);
    currentSpeechTimer = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    currentUtterance = null;
  }

  function advanceShow(delta) {
    if (!showPlaying) return;
    const next = currentSegmentIndex + delta;
    if (next >= showSegments.length) {
      stopShow();
      return;
    }
    playSegment(next);
  }

  function stopShow() {
    showPlaying = false;
    cancelSpeech();
    const audio = getAudio();
    audio.pause();
    receiverPreload.textContent = selected ? "PRELOADED" : "BUFFERING";
    paintReceiver();
    paintRundown();
    paintReplayProgress();
  }

  refresh.onclick = loadContext;
  morningPresetBtn.onclick = () => applyMorningPreset();
  weekdayOneHourBtn.onclick = buildWeekdayOneHour;
  loadBackgroundBtn.onclick = loadBackgroundShow;
  makeShowBtn.onclick = makeShow;
  tomorrowBtn.onclick = () => {
    if ((p.showFormat || "morning") === "morning") {
      const next = new Date();
      next.setDate(next.getDate() + 1);
      showDateInput.value = localDateInputValue(next);
      targetHoursInput.value = "1";
      persist();
      buildWeekdayOneHour({ date: showDateInput.value, force: true });
    }
    else makeTomorrowShow();
  };
  addHourBtn.onclick = addHour;
  saveShowBtn.onclick = () => saveCurrentShow();
  loadShowBtn.onclick = () => loadSavedShow(historySelect.value);
  deleteShowBtn.onclick = () => deleteSavedShow(historySelect.value);
  auto.onclick = () => {
    if (!songs.length) return;
    const idx = Math.floor(Math.random() * songs.length);
    selectStationSong(songs[idx], { play: false, mode: "REPLAY" });
    addCopy(hostOut, "Auto Pick", `The station landed on "${selected.title}" because the ${p.mood} setting wanted something with a little magnetic weirdness.`);
  };
  tuneBtn.onclick = tuneIn;
  offBtn.onclick = stopShow;
  rewindBtn.onclick = replayPrevious;
  forwardBtn.onclick = skipForward;
  liveBtn.onclick = jumpLive;
  replayScrub.addEventListener("input", () => {
    scrubbingReplay = true;
    const audio = getAudio();
    const total = audio.duration || selected?.duration || 0;
    if (total) {
      audio.currentTime = (Number(replayScrub.value) / 1000) * total;
      receiverTime.textContent = `${fmtDuration(audio.currentTime)} / ${fmtDuration(total)}`;
    }
  });
  replayScrub.addEventListener("change", () => {
    scrubbingReplay = false;
    paintReplayProgress();
  });
  document.addEventListener("audio:tick", paintReplayProgress, { signal: events.signal });
  document.addEventListener("myspot:playerstop", () => {
    showPlaying = false;
    cancelSpeech();
    receiverPreload.textContent = selected ? "PRELOADED" : "BUFFERING";
    paintReceiver();
    paintRundown();
    paintReplayProgress();
  }, { signal: events.signal });
  getAudio().addEventListener("ended", () => {
    if (showPlaying && showSegments[currentSegmentIndex]?.type === "song") advanceShow(1);
  }, { signal: events.signal });
  introBtn.onclick = async () => addCopy(hostOut, "Intro", introCopy(await ensureFullSong(), p, context));
  weatherBtn.onclick = async () => addCopy(hostOut, "Weather", weatherCopy(await ensureFullSong(), context));
  sponsorBtn.onclick = async () => addCopy(hostOut, "Dream Sponsor", sponsorCopy(await ensureFullSong(), p));

  await Promise.all([loadContext(), loadSongs()]);
  if (songs.length) {
    liveSong = chooseDailySong(songs, context, p.mood);
    replayQueue = buildReplayQueue(songs, liveSong);
    selected = liveSong;
    replayIndex = replayQueue.findIndex((s) => s.id === selected.id);
    setPlayerQueueContext();
  }
  paintSongs();
  paintNow();
  paintReceiver();
  paintRundown();
  paintSchedule();
  populateHistorySelect();
  prebufferSelected();
  paintReplayProgress();
}

function cover(song, size = "") {
  const c = el("div", { class: `radio-cover ${size}` });
  if (song?.jpg_path) c.style.backgroundImage = `url(${mediaUrl.cover(song.id)})`;
  else c.textContent = "♫";
  return c;
}

function paintContext(node, context) {
  const wx = context.weather
    ? `${context.weather.summary}, ${weatherTemp(context.weather)}`
    : "weather unavailable";
  node.innerHTML = "";
  node.append(
    el("strong", {}, context.place || "Local"),
    el("span", {}, `${context.date} · ${context.time}`),
    el("span", {}, `${context.daypart} · ${wx}`),
  );
}

function introCopy(song, p, context) {
  if (!song) return "Pick a song first.";
  const lines = (song.lyrics || []).map((l) => l.text).filter(Boolean).slice(0, 4).join(" / ");
  return `Tiny production note before we go in. It's ${context.daypart} in ${context.place}, and "${song.title}" has the kind of detail you catch on the second listen. Listen for the vocal texture, the negative space, and the way the melody decides whether it wants to confess or flex. ${lines ? `Lyric clue: ${lines}.` : ""}`;
}

function weatherCopy(song, context) {
  if (!song) return "Pick a song first.";
  const wx = context.weather;
  if (!wx) return `The weather desk is fuzzy, which honestly fits "${song.title}".`;
  return `Weather check: ${context.place} is sitting in ${wx.summary}, about ${weatherTemp(wx)}. That gives "${song.title}" a little extra atmosphere before the first hook even lands.`;
}

function sponsorCopy(song, p) {
  if (!song) return "Pick a song first.";
  const brands = p.brands.split(",").map((b) => b.trim()).filter(Boolean);
  const brand = brands[(song.id || 0) % Math.max(1, brands.length)] || "a tiny record shop with perfect lighting";
  return `Dream sponsor for "${song.title}": ${brand}. Not an actual endorsement, more like the brand that would understand the bassline and bring the right snacks. Also accepting fictional support from Moonlit Cable Management, makers of emotionally supportive power strips.`;
}

function weatherTemp(weather) {
  if (weather?.temperature_c != null) return `${Math.round(weather.temperature_c)}°C`;
  if (weather?.temperature_f != null) return `${Math.round((weather.temperature_f - 32) * 5 / 9)}°C`;
  return "temperature unavailable";
}

function connectorPill(name, status, detail) {
  return el("span", { class: "radio-connector-pill" },
    el("b", {}, name),
    el("em", {}, status),
    el("small", {}, detail),
  );
}

function showLabel(p) {
  if ((p.showFormat || "morning") === "morning") return "6 AM morning show";
  if (p.showFormat === "late") return "late show";
  return "freeform show";
}

function dailyBriefingBits(context, p) {
  const date = parseShowDate(p.showDate);
  const dayName = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
  const monthDay = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(date);
  const wx = context.weather
    ? `${context.place} starts with ${context.weather.summary} and about ${weatherTemp(context.weather)}`
    : `${context.place} has a weather desk that is still warming up`;
  const bits = [
    `${dayName}, ${monthDay}: ${wx}.`,
    seasonalFact(date),
    `The show is listening for ${p.mood === "auto" ? "whatever the library makes feel current" : `${p.mood} energy`} and matching songs to the day instead of just shuffling.`,
  ];
  return bits;
}

function seasonalFact(date) {
  const month = date.getMonth();
  const day = date.getDate();
  if (month === 0 && day === 1) return "It is New Year's Day, which is basically the official holiday of overambitious playlists.";
  if (month === 1 && day === 14) return "It is Valentine's Day, useful for love songs, anti-love songs, and songs pretending not to be either.";
  if (month === 6 && day === 4) return "It is the Fourth of July in the U.S., so the song picker is legally allowed to get a little cinematic.";
  if (month === 9 && day === 31) return "It is Halloween, which means spooky counts even if the bassline is the only costume.";
  if (month === 11 && day === 25) return "It is Christmas Day, which can mean cozy, chaotic, sentimental, or all three before breakfast.";
  if (month >= 2 && month <= 4) return "Season note: spring is good for songs that sound like they just opened a window.";
  if (month >= 5 && month <= 7) return "Season note: summer favors brighter hooks, longer drives, and questionable confidence.";
  if (month >= 8 && month <= 10) return "Season note: fall is made for texture, minor chords, and looking busy while thinking about songs.";
  return "Season note: winter likes songs with warm rooms inside them.";
}

function summarizeNote(value, fallback) {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 190 ? `${text.slice(0, 187)}...` : text;
}

function addCopy(root, title, text) {
  const card = el("article", { class: "radio-copy-card" });
  const copy = el("button", { class: "btn", type: "button" }, "Copy");
  copy.onclick = async () => {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  };
  card.append(el("div", { class: "radio-copy-head" }, el("strong", {}, title), copy));
  card.append(el("p", {}, text));
  root.prepend(card);
}

function loadShowHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

function saveShowHistory(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* ignore */ }
}

function compactSong(song) {
  if (!song) return null;
  return {
    id: song.id,
    title: song.title,
    account: song.account,
    genre: song.genre,
    duration: song.duration,
    jpg_path: song.jpg_path,
    audio_path: song.audio_path,
  };
}

function formatSavedDate(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "Saved";
  }
}

function chooseDailySong(songs, context, mood) {
  if (!songs.length) return null;
  const key = [context.date, context.daypart, context.weather?.summary, mood].filter(Boolean).join("|");
  return songs[hashString(key) % songs.length];
}

function buildReplayQueue(songs, liveSong) {
  void liveSong;
  if (!songs.length) return [];
  return songs.slice();
}

function choosePicksForRuntime(queue, targetSeconds) {
  if (!queue.length) return [];
  const picks = [];
  let total = 0;
  const maxPasses = Math.ceil(targetSeconds / Math.max(1, queue.reduce((sum, song) => sum + (song.duration || 180), 0))) + 1;
  for (let pass = 0; pass < maxPasses && total < targetSeconds; pass++) {
    for (const song of queue) {
      picks.push(song);
      total += song.duration || 180;
      total += 18;
      if (total >= targetSeconds) break;
    }
  }
  return picks;
}

function buildShowSegments(picks, context, p) {
  const day = context.daypart || "local";
  const wx = context.weather
    ? `${context.weather.summary}, ${weatherTemp(context.weather)}`
    : "a mysterious local sky";
  const todayBits = dailyBriefingBits(context, p);
  const agenda = summarizeNote(p.dailyAgenda, "No calendar notes are connected yet, so the calendar desk is keeping it light.");
  const bookmarks = summarizeNote(p.bookmarkNotes, "No bookmark notes are connected yet, but the station is ready to turn saved links into song cues.");
  const sponsorTaste = p.brands.split(",").map((b) => b.trim()).filter(Boolean);
  const sponsor = sponsorTaste[hashString(`${context.date}|${p.mood}`) % Math.max(1, sponsorTaste.length)] || "a perfect little record shop";
  const segments = [{
    type: "talk",
    title: "Cold Open",
    text: p.showFormat === "morning"
      ? `Good morning, you're tuned to myspot. It is ${formatClock(p.airTime || "06:00")} in ${context.place}, the weather is ${wx}, and this is the one-hour morning tape built to get you from first coffee to full speed. First up, a track with enough pulse to open the curtains.`
      : `You're tuned to myspot. It's ${day} in ${context.place}, the weather is ${wx}, and today's show is built from the library with ${p.mood} energy. First up, a track that feels like the station found a secret side street.`,
  }];
  if (p.showFormat === "morning") {
    segments.push({
      type: "talk",
      title: "Morning Briefing",
      text: `Daily update: ${todayBits.join(" ")} Calendar check: ${agenda} Bookmark desk: ${bookmarks}`,
    });
  }
  picks.forEach((song, idx) => {
    segments.push({ type: "song", title: song.title || "Untitled", song });
    if (idx === 0) {
      segments.push({
        type: "talk",
        title: "Back Announce",
        text: `That was ${song.title}. The detail I like is how it leaves room around the hook, like the mix knows the silence is part of the rhythm. ${p.showFormat === "morning" ? "Coming up, we keep the morning update moving without making it feel like homework." : "Coming up, we keep the signal moving."}`,
      });
    } else if (idx === 1) {
      segments.push({
        type: "talk",
        title: "Dream Sponsor",
        text: `Today's imaginary sponsor is ${sponsor}. Not an ad, just the kind of name that would understand this mood and bring the right snacks to the booth.`,
      });
    } else if (p.showFormat === "morning" && idx > 0 && idx % 8 === 0) {
      segments.push({
        type: "talk",
        title: "Morning Check-In",
        text: `Quick check-in from the morning desk: ${todayBits[idx % todayBits.length]} Calendar color for this hour: ${agenda} The next set leans into songs that feel useful while the day is still deciding what it wants.`,
      });
    } else if (idx < picks.length - 1) {
      segments.push({
        type: "talk",
        title: "Station ID",
        text: `This is myspot radio, still live enough to feel alive and recorded enough that you can rewind the good part.`,
      });
    }
  });
  segments.push({
    type: "talk",
    title: "Signoff",
    text: `That's the show tape for now. You can jump back, scrub around, or hit live to return to the current edge of the station.`,
  });
  return segments.map((segment) => ({
    ...segment,
    duration: segment.type === "talk" ? estimateSpeechDuration(segment.text) : segment.song?.duration,
  }));
}

function estimateSpeechDuration(text = "") {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(6, Math.round(words / 2.45));
}

function localDateInputValue(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function parseShowDate(value) {
  if (!value) return new Date();
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function formatHours(hours) {
  const n = Number(hours) || 0;
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2).replace(/0$/, "")}h`;
}

function timeNotch(label, time, note = "") {
  return el("span", { class: "radio-time-notch" },
    el("b", {}, time),
    el("em", {}, label),
    note ? el("small", {}, note) : null
  );
}

function formatClock(value) {
  const [h = 6, m = 0] = String(value || "06:00").split(":").map(Number);
  const date = new Date(2000, 0, 1, h, m);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function offsetClock(value, offsetMinutes) {
  const [h = 6, m = 0] = String(value || "06:00").split(":").map(Number);
  const date = new Date(2000, 0, 1, h, m);
  date.setMinutes(date.getMinutes() + offsetMinutes);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatZoneTime(date, timeZone) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
}

function zoneLabel(timeZone) {
  return (timeZone || "").replace("America/", "").replace("_", " ");
}

function frequencyPercent(song, context) {
  const key = `${song?.id || ""}|${context.date || ""}|${context.daypart || ""}`;
  return 12 + (hashString(key) % 77);
}

function dailySignalLabel(context) {
  const daypart = context.daypart || "local";
  return `${daypart} daily signal`;
}

function hashString(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function fallbackContext(place) {
  const now = new Date();
  const hour = now.getHours();
  const daypart = hour >= 5 && hour < 11 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "late night";
  return {
    place,
    date: now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    time: now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    daypart,
    weather: null,
  };
}
