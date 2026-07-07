import { toast } from "../util.js";

export async function renderSettings(body, _song) {
  body.innerHTML = `<div class="settings-loading">Loading settings...</div>`;

  let settings;
  try {
    const r = await fetch("/api/settings");
    settings = await r.json();
  } catch (e) {
    body.innerHTML = `<div class="empty-state">Failed to load settings: ${e.message}</div>`;
    return;
  }

  const fields = [
    { key: "sunolibrary", label: "Music Library", desc: "Root folder scanned for MP3s" },
    { key: "sunometadb", label: "Suno Metadata DB", desc: "suno_meta.db from suno-dl" },
    { key: "assetsdir", label: "Assets / Album Art", desc: "Root folder for album-art assets" },
  ];

  let html = `<div class="settings-form">`;
  for (const f of fields) {
    const val = settings[f.key] || "";
    html += `
      <div class="settings-field">
        <label for="set-${f.key}">${f.label}</label>
        <p class="settings-desc">${f.desc}</p>
        <input type="text" id="set-${f.key}" value="${val.replace(/"/g, '&quot;')}" />
      </div>`;
  }
  html += `
      <button class="btn-primary" id="btn-save-settings">Save & Reindex</button>
      <span class="settings-hint" id="settings-hint"></span>
    </div>
    <hr style="margin:20px 0;border-color:var(--panel-line)">
    <div class="settings-form">
      <h4>Test MP3 Upload</h4>
      <p class="settings-desc">Upload a sample MP3 to verify playback works. Files land in the library's test/ folder.</p>
      <input type="file" id="test-mp3-file" accept=".mp3,audio/mpeg" />
      <button class="btn-primary" id="btn-upload-mp3">Upload & Test</button>
      <span class="settings-hint" id="upload-hint"></span>
    </div>`;
  body.innerHTML = html;

  document.getElementById("btn-save-settings").onclick = async () => {
    const btn = document.getElementById("btn-save-settings");
    const hint = document.getElementById("settings-hint");
    btn.disabled = true;
    hint.textContent = "Saving...";

    const payload = {};
    for (const f of fields) {
      const el = document.getElementById(`set-${f.key}`);
      if (el && el.value.trim()) payload[f.key] = el.value.trim();
    }

    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (data.ok) {
        hint.textContent = data.reindex_triggered
          ? "Saved! Reindex started — songs will update shortly."
          : "Saved!";
        toast("Settings saved" + (data.reindex_triggered ? " — reindexing" : ""));
      } else {
        hint.textContent = "Error: " + (data.error || "unknown");
      }
    } catch (e) {
      hint.textContent = "Failed: " + e.message;
    }
    btn.disabled = false;
  };

  // MP3 upload
  document.getElementById("btn-upload-mp3").onclick = async () => {
    const fileInput = document.getElementById("test-mp3-file");
    const hint = document.getElementById("upload-hint");
    const file = fileInput.files[0];
    if (!file) { hint.textContent = "Pick an .mp3 file first"; return; }
    hint.textContent = "Uploading...";
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await fetch("/api/upload-test-mp3", { method: "POST", body: form });
      const data = await r.json();
      hint.textContent = data.ok
        ? `Uploaded: ${data.filename}. Reindex started — check library.`
        : "Error: " + (data.detail || "unknown");
    } catch (e) {
      hint.textContent = "Upload failed: " + e.message;
    }
  };

  // Allow Enter key to save (not for file inputs)
  body.querySelectorAll("input[type='text']").forEach((inp) => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("btn-save-settings").click();
    });
  });
}
