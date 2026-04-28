import { el, clear } from "../util.js";
import { mediaUrl } from "../api.js";

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
    for (const s of song.sources) grp.append(derivRow(s));
    body.append(grp);
  }

  if (hasDerivs) {
    const grp = el("div", { class: "derivative-group" });
    grp.append(el("h4", {}, `Derivatives (${song.derivatives.length})`));
    for (const d of song.derivatives) grp.append(derivRow(d));
    body.append(grp);
  }
}

function derivRow(s) {
  const a = el("a", { class: "derivative-row", href: `#/song/${s.id}` });
  const img = el("img", { src: s.jpg_path ? mediaUrl.cover(s.id) : "", alt: "" });
  if (!s.jpg_path) img.style.background = "var(--bg)";
  a.append(img);
  a.append(el("div", { class: "title" }, s.title));
  a.append(el("div", { class: "kind" }, s.kind || ""));
  return a;
}
