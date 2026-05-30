import { api } from "../api.js?v=dj1";
import { el, clear, toast } from "../util.js";

const STORE_KEY = "myspot.dj.v1";

const HOSTS = [
  {
    id: "pop-theory-cool-kid",
    label: "Pop-Theory Cool Kid",
    note: "College-radio taste, sharp ear, hears hooks, chord turns, vocal stacks, and tiny production choices.",
    opener: "Tiny production note before we go in.",
  },
  {
    id: "producer-monk",
    label: "Minimalist Producer",
    note: "Quiet, spacious, studio wisdom. Producer-guru energy, not an impersonation.",
    opener: "Less talk, more signal.",
  },
  {
    id: "comedy-story-editor",
    label: "Comedy Story Editor",
    note: "Warm, observational, human, a little movie-brain.",
    opener: "Here is the emotional premise.",
  },
  {
    id: "crate-digger",
    label: "Crate-Digging Producer",
    note: "Sample-head, drum-break nerd, tasteful and specific.",
    opener: "Needle down, ears forward.",
  },
  {
    id: "standup-opener",
    label: "Standup Opener",
    note: "Quick jokes, room work, never mean.",
    opener: "Tiny crowd, huge feelings.",
  },
  {
    id: "cosmic-fm",
    label: "Late-Night Cosmic FM",
    note: "Soft radio fog, weather, stars, dream logic.",
    opener: "Broadcasting from the soft edge of the dial.",
  },
  {
    id: "luxury-bumper",
    label: "Luxury Bumper Voice",
    note: "Dream sponsors, satin delivery, fake expensive objects.",
    opener: "Tonight's programming arrives lightly chilled.",
  },
];

const MOODS = [
  "auto",
  "rainy",
  "late-night",
  "psychedelic",
  "funny",
  "romantic",
  "weird",
  "focused",
  "party",
  "tender",
];

const DEFAULTS = {
  host: "pop-theory-cool-kid",
  mood: "auto",
  place: "Vancouver",
  sponsorMode: "rare",
  brands: "Teenage Engineering, Muji, Bandcamp, Criterion, local coffee, weird synth shops",
  fictional: true,
  realBrands: true,
};

function loadPrefs() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE_KEY) || "{}")) }; }
  catch { return { ...DEFAULTS }; }
}

function savePrefs(prefs) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

