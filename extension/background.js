// myspot bridge — service worker
// Adds a "Send to myspot" right-click menu on any image, anywhere.

const MYSPOT = "http://127.0.0.1:7777";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "myspot-send-image",
    title: "Send to myspot",
    contexts: ["image"],
  });
  chrome.contextMenus.create({
    id: "myspot-send-image-attach",
    title: "Send to myspot → attach to current song",
    contexts: ["image"],
  });
  chrome.contextMenus.create({
    id: "myspot-send-link",
    title: "Send link to myspot",
    contexts: ["link"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === "myspot-send-image") {
      await sendImageUrl(info.srcUrl, { sourceUrl: tab?.url, attach: false });
    } else if (info.menuItemId === "myspot-send-image-attach") {
      await sendImageUrl(info.srcUrl, { sourceUrl: tab?.url, attach: true });
    } else if (info.menuItemId === "myspot-send-link") {
      await sendImageUrl(info.linkUrl, { sourceUrl: tab?.url, attach: false });
    }
  } catch (e) {
    notify("Send failed", String(e).slice(0, 200));
  }
});

async function sendImageUrl(url, { sourceUrl = null, attach = false } = {}) {
  if (!url) {
    notify("Send failed", "No image URL");
    return;
  }
  const r = await fetch(`${MYSPOT}/api/extension/import-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, source_url: sourceUrl, attach_to_current: attach }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    notify("Send failed", (data.error || `HTTP ${r.status}`).slice(0, 200));
    return;
  }
  if (data.attached_to_song_id) {
    notify("✓ Sent to myspot", `Attached to song #${data.attached_to_song_id}`);
  } else if (data.asset_id) {
    notify("✓ Sent to myspot", `Saved as asset #${data.asset_id}`);
  } else {
    notify("✓ Sent to myspot", "Saved");
  }
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
  });
}

// Popup → background bridge: ping the backend
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "ping") {
    fetch(`${MYSPOT}/api/health`)
      .then((r) => r.json())
      .then((d) => sendResponse({ ok: true, health: d }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async
  }
  if (msg?.type === "current-song") {
    fetch(`${MYSPOT}/api/extension/current-song`)
      .then((r) => r.json())
      .then((d) => sendResponse({ ok: true, ...d }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});
