import { el, clear } from "../util.js";
import { api, mediaUrl } from "../api.js";

export function renderSources(body, song) {
  clear(body);

  if (song.suno_id) {
    const header = el("div", { class: "sources-current-song" });
    header.append(el("span", { class: "deriv-sublabel" }, "THIS SONG"));
    header.append(el("a", {
      class: "deriv-suno-btn",
      href: `https://suno.com/song/${song.suno_id}`,
      target: "_blank",
      rel: "noopener noreferrer",
      title: "Open on Suno (new tab)",
    }, "Suno"));
    body.append(header);
  }

  const hasSources = song.sources && song.sources.length;
  const hasDerivs = song.derivatives && song.derivatives.length;

  if (!hasSources && !hasDerivs) {
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

  const img = el("img", {
    src: s.jpg_path ? mediaUrl.cover(s.id) : "",
    alt: "",
    title: "Play this song",
  });
  if (!s.jpg_path) img.style.background = "var(--bg)";
  img.style.cursor = "pointer";
  img.addEventListener("click", (e) => {
    e.stopPropagation();
    location.hash = `#/song/${s.id}`;
  });
  row.append(img);

  const info = el("div", { class: "deriv-info" });
  info.append(el("div", { class: "title" }, s.title));
  if (s.kind) info.append(el("div", { class: "kind" }, s.kind));
  row.append(info);

  if (s.suno_id) {
    const sunoBtn = el("a", {
      class: "deriv-suno-btn",
      href: `https://suno.com/song/${s.suno_id}`,
      target: "_blank",
      rel: "noopener noreferrer",
      title: "Open on Suno (new tab)",
    }, "Suno");
    sunoBtn.addEventListener("click", (e) => e.stopPropagation());
    row.append(sunoBtn);
  }

  if (seen.has(s.id)) {
    row.append(el("span", { class: "deriv-sublabel", style: "font-size:10px;opacity:0.5" }, "already shown"));
    wrap.append(row);
    return wrap;
  }

  const arrow = el("span", { class: "deriv-arrow" }, "▶");
  row.append(arrow);
  wrap.append(row);

  const children = el("div", { class: "deriv-children" });
  children.hidden = true;
  let loaded = false;
  wrap.append(children);

  row.addEventListener("click", async () => {
    const open = children.hidden;
    children.hidden = !open;
    arrow.textContent = open ? "▼" : "▶";
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
  });

  return wrap;
}
