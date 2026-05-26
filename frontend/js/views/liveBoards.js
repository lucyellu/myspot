import { api, mediaUrl } from "../api.js?v=liveboards2";
import { el, clear, toast, fmtDuration } from "../util.js";

const PANEL_KEY = "myspot.liveBoards.panels.v1";
const FAVE_KEY = "myspot.liveBoards.faves.v1";

let _boards = [];
let _detail = null;
let _health = null;
let _selectedPanels = new Set();
let _faves = loadJson(FAVE_KEY, {});

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "") || fallback; }
  catch { return fallback; }
}

function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function preferredTool() {
  const tools = _health?.tools || {};
  for (const name of ["openai-gpt-image-2", "pollinations-realism", "hf-flux", "nano-banana", "grok", "pollinations"]) {
    const base = name.split("-realism")[0];
    if (tools[name]?.available || tools[base]?.available || name.startsWith("pollinations")) return name;
  }
  return "pollinations-realism";
}

function videoToolAvailable() {
  return !!_health?.tools?.["hf-ltx-video"]?.available;
}

function boardPanelsKey(id) {
  return `board:${id}`;
}

function loadPanels(id) {
  const all = loadJson(PANEL_KEY, {});
  return new Set(all[boardPanelsKey(id)] || []);
}

function savePanels(id, panels) {
  const all = loadJson(PANEL_KEY, {});
  all[boardPanelsKey(id)] = [...panels].sort((a, b) => a - b);
  saveJson(PANEL_KEY, all);
}

export async function renderLiveBoards({ id = null } = {}) {
  const view = document.getElementById("view");
  clear(view);

  const shell = el("section", { class: "live-portal" });
  view.append(shell);

  const header = el("div", { class: "live-portal-head" },
    el("div", {},
      el("h1", {}, "LIVE BOARDS"),
      el("div", { class: "muted" }, "concert previz · 9-grid contact sheets · keyframes · image-to-video")
    ),
    el("div", { class: "live-search-wrap" },
      el("input", { id: "live-board-search", class: "search live-search", type: "search", placeholder: "FILTER LIVE BOARDS..." })
    )
  );
  shell.append(header);

  const layout = el("div", { class: "live-board-layout" });
  const rail = el("aside", { class: "live-board-rail" });
  const detail = el("section", { class: "live-board-detail", id: "live-board-detail" });
  layout.append(rail, detail);
  shell.append(layout);

  try {
    [_health, _boards] = await Promise.all([
      api.health().catch(() => null),
      api.liveBoards().then((r) => r.items || []),
    ]);
  } catch (e) {
    detail.append(el("div", { class: "empty-state" }, `Live boards failed: ${e.message}`));
    return;
  }

  const selectedId = id || _boards[0]?.id || null;
  renderBoardRail(rail, selectedId);
  const search = header.querySelector("#live-board-search");
  search.value = "";
  search.oninput = () => renderBoardRail(rail, selectedId, search.value.trim());

  if (selectedId) await renderBoardDetail(selectedId);
  else detail.append(el("div", { class: "empty-state" }, "Run the live board exporter first."));
}

function renderBoardRail(rail, selectedId, q = "") {
  clear(rail);
  const query = q.toLowerCase();
  const filtered = _boards.filter((b) => !query || b.title.toLowerCase().includes(query));
  rail.append(el("div", { class: "live-rail-count" }, `${filtered.length} / ${_boards.length}`));
  const list = el("div", { class: "live-rail-list" });
  for (const board of filtered) {
    const song = board.song;
    const card = el("a", {
      class: `live-board-row ${board.id === selectedId ? "active" : ""}`,
      href: `#/live-boards/${encodeURIComponent(board.id)}`,
    });
    const thumb = el("span", { class: "live-row-art" });
    if (song?.id) thumb.append(el("img", { src: mediaUrl.cover(song.id), alt: "" }));
    else thumb.textContent = "LIVE";
    card.append(
      thumb,
      el("span", { class: "live-row-main" },
        el("strong", {}, board.title),
        el("span", {}, [
          `${board.variants} variants`,
          song?.account || "unmatched",
          `${board.image_count || 0} images`,
          `${board.video_count || 0} videos`,
        ].join(" · "))
      )
    );
    list.append(card);
  }
  rail.append(list);
}

