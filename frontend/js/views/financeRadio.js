import { api, mediaUrl } from "../api.js?v=radio-voice3";
import { clear, el, fmtDuration, fmtTimestamp, toast } from "../util.js";

export async function renderFinanceRadio({ mount = null, standalone = false } = {}) {
  const root = mount || document.getElementById("view");
  if (!root) return;
  clear(root);

  const today = new Date();
  const state = {
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    calendar: null,
    selectedSummary: null,
    selectedShow: null,
    selectedSegment: null,
  };

  const shell = el("section", { class: `finance-radio-page${standalone ? " standalone" : ""}` });
  const header = el("header", { class: "finance-radio-head" });
  const titleWrap = el("div", {},
    el("p", { class: "finance-radio-kicker" }, "STANDALONE MORNING DESK"),
    el("h1", {}, "Finance Radio Calendar"),
    el("p", { class: "finance-radio-subhead" }, "Monthly market-first shows with segment playback, ticker references, and a fast read on the last completed session."),
  );
  const nav = el("div", { class: "finance-radio-nav" });
  const prevBtn = el("button", { class: "btn", type: "button" }, "Prev");
  const monthLabel = el("strong", { class: "finance-radio-month-label" }, "");
  const nextBtn = el("button", { class: "btn", type: "button" }, "Next");
  const refreshBtn = el("button", { class: "btn", type: "button" }, "Refresh");
  const standaloneLink = standalone
    ? el("a", { class: "btn", href: "/#/finance-radio" }, "Open In App")
    : el("a", { class: "btn", href: "/static/finance-radio.html" }, "Open Standalone");
  nav.append(prevBtn, monthLabel, nextBtn, refreshBtn, standaloneLink);
  header.append(titleWrap, nav);

  const metrics = el("section", { class: "finance-radio-metrics" });
  const calendarWrap = el("section", { class: "finance-radio-calendar-wrap" });
  const calendarGrid = el("div", { class: "finance-radio-calendar" });
  calendarWrap.append(calendarGrid);

  const detailGrid = el("section", { class: "finance-radio-detail-grid" });
  const showPane = el("article", { class: "finance-radio-panel" });
  const showHead = el("div", { class: "finance-radio-panel-head" },
    el("div", {},
      el("p", { class: "finance-radio-kicker" }, "SHOW"),
      el("h2", {}, "Select a day")),
  );
  const showMeta = el("div", { class: "finance-radio-meta-strip" });
  const marketBoard = el("div", { class: "finance-radio-market-board" });
  const transcriptBox = el("div", { class: "finance-radio-transcript" }, "Choose a segment to inspect the script.");
  const player = el("audio", { class: "finance-radio-audio", controls: true, preload: "metadata" });
  const segmentsBox = el("div", { class: "finance-radio-segments" });
  showPane.append(showHead, showMeta, marketBoard, player, transcriptBox, segmentsBox);

  const refsPane = el("article", { class: "finance-radio-panel" });
  refsPane.append(
    el("div", { class: "finance-radio-panel-head" },
      el("div", {},
        el("p", { class: "finance-radio-kicker" }, "REFERENCES"),
        el("h2", {}, "Market links and source notes"))),
  );
  const refsBox = el("div", { class: "finance-radio-references" });
  refsPane.append(refsBox);

  detailGrid.append(showPane, refsPane);
  shell.append(header, metrics, calendarWrap, detailGrid);
  root.append(shell);

  player.addEventListener("error", () => {
    if (state.selectedSegment?.text) {
      transcriptBox.textContent = state.selectedSegment.text;
      toast("Voice clip missing or empty. Showing script instead.");
    }
  });

  prevBtn.onclick = async () => { shiftMonth(-1); await loadCalendar(); };
  nextBtn.onclick = async () => { shiftMonth(1); await loadCalendar(); };
  refreshBtn.onclick = async () => { await loadCalendar({ keepSelection: true }); };

  await loadCalendar();

  function shiftMonth(delta) {
    const base = new Date(state.year, state.month - 1 + delta, 1);
    state.year = base.getFullYear();
    state.month = base.getMonth() + 1;
  }

  async function loadCalendar({ preferredDate = null, keepSelection = false } = {}) {
    monthLabel.textContent = formatMonthLabel(state.year, state.month);
    calendarGrid.innerHTML = "<div class=\"finance-radio-loading\">Loading calendar…</div>";
    try {
      const data = await api.radioShowsCalendar({ year: state.year, month: state.month });
      const items = (data.items || []).filter((item) => item.format === "finance-news-morning");
      state.calendar = { ...data, items };
      renderMetrics(items);
      renderCalendar(items);
      const nextId =
        (keepSelection && state.selectedSummary?.id && items.find((item) => item.id === state.selectedSummary.id)?.id) ||
        (preferredDate && pickSummaryForDate(items, preferredDate)?.id) ||
        pickInitialSummary(items)?.id;
      if (nextId) {
        await selectShow(nextId, items.find((item) => item.id === nextId) || null);
      } else {
        state.selectedSummary = null;
        state.selectedShow = null;
        renderDetails();
      }
    } catch (err) {
      calendarGrid.innerHTML = "";
      calendarGrid.append(el("div", { class: "finance-radio-loading" }, `Failed to load calendar: ${err.message}`));
    }
  }

  function renderMetrics(items) {
    clear(metrics);
    const showDays = new Set(items.map((item) => item.showDate)).size;
    const spyMoves = items
      .map((item) => item.marketPulse?.indices?.SPY?.pct)
      .filter((value) => typeof value === "number");
    const avgMove = spyMoves.length ? spyMoves.reduce((sum, value) => sum + value, 0) / spyMoves.length : 0;
    const upDays = items.filter((item) => item.marketPulse?.direction === "up").length;
    const downDays = items.filter((item) => item.marketPulse?.direction === "down").length;
    [
      ["Show days", String(showDays)],
      ["Saved versions", String(items.length)],
      ["Avg SPY move", fmtPct(avgMove)],
      ["Risk-on / off", `${upDays} / ${downDays}`],
    ].forEach(([label, value]) => {
      metrics.append(
        el("div", { class: "finance-radio-metric" },
          el("span", {}, label),
          el("strong", {}, value)),
      );
    });
  }

  function renderCalendar(items) {
    clear(calendarGrid);
    const summaryByDate = new Map();
    for (const item of items) {
      const current = summaryByDate.get(item.showDate);
      if (!current || (item.savedAt || "") > (current.savedAt || "")) summaryByDate.set(item.showDate, item);
    }
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((day) =>
      calendarGrid.append(el("div", { class: "finance-radio-weekday" }, day)));
    for (const cell of monthCells(state.year, state.month)) {
      if (!cell.inMonth) {
        calendarGrid.append(el("div", { class: "finance-radio-day empty", "aria-hidden": "true" }));
        continue;
      }
      const summary = summaryByDate.get(cell.iso);
      const btn = el("button", {
        class: `finance-radio-day${summary ? " has-show" : ""}${summary?.marketPulse?.direction ? ` ${summary.marketPulse.direction}` : ""}${state.selectedSummary?.id === summary?.id ? " active" : ""}`,
        type: "button",
      });
      btn.append(el("span", { class: "finance-radio-day-num" }, String(cell.day)));
      if (summary) {
        btn.append(
          el("strong", { class: "finance-radio-day-title" }, compactTitle(summary.title)),
          el("span", { class: "finance-radio-day-move" }, `SPY ${fmtPct(summary.marketPulse?.indices?.SPY?.pct || 0)}`),
          el("span", { class: "finance-radio-day-tickers" }, (summary.leadTickers || []).slice(0, 3).join(" · ") || "Finance desk"),
          el("span", { class: "finance-radio-day-footer" }, `${summary.talkCount} voice · ${summary.songCount} songs`),
        );
        btn.onclick = () => selectShow(summary.id, summary);
      } else {
        btn.append(
          el("strong", { class: "finance-radio-day-title" }, "No show"),
          el("span", { class: "finance-radio-day-tickers" }, "Build this weekday if needed."),
        );
        btn.onclick = () => {
          state.selectedSummary = { showDate: cell.iso };
          renderDetails();
        };
      }
      calendarGrid.append(btn);
    }
  }

  async function selectShow(showId, summary = null) {
    state.selectedSummary = summary || state.calendar?.items?.find((item) => item.id === showId) || null;
    renderCalendar(state.calendar?.items || []);
    try {
      state.selectedShow = await api.radioShow(showId);
      renderDetails();
    } catch (err) {
      toast(`Failed to load show: ${err.message}`);
    }
  }

  function renderDetails() {
    clear(showMeta);
    clear(marketBoard);
    clear(segmentsBox);
    clear(refsBox);
    player.removeAttribute("src");
    player.load();
    state.selectedSegment = null;

    const h2 = showHead.querySelector("h2");
    if (!state.selectedShow) {
      h2.textContent = state.selectedSummary?.showDate ? `${state.selectedSummary.showDate} not built yet` : "Select a day";
      transcriptBox.textContent = state.selectedSummary?.showDate
        ? "Use Build Selected to generate the show for this weekday."
        : "Choose a day on the calendar to load the finance/news show.";
      refsBox.append(el("div", { class: "finance-radio-empty" }, "Ticker links, market notes, and sources appear here after you select a built show."));
      return;
    }

    const show = state.selectedShow;
    const summary = state.selectedSummary || {};
    h2.textContent = show.title || show.id;
    const scriptPath = show.artifacts?.script_txt || summary.scriptPath || "—";
    [
      ["Date", summary.showDate || show.prefs?.showDate || "—"],
      ["Saved", fmtTimestamp(show.savedAt)],
      ["Runtime", fmtDuration(show.total)],
      ["Script", scriptPath],
    ].forEach(([label, value]) => {
      showMeta.append(el("div", { class: "finance-radio-meta-card" }, el("span", {}, label), el("strong", {}, value)));
    });

    const market = summary.marketPulse || {};
    for (const [symbol, entry] of Object.entries(market.indices || {})) {
      marketBoard.append(
        el("div", { class: `finance-radio-market-card ${market.direction || "flat"}` },
          el("span", {}, `${symbol} · ${market.sessionDate || "latest"}`),
          el("strong", {}, fmtPct(entry.pct)),
          el("div", { class: "finance-radio-bar" }, el("i", { style: `width:${Math.min(100, Math.abs(entry.pct || 0) * 18)}%` })),
          el("small", {}, `Close ${entry.close}`)),
      );
    }

    const talkSegments = (show.segments || []).filter((segment) => segment.type === "talk");
    const firstTalk = talkSegments[0];
    transcriptBox.textContent = firstTalk?.text || "No talk segments found.";
    if (firstTalk?.audioFile) {
      state.selectedSegment = firstTalk;
      player.src = mediaUrl.radioVoice(show.id, firstTalk.audioFile);
    }

    (show.segments || []).forEach((segment, index) => {
      const btn = el("button", { class: "finance-radio-segment", type: "button" });
      btn.append(
        el("span", { class: `finance-radio-segment-type ${segment.type}` }, segment.type === "talk" ? "VOICE" : "SONG"),
        el("div", { class: "finance-radio-segment-copy" },
          el("strong", {}, `${String(index + 1).padStart(2, "0")} · ${segment.title || "Untitled"}`),
          el("small", {}, segment.type === "talk"
            ? `${segment.speaker || "Host"} · ${fmtDuration(segment.duration)}`
            : `${segment.song?.title || "Library song"} · ${fmtDuration(segment.duration)}`)),
      );
      btn.onclick = () => {
        if (segment.type === "talk") {
          state.selectedSegment = segment;
          transcriptBox.textContent = segment.text || "";
          if (segment.audioFile) {
            player.src = mediaUrl.radioVoice(show.id, segment.audioFile);
            player.play().catch(() => {
              transcriptBox.textContent = segment.text || "";
              toast("Voice playback blocked. Script is shown instead.");
            });
          }
        } else if (segment.song?.audio_path) {
          player.src = mediaUrl.path(segment.song.audio_path);
          player.play().catch(() => toast("Song playback was blocked by the browser."));
          transcriptBox.textContent = `${segment.song.title || segment.title}\n${segment.song.account || ""}`;
        }
      };
      segmentsBox.append(btn);
    });

    const tickers = summary.leadTickers?.length ? summary.leadTickers : inferTickers(show.context?.marketMovers || []);
    if (tickers.length) {
      refsBox.append(el("h3", {}, "Ticker Boards"));
      const row = el("div", { class: "finance-radio-link-grid" });
      tickers.forEach((ticker) => {
        row.append(
          el("div", { class: "finance-radio-link-card" },
            el("strong", {}, ticker),
            el("a", { href: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`, target: "_blank", rel: "noreferrer" }, "Yahoo chart"),
            el("a", { href: `https://www.tradingview.com/symbols/${encodeURIComponent(ticker)}/`, target: "_blank", rel: "noreferrer" }, "TradingView")),
        );
      });
      refsBox.append(row);
    }

    const movers = show.context?.marketMovers || [];
    if (movers.length) {
      refsBox.append(el("h3", {}, "Lead Stories"));
      movers.forEach((item) => refsBox.append(el("div", { class: "finance-radio-ref-item" }, item)));
    }
    const tldr = show.context?.tldrAi?.items || [];
    if (tldr.length) {
      refsBox.append(el("h3", {}, "AI Newsletter Notes"));
      tldr.forEach((item) => refsBox.append(el("div", { class: "finance-radio-ref-item subtle" }, item)));
    }
  }
}

function pickInitialSummary(items) {
  const todayIso = new Date().toISOString().slice(0, 10);
  return pickSummaryForDate(items, todayIso) || items[items.length - 1] || null;
}

function pickSummaryForDate(items, showDate) {
  return items
    .filter((item) => item.showDate === showDate)
    .sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""))[0] || null;
}

function formatMonthLabel(year, month) {
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function monthCells(year, month) {
  const first = new Date(year, month - 1, 1);
  const start = new Date(first);
  start.setDate(start.getDate() - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    cells.push({
      iso: current.toISOString().slice(0, 10),
      day: current.getDate(),
      inMonth: current.getMonth() === month - 1,
    });
  }
  return cells;
}

function fmtPct(value) {
  const n = Number(value) || 0;
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function compactTitle(title) {
  return String(title || "").replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/u, "").replace(/\s+morning$/iu, "");
}

function inferTickers(movers) {
  const out = [];
  for (const item of movers || []) {
    const ticker = String(item).split(":", 1)[0].split("/", 1)[0].trim().toUpperCase();
    if (ticker && !out.includes(ticker)) out.push(ticker);
  }
  return out.slice(0, 4);
}
