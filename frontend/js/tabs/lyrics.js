import { api, mediaUrl } from "../api.js?v=lyric-export1";
import { el, clear, toast } from "../util.js";

export async function renderLyrics(body, song) {
  clear(body);
  if (!song.lyrics || song.lyrics.length === 0) {
    body.append(el("div", { class: "empty-state" }, "No lyrics found in the .txt file."));
    return;
  }

  let health = { ffmpeg: false };
  try { health = await api.health(); } catch { /* ignore */ }

  const lines = song.lyrics.filter((line) => line.text && line.text.trim());
  const plainText = lines.map((line) => line.text).join("\n");

  const panel = el("section", { class: "gen-section lyric-export-panel" });
  panel.append(el("h5", { class: "section-h" }, "Lyrics"));
  panel.append(el("p", { class: "muted small", style: "margin:-4px 0 8px" },
    `${lines.length} lines. Lyric-video timing is estimated evenly across the song.`));

  const renderBtn = el("button", {
    class: "btn primary",
    type: "button",
    disabled: !health.ffmpeg || !lines.length,
  }, health.ffmpeg ? "Render lyric MP4" : "ffmpeg missing");
  const copyBtn = el("button", { class: "btn", type: "button" }, "Copy lyrics");
  const status = el("div", { class: "muted small lyric-export-status" }, "");
  panel.append(el("div", { class: "button-row" }, renderBtn, copyBtn), status);
  body.append(panel);

  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(plainText);
      toast("Lyrics copied");
    } catch {
      toast("Could not copy lyrics");
    }
  };

  renderBtn.onclick = async () => {
    renderBtn.disabled = true;
    renderBtn.textContent = "Rendering...";
    status.textContent = "Burning lyrics into a 720p MP4...";
    try {
      const r = await api.exportLyrics(song.id);
      if (r.error) {
        status.textContent = "Failed: " + r.error;
        toast("Lyric render failed");
      } else {
        clear(status);
        status.append(
          el("a", { href: mediaUrl.lyricExport(song.id), target: "_blank", style: "color:var(--accent-3)" },
            `Download lyric MP4 (${((r.size_bytes || 0) / 1024 / 1024).toFixed(1)} MB)`),
        );
        toast("Lyric video rendered");
      }
    } catch (e) {
      status.textContent = "Failed: " + e.message;
    }
    renderBtn.disabled = !health.ffmpeg;
    renderBtn.textContent = "Render lyric MP4";
  };

  const wrap = el("div", { class: "lyrics-wrap" });
  let lastSection = null;
  lines.forEach((line, i) => {
    if (line.section && line.section !== lastSection) {
      wrap.append(el("div", { class: "lyric-section" }, `[ ${line.section} ]`));
      lastSection = line.section;
    }
    const lineEl = el("div", { class: "lyric-line", "data-idx": i }, line.text);
    wrap.append(lineEl);
  });
  body.append(wrap);
}