async function renderBoardDetail(boardId) {
  const host = document.getElementById("live-board-detail");
  clear(host);
  host.append(el("div", { class: "live-loading" }, "Loading board..."));
  try {
    _detail = await api.liveBoard(boardId);
  } catch (e) {
    clear(host);
    host.append(el("div", { class: "empty-state" }, `Board failed: ${e.message}`));
    return;
  }
  _selectedPanels = loadPanels(boardId);
  clear(host);

  const song = _detail.song;
  const tools = _health?.tools || {};
  const imageTool = preferredTool();
  const imageOptions = [
    "openai-gpt-image-2",
    "openai-gpt-image-1.5",
    "openai-gpt-image-mini",
    "pollinations-realism",
    "pollinations",
    "pollinations-anime",
    "hf-flux",
    "nano-banana",
    "grok",
  ];

  const hero = el("div", { class: "live-detail-hero" });
  const art = el("div", { class: "live-detail-art" });
  if (song?.id) art.append(el("img", { src: mediaUrl.cover(song.id), alt: "" }));
  else art.textContent = "LIVE";

  const toolSelect = el("select", { id: "live-image-tool" });
  for (const tool of imageOptions) {
    const base = tool.split("-realism")[0].split("-anime")[0];
    const available = tool.startsWith("pollinations") || tools[tool]?.available || tools[base]?.available;
    const option = el("option", { value: tool, selected: tool === imageTool }, `${tool}${available ? "" : " (not configured)"}`);
    toolSelect.append(option);
  }

  const framesInput = el("input", { id: "live-frame-count", type: "number", min: "1", max: "4", value: "1" });
  const gridBtn = el("button", { class: "btn primary", type: "button" }, "MAKE 9-GRID");
  const framesBtn = el("button", { class: "btn", type: "button" }, "MAKE KEYFRAMES");
  const openSong = el("a", { class: "btn", href: song?.id ? `#/song/${song.id}` : "#", hidden: !song?.id }, "OPEN SONG");

  gridBtn.onclick = () => generateGrid(toolSelect.value);
  framesBtn.onclick = () => generateKeyframes(toolSelect.value, Number(framesInput.value || 1));

  hero.append(
    art,
    el("div", { class: "live-detail-main" },
      el("div", { class: "live-kicker" }, _detail.performance || "live performance recording"),
      el("h2", {}, _detail.title),
      el("div", { class: "live-meta" }, [
        song?.artist || song?.account || "unmatched song",
        song?.genre,
        song?.duration ? fmtDuration(song.duration) : null,
        `${_detail.variants} variants`,
      ].filter(Boolean).join(" · ")),
      el("div", { class: "live-tool-row" },
        toolSelect,
        el("label", { class: "live-stepper" }, "FRAMES", framesInput),
        gridBtn,
        framesBtn,
        openSong
      ),
      el("div", { class: `live-video-status ${videoToolAvailable() ? "ready" : ""}` },
        videoToolAvailable()
          ? "I2V READY · HF LTX VIDEO"
          : "I2V NEEDS HF_TOKEN · STILL IMAGE PREVIZ READY"
      )
    )
  );
  host.append(hero);

  host.append(referenceStrip(_detail));
  host.append(promptPanel(_detail));
  host.append(panelPicker(_detail));
  host.append(gensPanel(_detail));
}

function referenceStrip(detail) {
  const wrap = el("section", { class: "live-section" },
    el("div", { class: "live-section-head" },
      el("h3", {}, "REFERENCES"),
      el("span", { class: "muted" }, `${detail.reference_art.length} art refs`)
    )
  );
  const strip = el("div", { class: "live-ref-strip" });
  detail.reference_art.forEach((_, idx) => {
    strip.append(el("a", { href: mediaUrl.liveBoardRef(detail.id, idx), target: "_blank", class: "live-ref" },
      el("img", { src: mediaUrl.liveBoardRef(detail.id, idx), alt: "" })
    ));
  });
  wrap.append(strip);
  return wrap;
}

function promptPanel(detail) {
  const wrap = el("section", { class: "live-section live-prompts" },
    el("div", { class: "live-section-head" },
      el("h3", {}, "PROMPT PACK"),
      el("button", { class: "btn", type: "button", onclick: () => copyText(detail.contact_prompt) }, "COPY 9-GRID")
    )
  );
  wrap.append(
    el("div", { class: "live-prompt-grid" },
      el("pre", {}, detail.contact_prompt),
      el("pre", {}, detail.keyframe_template)
    )
  );
  return wrap;
}

function panelPicker(detail) {
  const wrap = el("section", { class: "live-section" },
    el("div", { class: "live-section-head" },
      el("h3", {}, "PANELS"),
      el("span", { class: "muted" }, `${_selectedPanels.size} selected`)
    )
  );
  const grid = el("div", { class: "live-panel-grid" });
  for (const panel of detail.panels) {
    const picked = _selectedPanels.has(panel.n);
    const btn = el("button", { class: `live-panel ${picked ? "selected" : ""}`, type: "button" },
      el("span", { class: "live-panel-n" }, String(panel.n)),
      el("span", { class: "live-panel-copy" }, panel.prompt)
    );
    btn.onclick = () => {
      if (_selectedPanels.has(panel.n)) _selectedPanels.delete(panel.n);
      else _selectedPanels.add(panel.n);
      savePanels(detail.id, _selectedPanels);
      renderBoardDetail(detail.id);
    };
    grid.append(btn);
  }
  wrap.append(grid);
  return wrap;
}

