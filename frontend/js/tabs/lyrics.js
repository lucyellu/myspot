import { el, clear } from "../util.js";

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

  // Estimate progress-based highlight
  const handler = (e) => {
    const { t, total } = e.detail;
    if (!total || !lineEls.length) return;
    const ratio = Math.max(0, Math.min(1, t / total));
    const idx = Math.floor(ratio * lineEls.length);
    lineEls.forEach((l, i) => {
      if (i === idx) {
        l.style.color = "var(--text)";
        l.style.background = "rgba(255,85,119,0.08)";
      } else if (i < idx) {
        l.style.color = "var(--text-muted)";
        l.style.background = "transparent";
      } else {
        l.style.color = "var(--text-dim)";
        l.style.background = "transparent";
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

  const ac = new AbortController();
  document.addEventListener("audio:tick", handler, { signal: ac.signal });
  body._cleanup = () => ac.abort();
}