export async function renderDJ(body, song) {
  clear(body);
  const prefs = loadPrefs();
  let context = buildFallbackContext(prefs.place);

  const hero = el("section", { class: "dj-hero" });
  hero.append(el("h4", { class: "section-h" }, "DJ HOST"));
  hero.append(el("p", { class: "muted small" },
    "Make tasteful intros, weather bumps, and dream-sponsor reads for the current song."));

  const host = el("select", { class: "compact" });
  for (const h of HOSTS) host.append(el("option", { value: h.id }, h.label));
  host.value = prefs.host;

  const mood = el("select", { class: "compact" });
  for (const m of MOODS) mood.append(el("option", { value: m }, m.toUpperCase()));
  mood.value = prefs.mood;

  const place = el("input", { type: "text", class: "compact", value: prefs.place, placeholder: "City for weather" });

  hero.append(el("div", { class: "row-2" },
    el("label", {}, "Host style", host),
    el("label", {}, "Mood", mood),
  ));
  hero.append(el("label", {}, "Weather place", place));

  const sponsorMode = el("select", { class: "compact" });
  [
    ["off", "Off"],
    ["rare", "Rare"],
    ["daily", "A couple/day"],
  ].forEach(([v, label]) => sponsorMode.append(el("option", { value: v }, label)));
  sponsorMode.value = prefs.sponsorMode;

  const realBrands = el("input", { type: "checkbox" });
  realBrands.checked = !!prefs.realBrands;
  const fictional = el("input", { type: "checkbox" });
  fictional.checked = !!prefs.fictional;
  const brands = el("textarea", {
    class: "dj-brands",
    placeholder: "Brands, products, places, aesthetics, inside jokes...",
  }, prefs.brands);

  const sponsorBox = el("section", { class: "dj-section" });
  sponsorBox.append(el("h5", { class: "section-h" }, "Dream Sponsors"));
  sponsorBox.append(el("div", { class: "row-2" },
    el("label", {}, "Frequency", sponsorMode),
    el("label", { class: "check-row" }, realBrands, "Use real brands"),
  ));
  sponsorBox.append(el("label", { class: "check-row" }, fictional, "Use fictional sponsors / jokes"));
  sponsorBox.append(el("label", {}, "Taste profile", brands));

  const actions = el("div", { class: "dj-actions" });
  const refreshBtn = el("button", { class: "btn", type: "button" }, "Refresh Context");
  const introBtn = el("button", { class: "btn primary", type: "button" }, "Intro");
  const weatherBtn = el("button", { class: "btn", type: "button" }, "Weather");
  const sponsorBtn = el("button", { class: "btn", type: "button" }, "Dream Sponsor");
  const queueBtn = el("button", { class: "btn", type: "button" }, "Pick Next 5");
  actions.append(refreshBtn, introBtn, weatherBtn, sponsorBtn, queueBtn);

  const contextCard = el("div", { class: "dj-context" });
  const output = el("div", { class: "dj-output" });

  body.append(hero, sponsorBox, actions, contextCard, output);

  const persist = () => {
    Object.assign(prefs, {
      host: host.value,
      mood: mood.value,
      place: place.value.trim() || "Vancouver",
      sponsorMode: sponsorMode.value,
      brands: brands.value,
      fictional: fictional.checked,
      realBrands: realBrands.checked,
    });
    savePrefs(prefs);
  };
  [host, mood, place, sponsorMode, brands, realBrands, fictional].forEach((node) => {
    node.addEventListener("change", persist);
    node.addEventListener("input", persist);
  });

  async function refreshContext() {
    persist();
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Refreshing...";
    try {
      context = await api.djContext({ place: prefs.place });
    } catch {
      context = buildFallbackContext(prefs.place);
    }
    paintContext(contextCard, context, song);
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh Context";
  }

  refreshBtn.onclick = refreshContext;
  introBtn.onclick = () => addOutput(output, "Intro", buildIntro(song, prefs, context));
  weatherBtn.onclick = () => addOutput(output, "Weather Bump", buildWeather(song, prefs, context));
  sponsorBtn.onclick = () => addOutput(output, "Dream Sponsor", buildSponsor(song, prefs, context));
  queueBtn.onclick = async () => addOutput(output, "Next 5", await buildQueueDraft(song, prefs, context));

  await refreshContext();
}

function paintContext(node, context, song) {
  const weather = context.weather;
  const wx = weather
    ? `${weather.summary}, ${Math.round(weather.temperature_f)}°F, wind ${Math.round(weather.wind_mph || 0)} mph`
    : "weather unavailable";
  node.innerHTML = "";
  node.append(
    el("div", {}, el("strong", {}, context.place || "Somewhere"), " · ", context.date || "", " · ", context.time || ""),
    el("div", { class: "muted small" }, `${context.daypart || "now"} · ${wx}`),
    el("div", { class: "muted small" }, `Song: ${song.title}${song.genre ? " · " + song.genre : ""}`),
  );
}

function hostFor(prefs) {
  return HOSTS.find((h) => h.id === prefs.host) || HOSTS[0];
}

function moodFor(song, prefs, context) {
  if (prefs.mood && prefs.mood !== "auto") return prefs.mood;
  const wx = context.weather?.summary || "";
  if (/rain|drizzle|fog|overcast/i.test(wx)) return "rainy";
  if (context.daypart === "late night") return "late-night";
  if (/psy|mushroom|dream|vibes/i.test(song.title || "")) return "psychedelic";
  return song.genre || "curious";
}

function lyricHint(song) {
  const lines = (song.lyrics || []).map((l) => l.text).filter(Boolean).slice(0, 5);
  return lines.length ? lines.join(" / ") : song.prompt || song.genre || song.title;
}