function gensPanel(detail) {
  const wrap = el("section", { class: "live-section" },
    el("div", { class: "live-section-head" },
      el("h3", {}, "ASSETS"),
      el("span", { class: "muted" }, `${detail.gens.length} gens`)
    )
  );
  const grid = el("div", { class: "live-gen-grid" });
  if (!detail.gens.length) {
    grid.append(el("div", { class: "empty-state" }, "No generated assets yet."));
  }
  for (const gen of detail.gens) {
    grid.append(genCard(gen));
  }
  wrap.append(grid);
  return wrap;
}

function genCard(gen) {
  const fave = !!_faves[gen.id];
  const card = el("article", { class: `live-gen-card ${gen.status}` });
  const media = el("div", { class: "live-gen-media" });
  if (gen.status === "completed" && gen.file_path) {
    if (gen.kind === "video") media.append(el("video", { src: mediaUrl.gen(gen.id), muted: true, loop: true, playsinline: true, controls: true }));
    else media.append(el("img", { src: mediaUrl.gen(gen.id), alt: "" }));
  } else {
    media.append(el("span", {}, gen.status.toUpperCase()));
  }

  const faveBtn = el("button", { class: `live-star ${fave ? "on" : ""}`, type: "button", title: "Favorite" }, fave ? "★" : "☆");
  faveBtn.onclick = () => {
    if (_faves[gen.id]) delete _faves[gen.id];
    else _faves[gen.id] = true;
    saveJson(FAVE_KEY, _faves);
    renderBoardDetail(_detail.id);
  };
  media.append(faveBtn);
  card.append(media);

  const animateBtn = el("button", { class: "btn", type: "button", disabled: gen.kind !== "image" || gen.status !== "completed" || !videoToolAvailable() }, "I2V");
  animateBtn.onclick = () => animateImage(gen);
  card.append(
    el("div", { class: "live-gen-body" },
      el("strong", {}, `${gen.kind} · ${gen.tool}`),
      el("span", {}, gen.created_at || ""),
      el("div", { class: "live-gen-actions" },
        el("a", { class: "btn", href: mediaUrl.gen(gen.id), target: "_blank" }, "OPEN"),
        animateBtn
      )
    )
  );
  return card;
}

async function generateGrid(tool) {
  if (!_detail?.song?.id) { toast("No indexed song matched this board."); return; }
  const btns = [...document.querySelectorAll(".live-tool-row button")];
  btns.forEach((b) => b.disabled = true);
  toast("Generating 9-grid...");
  try {
    await api.generateGen(_detail.song.id, tool, _detail.contact_prompt, "square");
    toast("9-grid generated");
    await renderBoardDetail(_detail.id);
  } catch (e) {
    toast("9-grid failed: " + e.message, 4200);
  } finally {
    btns.forEach((b) => b.disabled = false);
  }
}

async function generateKeyframes(tool, count) {
  if (!_detail?.song?.id) { toast("No indexed song matched this board."); return; }
  if (!_selectedPanels.size) { toast("Pick at least one panel."); return; }
  const panels = _detail.panels.filter((p) => _selectedPanels.has(p.n));
  const frameCount = Math.max(1, Math.min(4, count || 1));
  toast(`Generating ${panels.length * frameCount} keyframes...`);
  for (const panel of panels) {
    for (let i = 0; i < frameCount; i++) {
      const prompt = [
        _detail.keyframe_template,
        "",
        `Panel ${panel.n}: ${panel.prompt}`,
        `Variation ${i + 1}: keep continuity but choose a fresh camera angle and usable music-video frame.`,
        "",
        `Performance setting: ${_detail.performance}`,
      ].join("\n");
      const result = await api.generateGen(_detail.song.id, tool, prompt, "landscape");
      if (result?.error) throw new Error(result.error);
    }
  }
  toast("Keyframes generated");
  await renderBoardDetail(_detail.id);
}

async function animateImage(gen) {
  const prompt = [
    _detail.motion_notes.join(", "),
    "subtle concert camera motion, stage light flicker, smoke drift, handheld sway, keep performer and venue consistent",
  ].filter(Boolean).join(", ");
  toast("Animating image...");
  try {
    const result = await api.animateGen(gen.id, "hf-ltx-video", prompt);
    if (result?.error) throw new Error(result.error);
    toast("Video generated");
    await renderBoardDetail(_detail.id);
  } catch (e) {
    toast("I2V failed: " + e.message, 4200);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Copy failed");
  }
}
