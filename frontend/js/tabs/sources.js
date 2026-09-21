import { el, clear, toast } from "../util.js";
import { api, mediaUrl } from "../api.js";

export function renderSources(body, song) {
  clear(body);

  // ── Local Sources on PC ─────────────────────────────────────────
  const localPaths = [
    { type: "Audio (MP3)", path: song.mp3_path, icon: "🎵", url: mediaUrl.audio(song.id) },
    { type: "Video (MP4)", path: song.video_path, icon: "🎬", url: mediaUrl.video(song.id) },
    { type: "Cover Art", path: song.jpg_path, icon: "🖼", url: mediaUrl.cover(song.id) },
    { type: "Lyrics Text", path: song.txt_path, icon: "📄", url: null },
    { type: "WAV Audio", path: song.wav_path, icon: "🔊", url: null },
    { type: "MIDI Data", path: song.mid_path, icon: "🎹", url: null },
  ].filter((item) => Boolean(item.path));

  if (localPaths.length > 0) {
    const grp = el("div", { class: "derivative-group local-source-group" });
    grp.append(el("h4", {}, `Local Sources (${localPaths.length})`));

    for (const item of localPaths) {
      const card = el("div", { class: "local-source-card" });
      const top = el("div", { class: "local-source-top" });
      const typeWrap = el("div", { class: "local-source-type-wrap" });
      typeWrap.append(el("span", { class: "local-source-icon" }, item.icon));
      typeWrap.append(el("span", { class: "local-source-type" }, item.type));
      top.append(typeWrap);

      const actions = el("div", { class: "local-source-actions" });

      const revealBtn = el("button", {
        type: "button",
        class: "btn compact",
        title: `Reveal ${item.type} in Explorer`,
      }, "📂 Reveal");
      revealBtn.onclick = async () => {
        revealBtn.disabled = true;
        try {
          await api.revealSong(song.id, item.path);
          toast("Opened in Explorer");
        } catch (e) {
          toast("Reveal: " + e.message);
        }
        revealBtn.disabled = false;
      };
      actions.append(revealBtn);

      const copyBtn = el("button", {
        type: "button",
        class: "btn compact",
        title: "Copy path",
      }, "📋 Copy");
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(item.path);
          toast("Copied path");
        } catch {
          toast("Could not copy path");
        }
      };
      actions.append(copyBtn);

      if (item.url) {
        const streamLink = el("a", {
          href: item.url,
          target: "_blank",
          class: "btn compact",
          title: "Direct stream link",
        }, "↗ Stream");
        actions.append(streamLink);
      }

      top.append(actions);
      card.append(top);

      const pathEl = el("div", { class: "local-source-path", title: item.path }, item.path);
      card.append(pathEl);

      grp.append(card);
    }
    body.append(grp);
  }

  const hasSources = song.sources && song.sources.length;
  const hasDerivs = song.derivatives && song.derivatives.length;

  // External source: link to this song on Suno
  if (song.suno_id) {
    const grp = el("div", { class: "derivative-group" });
    grp.append(el("h4", {}, "External"));
    const link = el("a", {
      href: `https://suno.com/song/${song.suno_id}`,
      target: "_blank",
      class: "deriv-external-link",
      style: "display:flex;align-items:center;gap:8px;padding:6px 8px;color:var(--accent-3);text-decoration:none;font-size:13px",
    }, "🎵 Open on Suno ↗");
    grp.append(link);
    body.append(grp);
  }

  if (!hasSources && !hasDerivs && !song.suno_id) {
    body.append(el("div", { class: "empty-state" },
      "No related versions found. Filename pattern is the M1 signal — try songs with a 'v2', 'v3' sibling."));
    return;
  }

  const seen = new Set([song.id]);

  if (hasSources) {
    const grp = el("div", { class: "derivative-group" });
    grp.append(el("h4", {}, "Source / parent"));
    for (const s of song.sources) grp.append(derivRow(s, 0, seen));
    body.append(grp);
  }

  if (hasDerivs) {
    const grp = el("div", { class: "derivative-group" });
    grp.append(el("h4", {}, `Derivatives (${song.derivatives.length})`));
    for (const d of song.derivatives) grp.append(derivRow(d, 0, seen));
    body.append(grp);
  }
}

function derivRow(s, depth, seen) {
  const wrap = el("div", { class: "deriv-wrap" });
  wrap.style.marginLeft = depth * 16 + "px";

  const row = el("div", { class: "derivative-row" });
  const hasCover = Boolean(s.jpg_path || s.video_only);
  const img = el("img", {
    src: hasCover ? mediaUrl.cover(s.id) : "",
    alt: "",
    style: hasCover ? "" : "display:none;background:var(--bg)",
  });
  if (hasCover) img.onerror = () => { img.style.display = "none"; };
  row.append(img);


  const info = el("div", { class: "deriv-info" });
  info.append(el("div", { class: "title" }, s.title));
  if (s.kind) info.append(el("div", { class: "kind" }, s.kind));
  row.append(info);

  const nav = el("a", { class: "deriv-nav", href: `#/song/${s.id}`, title: "Open song" }, "↗");
  row.append(nav);

  if (seen.has(s.id)) {
    row.append(el("span", { class: "deriv-sublabel", style: "font-size:10px;opacity:0.5" }, "already shown"));
    wrap.append(row);
    return wrap;
  }

  const toggle = el("button", { class: "deriv-toggle", type: "button" }, "▶");
  row.insertBefore(toggle, nav);
  wrap.append(row);

  const children = el("div", { class: "deriv-children" });
  children.hidden = true;
  let loaded = false;
  wrap.append(children);

  toggle.onclick = async () => {
    const open = children.hidden;
    children.hidden = !open;
    toggle.textContent = open ? "▼" : "▶";
    if (open && !loaded) {
      loaded = true;
      children.textContent = "Loading…";
      try {
        const data = await api.song(s.id);
        children.textContent = "";
        const hasSrc = data.sources && data.sources.length;
        const hasDrv = data.derivatives && data.derivatives.length;
        if (!hasSrc && !hasDrv) {
          children.append(el("div", { class: "deriv-sublabel" }, "No further versions."));
        } else {
          const childSeen = new Set([...seen, s.id]);
          if (hasSrc) {
            children.append(el("div", { class: "deriv-sublabel" }, "SOURCES"));
            for (const src of data.sources) children.append(derivRow(src, depth + 1, childSeen));
          }
          if (hasDrv) {
            children.append(el("div", { class: "deriv-sublabel" }, "DERIVATIVES"));
            for (const drv of data.derivatives) children.append(derivRow(drv, depth + 1, childSeen));
          }
        }
      } catch {
        children.textContent = "Failed to load.";
      }
    }
  };

  return wrap;
}
