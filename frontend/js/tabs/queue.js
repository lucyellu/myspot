import { api } from "../api.js";
import { el, clear, toast } from "../util.js";

export function renderQueue(body, song) {
  clear(body);

  // Batch controls
  const ctl = el("div", { class: "gen-form" });
  const tool = el("select", {});
  tool.append(el("option", { value: "nano-banana" }, "Nano Banana (free)"));
  tool.append(el("option", { value: "grok" }, "Grok Imagine ($0.02/img)"));
  ctl.append(el("label", {}, "Batch tool", tool));
  const limit = el("input", { type: "number", value: 20, min: 1, max: 500 });
  ctl.append(el("label", {}, "How many", limit));
  const scope = el("select", {});
  scope.append(el("option", { value: "all" }, "All accounts"));
  scope.append(el("option", { value: "current", selected: true }, `Current account (${song.account || "?"})`));
  ctl.append(el("label", {}, "Scope", scope));
  const fillBtn = el("button", { class: "btn primary", type: "button" }, "Enqueue batch");
  ctl.append(fillBtn);
  body.append(ctl);

  fillBtn.onclick = async () => {
    fillBtn.disabled = true;
    try {
      const account = scope.value === "current" ? song.account : null;
      const r = await api.batchFill(tool.value, account, parseInt(limit.value, 10));
      toast(`Enqueued ${r.enqueued}`);
    } catch (e) { toast("Failed: " + e.message); }
    fillBtn.disabled = false;
  };

  // Job list
  const summary = el("div", { class: "muted", style: "margin: 12px 0 6px" }, "Loading...");
  body.append(summary);
  const list = el("div", { id: "job-list" });
  body.append(list);

  const clearBtn = el("button", { class: "btn", type: "button", style: "margin-top:8px" }, "Clear completed/failed");
  body.append(clearBtn);
  clearBtn.onclick = async () => {
    if (!confirm("Clear completed and failed jobs from the queue list?")) return;
    await api.clearCompletedJobs(); refresh();
  };

  let timer = null;
  async function refresh() {
    let data;
    try { data = await api.jobs(); } catch { return; }
    summary.innerHTML = (data.summary || [])
      .map((s) => `<span class="chip">${s.status}: ${s.n}</span>`)
      .join(" ") || "<span class='muted'>No jobs yet.</span>";
    clear(list);
    if (!data.items.length) {
      list.append(el("div", { class: "empty-state" }, "Queue is empty."));
      return;
    }
    for (const j of data.items) list.append(jobRow(j));
  }
  refresh();
  timer = setInterval(refresh, 3000);
  body._cleanup = () => clearInterval(timer);
}

function jobRow(j) {
  const row = el("div", { class: "derivative-row", style: "grid-template-columns: 1fr auto;" });
  const left = el("div");
  left.append(el("div", { class: "title" }, j.title || `Song #${j.song_id}`));
  const sub = `${j.tool} · ${j.status}${j.error ? " · " + j.error.slice(0, 80) : ""}`;
  left.append(el("div", { class: "muted", style: "font-size:11px;margin-top:2px" }, sub));
  row.append(left);
  const link = el("a", { class: "muted", href: `#/song/${j.song_id}` }, "open →");
  row.append(link);
  return row;
}
