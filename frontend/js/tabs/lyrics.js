import { el, clear } from "../util.js";
import { getAudio } from "../player.js";

export function renderLyrics(body, song) {
  clear(body);
  if (!song.lyrics || song.lyrics.length === 0) {
    body.append(el("div", { class: "empty-state" }, "No lyrics found in the .txt file."));
    return;
  }

  const wrap = el("div", { class: "lyrics-wrap" });
  let lastSection = null;
  const lineEls = [];
  song.lyrics.forEach((line, i) => {
    if (line.section && line.section !== lastSection) {
      wrap.append(el("div", { class: "lyric-section" }, `[ ${line.section} ]`));
      lastSection = line.section;
    }
    const lineEl = el("div", { class: "lyric-line", "data-idx": i }, line.text);
    wrap.append(lineEl);
    lineEls.push(lineEl);
  });
  body.append(wrap);

  const paintProgress = (t, total) => {
    if (!total || !lineEls.length) return;
    const ratio = Math.max(0, Math.min(1, t / total));
    const idx = Math.min(lineEls.length - 1, Math.floor(ratio * lineEls.length));
    lineEls.forEach((l, i) => {
      l.classList.toggle("active", i === idx);
      l.classList.toggle("past", i < idx);
      l.classList.toggle("future", i > idx);
      if (i === idx) {
        l.setAttribute("aria-current", "true");
      } else if (i < idx) {
        l.removeAttribute("aria-current");
      } else {
        l.removeAttribute("aria-current");
      }
    });
    if (idx >= 0 && lineEls[idx]) {
      const target = lineEls[idx];
      const r = target.getBoundingClientRect();
      const parent = body;
      const pr = parent.getBoundingClientRect();
      if (r.top < pr.top + 30 || r.bottom > pr.bottom - 30) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  // Estimate progress-based highlight. Listen to the app-level tick, and also
  // sample the persistent audio element so the lyrics tab still updates if it
  // is opened mid-song or a browser misses an event.
  const handler = (e) => {
    const { t, total } = e.detail;
    paintProgress(t, total);
  };

  const ac = new AbortController();
  document.addEventListener("audio:tick", handler, { signal: ac.signal });
  const tick = () => {
    const audio = getAudio();
    paintProgress(audio.currentTime || 0, audio.duration || song.duration || 0);
  };
  tick();
  const interval = setInterval(tick, 300);
  body._cleanup = () => {
    clearInterval(interval);
    ac.abort();
  };
}