function buildIntro(song, prefs, context) {
  const host = hostFor(prefs);
  const mood = moodFor(song, prefs, context);
  if (host.id === "pop-theory-cool-kid") {
    return [
      `${host.opener}`,
      `It's ${context.daypart || "showtime"} in ${context.place || "the studio"}, and this one feels ${mood} without trying too hard.`,
      `"${song.title}" has the kind of detail you catch on the second listen: the title already sounds like a hook, and the lyric world is giving us ${lyricHint(song).slice(0, 150)}.`,
      `I'm listening for the little production tells here: vocal texture, negative space, and the moment the melody decides whether it wants to confess or flex.`,
    ].join(" ");
  }
  return [
    `${host.opener}`,
    `It's ${context.daypart || "showtime"} in ${context.place || "the studio"}, and the board is tilted toward ${mood}.`,
    `Up now: "${song.title}"${song.genre ? `, carrying ${song.genre}` : ""}.`,
    `Listen for this little clue in the song: ${lyricHint(song).slice(0, 180)}.`,
  ].join(" ");
}

function buildWeather(song, prefs, context) {
  const wx = context.weather;
  if (!wx) return `Weather desk is fuzzy, which honestly fits "${song.title}". Keep the lights low and trust the next track.`;
  const mood = moodFor(song, prefs, context);
  return `Weather check: ${context.place} is sitting in ${wx.summary}, about ${Math.round(wx.temperature_f)} degrees. That makes this a ${mood} set, so "${song.title}" gets to wear the forecast like a jacket.`;
}

function buildSponsor(song, prefs, context) {
  if (prefs.sponsorMode === "off") return "Dream sponsors are off for this set.";
  const host = hostFor(prefs);
  const mood = moodFor(song, prefs, context);
  const brands = prefs.brands.split(",").map((x) => x.trim()).filter(Boolean);
  const brand = brands[(song.id + mood.length) % Math.max(1, brands.length)] || "a tiny shop that only opens during perfect songs";
  const fictional = prefs.fictional
    ? ` Also accepting bids from Moonlit Cable Management, makers of emotionally supportive power strips.`
    : "";
  const real = prefs.realBrands ? `${brand}` : "a dream sponsor";
  if (host.id === "pop-theory-cool-kid") {
    const fictionalLine = prefs.fictional
      ? " This pocket also accepts fictional support from Moonlit Cable Management, makers of emotionally supportive power strips."
      : "";
    return `Dream sponsor for "${song.title}": ${real}. Not an actual endorsement, more like the brand that would understand the bassline and bring the right snacks.${fictionalLine}`;
  }
  return `Dream sponsor for "${song.title}": ${real}. Not an actual endorsement, just the ideal patron saint for this ${mood} pocket of the day.${fictional} ${host.label} says: keep it light, keep it useful, then get back to the music.`;
}

async function buildQueueDraft(song, prefs, context) {
  const mood = moodFor(song, prefs, context);
  const query = mood === "rainy" ? "rain" : mood === "late-night" ? "night" : mood;
  let items = [];
  try {
    const data = await api.songs({ q: query, limit: 5, sort: "popular", dir: "desc" });
    items = data.items || [];
  } catch { /* fallback below */ }
  if (!items.length) {
    try {
      const data = await api.related(song.id, 5);
      items = data || [];
    } catch { /* ignore */ }
  }
  if (!items.length) return `No queue draft yet. Try a broader mood than "${mood}".`;
  return `Mood route: ${mood}\n\n` + items.map((s, i) => `${i + 1}. ${s.title}${s.genre ? ` · ${s.genre}` : ""}`).join("\n");
}

function addOutput(root, title, text) {
  const card = el("article", { class: "dj-card" });
  const copy = el("button", { class: "btn", type: "button" }, "Copy");
  copy.onclick = async () => {
    await navigator.clipboard.writeText(text);
    toast("Copied DJ copy");
  };
  card.append(el("div", { class: "dj-card-head" }, el("strong", {}, title), copy));
  card.append(el("pre", {}, text));
  root.prepend(card);
}

function buildFallbackContext(place) {
  const now = new Date();
  const hour = now.getHours();
  const daypart = hour >= 5 && hour < 11 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "late night";
  return {
    place,
    date: now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    time: now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    daypart,
    weather: null,
  };
}
