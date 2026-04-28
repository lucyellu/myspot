const statusEl = document.getElementById("status");
const songEl = document.getElementById("current-song");

async function ping() {
  statusEl.textContent = "Checking myspot...";
  statusEl.className = "status";
  const res = await new Promise((resolve) =>
    chrome.runtime.sendMessage({ type: "ping" }, resolve),
  );
  if (res?.ok && res.health) {
    const h = res.health;
    const tools = Object.entries(h.tools)
      .filter(([_, v]) => v.available)
      .map(([k]) => k);
    statusEl.className = "status ok";
    statusEl.innerHTML =
      `✓ Connected to myspot · localhost:7777<br>` +
      `<span style="opacity:.7">tools: ${tools.length ? tools.join(", ") : "none keyed"}</span>`;
  } else {
    statusEl.className = "status bad";
    statusEl.textContent =
      "✗ Cannot reach myspot at localhost:7777. Is the server running? (start.bat or Desktop\\myspot.lnk)";
  }
  // Try to fetch the current song
  const cur = await new Promise((resolve) =>
    chrome.runtime.sendMessage({ type: "current-song" }, resolve),
  );
  if (cur?.ok && cur.song) {
    songEl.innerHTML =
      `<strong>Current song:</strong> ${escapeHtml(cur.song.title)}` +
      (cur.song.account ? ` <span style="opacity:.6">(${escapeHtml(cur.song.account.replace(/^sunosync_?/, ""))})</span>` : "");
  } else {
    songEl.innerHTML = `<span style="opacity:.6">No song currently open in myspot.</span>`;
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

document.getElementById("open-myspot").onclick = () => {
  chrome.tabs.create({ url: "http://127.0.0.1:7777/" });
};
document.getElementById("ping").onclick = ping;

ping();
