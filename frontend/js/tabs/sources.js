import { el, clear } from "../util.js";
import { api, mediaUrl } from "../api.js";

export function renderSources(body, song) {
  clear(body);

  const hasSources = song.sources && song.sources.length;
  const hasDerivs = song.derivatives && song.derivatives.length;

  if (!hasSources && !hasDerivs) {
    body.append(el("div", { class: "empty-state" },
      "No related versions found. Filename pattern is the M1 signal — try songs with a 'v2', 'v3' sibling."));
    return;
  }

  if (hasSources) {
    const grp = el("div", { class: "derivative-group" });
    grp.append(el("h4", {}, "Source / parent"));
    for (const s of song.sources) grp.append(derivRow(s, 0));
    body.append(grp);
  }

  if (hasDerivs) {
    const grp = el("div", { class: "derivative-group" });
    grp.append(el("h4", {}, `Derivatives (${song.derivatives.length})`));
    for (const d of song.derivatives) grp.append(derivRow(d, 0));
    body.append(grp);
  }
}

function derivRow(s, depth) {
  const wrap = el("div", { class: "deriv-wrap" });
  wrap.style.marginLeft = depth * 16 + "px";

  const row = el("div", { class: "derivative-row" });
  const img = el("img", { src: s.jpg_path ? mediaUrl.cover(s.id) : "", alt: "" });
  if (!s.jpg_path) img.style.background = "var(--bg)";
  row.append(img);

  const info = el("div", { class: "deriv-info" });
  info.append(el("div", { class: "title" }, s.title));
  if (s.kind) info.append(el("div", { class: "kind" }, s.kind));
  row.append(info);

  const toggle = el("button", { class: "deriv-toggle", type: "button" }, "▶");
  const nav = el("a", { class: "deriv-nav", href: `#/song/${s.id}`, title: "Open song" }, "↗");
  row.append(toggle);
  row.append(nav);
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
          if (hasSrc) {
            children.append(el("div", { class: "deriv-sublabel" }, "SOURCES"));
            for (const src of data.sources) children.append(derivRow(src, depth + 1));
          }
          if (hasDrv) {
            children.append(el("div", { class: "deriv-sublabel" }, "DERIVATIVES"));
            for (const drv of data.derivatives) children.append(derivRow(drv, depth + 1));
          }
        }
      } catch {
        children.textContent = "Failed to load.";
      }
    }
  };

  return wrap;
}
