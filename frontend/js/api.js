const BASE = "";

async function req(path, opts = {}) {
  const r = await fetch(BASE + path, opts);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText}: ${text || path}`);
  }
  if (r.status === 204) return null;
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : r.text();
}

export const api = {
  stats: () => req("/api/stats"),
  channels: () => req("/api/channels"),
  songs: ({ account = null, q = null, limit = 60, offset = 0, sort = "recent" } = {}) => {
    // sort ∈ recent | title | version | popular | liked | gens | recent_played
    const u = new URLSearchParams();
    if (account) u.set("account", account);
    if (q) u.set("q", q);
    u.set("limit", limit);
    u.set("offset", offset);
    u.set("sort", sort);
    return req(`/api/songs?${u}`);
  },
  topSongs: ({ by = "popular", limit = 20, account = null } = {}) => {
    const u = new URLSearchParams({ by, limit });
    if (account) u.set("account", account);
    return req(`/api/top-songs?${u}`);
  },
  toggleLike: (songId) =>
    req(`/api/songs/${songId}/like`, { method: "POST" }),
  recordPlay: (songId, msPlayed = null) =>
    req(`/api/songs/${songId}/play`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ms_played: msPlayed }),
    }),
  songPlays: (songId) => req(`/api/songs/${songId}/plays`),
  song: (id) => req(`/api/songs/${id}`),
  related: (id, limit = 20) => req(`/api/songs/${id}/related?limit=${limit}`),
  putNote: (id, body) =>
    req(`/api/songs/${id}/notes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    }),
  prompts: ({ q = null, category = null } = {}) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (category) u.set("category", category);
    const qs = u.toString();
    return req(`/api/prompts${qs ? "?" + qs : ""}`);
  },
  promptCategories: () => req("/api/prompts/categories"),
  promptTags: () => req("/api/prompt-tags"),
  savePrompt: (data) =>
    req("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  markPromptUsed: (id) => req(`/api/prompts/${id}/used`, { method: "POST" }),
  deletePrompt: (id) => req(`/api/prompts/${id}`, { method: "DELETE" }),
  songGens: (id) => req(`/api/songs/${id}/gens`),
  uploadGen: async (songId, file, { tool = "manual", kind = "image", prompt = "" } = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    const u = new URLSearchParams({ tool, kind, prompt });
    return req(`/api/songs/${songId}/gens/upload?${u}`, { method: "POST", body: fd });
  },
  generateGen: (songId, tool, prompt) =>
    req(`/api/songs/${songId}/gens/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, prompt }),
    }),
  enqueueGen: (songId, tool) =>
    req(`/api/songs/${songId}/gens/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool }),
    }),
  enhancePrompt: (songId, { model = "deepseek", seed = "", image_prompt = "" } = {}) =>
    req(`/api/songs/${songId}/enhance-prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, seed, image_prompt }),
    }),
  inspireFromUrl: (songId, url, seed = "") =>
    req(`/api/songs/${songId}/inspire/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, seed }),
    }),
  inspireFromUpload: async (songId, file, seed = "") => {
    const fd = new FormData();
    fd.append("file", file);
    const u = new URLSearchParams({ seed });
    return req(`/api/songs/${songId}/inspire/upload?${u}`, { method: "POST", body: fd });
  },
  inspireFromAsset: (assetId, songId = null, seed = "") =>
    req(`/api/inspire/asset/${assetId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song_id: songId, seed }),
    }),
  batchFill: (tool, account = null, limit = 50) =>
    req("/api/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, account, limit }),
    }),
  jobs: (status = null, limit = 60) => {
    const u = new URLSearchParams({ limit });
    if (status) u.set("status", status);
    return req(`/api/jobs?${u}`);
  },
  clearCompletedJobs: () => req("/api/jobs", { method: "DELETE" }),
  animateGen: (genId, tool = "hf-ltx-video", prompt = "") =>
    req(`/api/gens/${genId}/animate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, prompt }),
    }),
  autoPipeline: (songId, { count = 4, animate = false, seed = "" } = {}) =>
    req(`/api/songs/${songId}/auto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count, animate, seed }),
    }),
  exportSong: (songId) => req(`/api/songs/${songId}/export`, { method: "POST" }),
  attachAsset: (songId, assetId) =>
    req(`/api/songs/${songId}/gens/from_asset/${assetId}`, { method: "POST" }),
  health: () => req("/api/health"),
  reloadEnv: () => req("/api/reload-env", { method: "POST" }),
  setExtensionCurrentSong: (songId) =>
    req("/api/extension/current-song-set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song_id: songId }),
    }),
  deleteGen: (id) => req(`/api/gens/${id}`, { method: "DELETE" }),
  assets: ({ folder = null, kind = null, limit = 120, offset = 0 } = {}) => {
    const u = new URLSearchParams();
    if (folder) u.set("folder", folder);
    if (kind) u.set("kind", kind);
    u.set("limit", limit);
    u.set("offset", offset);
    return req(`/api/assets?${u}`);
  },
  assetFolders: () => req("/api/asset_folders"),
  gensBrowse: ({ limit = 120, offset = 0 } = {}) => {
    const u = new URLSearchParams({ limit, offset });
    return req(`/api/gens_browse?${u}`);
  },
  reindex: () => req("/api/reindex", { method: "POST" }),
  reindexStatus: () => req("/api/reindex/status"),
};

export const mediaUrl = {
  audio: (id) => `/media/audio/${id}`,
  cover: (id) => `/media/cover/${id}`,
  asset: (id) => `/media/asset/${id}`,
  gen: (id) => `/media/gen/${id}`,
  export: (id) => `/media/export/${id}`,
};
