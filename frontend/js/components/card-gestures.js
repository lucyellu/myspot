import { api } from "../api.js";
import { toast, el } from "../util.js";
import { enqueueSong } from "../player.js";

const RECENT_PLAYLIST_KEY = "myspot_recent_playlist";

export function getRecentPlaylist() {
  try {
    const raw = localStorage.getItem(RECENT_PLAYLIST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setRecentPlaylist(id, name) {
  try {
    localStorage.setItem(RECENT_PLAYLIST_KEY, JSON.stringify({ id, name }));
  } catch {}
}

/**
 * Open a sleek modal asking the user to choose a playlist for the given song,
 * or create a new playlist on the fly.
 */
export async function showPlaylistPickerModal(song) {
  if (!song) return;

  // Remove any existing picker modal
  const existing = document.getElementById("playlist-picker-modal");
  if (existing) existing.remove();

  const overlay = el("div", { id: "playlist-picker-modal", class: "modal-overlay" });
  const content = el("div", { class: "modal-content playlist-picker-box" });

  const head = el("div", { class: "modal-head" });
  head.append(el("h3", {}, "ADD TO PLAYLIST"));
  const closeBtn = el("button", { class: "ico-btn", type: "button", title: "Close" }, "×");
  head.append(closeBtn);
  content.append(head);

  const songPreview = el("div", { class: "picker-song-preview" });
  if (song.jpg_path || song.id) {
    const thumb = el("img", {
      class: "picker-song-thumb",
      src: `/media/cover/${song.id}`,
      alt: song.title || "",
    });
    thumb.onerror = () => { thumb.style.display = "none"; };
    songPreview.append(thumb);
  }
  const songMeta = el("div", { class: "picker-song-meta" });
  songMeta.append(el("div", { class: "picker-song-title" }, song.title || "Untitled"));
  songMeta.append(el("div", { class: "picker-song-sub muted small" }, [song.account, song.genre].filter(Boolean).join(" · ")));
  songPreview.append(songMeta);
  content.append(songPreview);

  // Quick create row
  const createRow = el("div", { class: "picker-create-row" });
  const createInput = el("input", {
    type: "text",
    class: "api-url-input",
    placeholder: "New playlist name...",
  });
  const createBtn = el("button", { class: "btn primary", type: "button" }, "+ CREATE & ADD");
  createRow.append(createInput, createBtn);
  content.append(createRow);

  const listContainer = el("div", { class: "picker-playlist-list" });
  listContainer.append(el("div", { class: "muted small", style: "padding: 12px 6px;" }, "Loading playlists..."));
  content.append(listContainer);

  overlay.append(content);
  document.body.append(overlay);

  const close = () => {
    overlay.classList.add("closing");
    setTimeout(() => overlay.remove(), 160);
  };

  closeBtn.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };

  const handleAdd = async (playlistId, playlistName) => {
    try {
      const res = await api.addPlaylistSong(playlistId, song.id);
      setRecentPlaylist(playlistId, playlistName);
      if (res.added === 0) {
        toast(`"${song.title}" is already in ${playlistName}`);
      } else {
        toast(`Added "${song.title}" to ${playlistName}`);
      }
      document.dispatchEvent(new CustomEvent("myspot:playlistschange"));
      close();
    } catch (err) {
      toast("Failed to add to playlist: " + err.message);
    }
  };

  const handleCreate = async () => {
    const name = createInput.value.trim();
    if (!name) {
      toast("Please enter a playlist name");
      createInput.focus();
      return;
    }
    createBtn.disabled = true;
    try {
      const created = await api.createPlaylist(name);
      await handleAdd(created.id, created.name);
    } catch (err) {
      toast("Create failed: " + err.message);
      createBtn.disabled = false;
    }
  };

  createBtn.onclick = handleCreate;
  createInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    } else if (e.key === "Escape") {
      close();
    }
  });

  try {
    const playlists = await api.playlists();
    listContainer.innerHTML = "";
    if (!playlists.length) {
      listContainer.append(el("div", { class: "muted small", style: "padding: 12px 6px;" }, "No playlists created yet. Type a name above to create your first one!"));
    } else {
      const recent = getRecentPlaylist();
      for (const p of playlists) {
        const item = el("button", { class: "picker-playlist-item", type: "button" });
        const isRecent = recent && recent.id === p.id;
        item.innerHTML = `
          <div class="picker-playlist-info">
            <span class="picker-playlist-name">${p.name} ${isRecent ? '<span class="picker-recent-badge">RECENT</span>' : ""}</span>
            <span class="picker-playlist-count muted small">${p.song_count} songs</span>
          </div>
          <span class="picker-playlist-add">+</span>
        `;
        item.onclick = () => handleAdd(p.id, p.name);
        listContainer.append(item);
      }
    }
    createInput.focus();
  } catch (e) {
    listContainer.innerHTML = `<div class="muted small">Failed to load playlists: ${e.message}</div>`;
  }
}

/**
 * Quick add song to the most recently used playlist.
 * If no recent playlist is set or found, falls back to showPlaylistPickerModal.
 */
export async function quickAddToRecentPlaylist(song) {
  const recent = getRecentPlaylist();
  if (!recent || !recent.id) {
    showPlaylistPickerModal(song);
    return;
  }
  try {
    const res = await api.addPlaylistSong(recent.id, song.id);
    if (res.added === 0) {
      toast(`"${song.title}" is already in ${recent.name}`);
    } else {
      toast(`Added "${song.title}" to ${recent.name}`);
    }
    document.dispatchEvent(new CustomEvent("myspot:playlistschange"));
  } catch (err) {
    showPlaylistPickerModal(song);
  }
}

/**
 * Attach swipe left/right/down gestures to a song card.
 * Works seamlessly with touch devices and pointer/mouse drag.
 */
export function attachCardGestures(cardEl, song) {
  if (!cardEl || !song) return;

  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let isDragging = false;
  let hasMoved = false;
  let activeDirection = null;

  cardEl.classList.add("swipeable-card");

  let indicatorEl = null;

  const ensureIndicator = () => {
    if (!indicatorEl) {
      indicatorEl = el("div", { class: "card-swipe-indicator" });
      cardEl.append(indicatorEl);
    }
    return indicatorEl;
  };

  const removeIndicator = () => {
    if (indicatorEl) {
      indicatorEl.remove();
      indicatorEl = null;
    }
  };

  const updateVisuals = (dx, dy) => {
    const absX = Math.abs(dx);
    const ind = ensureIndicator();

    if (dy > 40 && dy > absX * 0.8) {
      // Swipe down
      activeDirection = "down";
      ind.className = "card-swipe-indicator swipe-down";
      ind.innerHTML = `<span class="swipe-icon">⬇</span><span>CHOOSE PLAYLIST</span>`;
      cardEl.style.transform = `translateY(${Math.min(dy * 0.4, 50)}px) scale(0.98)`;
      cardEl.classList.add("swiping");
    } else if (dx < -30 && absX > Math.abs(dy)) {
      // Swipe left
      activeDirection = "left";
      ind.className = "card-swipe-indicator swipe-left";
      ind.innerHTML = `<span>+ PLAY QUEUE</span><span class="swipe-icon">⬅</span>`;
      cardEl.style.transform = `translateX(${Math.max(dx * 0.6, -110)}px)`;
      cardEl.classList.add("swiping");
    } else if (dx > 30 && absX > Math.abs(dy)) {
      // Swipe right
      activeDirection = "right";
      const recent = getRecentPlaylist();
      const targetName = recent ? `+ ${recent.name}` : "+ PLAYLIST";
      ind.className = "card-swipe-indicator swipe-right";
      ind.innerHTML = `<span class="swipe-icon">➡</span><span>${targetName}</span>`;
      cardEl.style.transform = `translateX(${Math.min(dx * 0.6, 110)}px)`;
      cardEl.classList.add("swiping");
    } else {
      activeDirection = null;
      removeIndicator();
      cardEl.style.transform = "";
      cardEl.classList.remove("swiping");
    }
  };

  const resetCard = () => {
    cardEl.style.transition = "transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)";
    cardEl.style.transform = "";
    cardEl.classList.remove("swiping");
    setTimeout(() => {
      cardEl.style.transition = "";
      removeIndicator();
    }, 200);
  };

  cardEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.target.closest("button, .card-quick-play, .channel-rename-btn")) return;

    startX = e.clientX;
    startY = e.clientY;
    currentX = startX;
    currentY = startY;
    isDragging = true;
    hasMoved = false;
    activeDirection = null;
  });

  const onPointerMove = (e) => {
    if (!isDragging) return;
    currentX = e.clientX;
    currentY = e.clientY;
    const dx = currentX - startX;
    const dy = currentY - startY;

    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      hasMoved = true;
      updateVisuals(dx, dy);
    }
  };

  const onPointerEnd = (e) => {
    if (!isDragging) return;
    isDragging = false;

    const dx = currentX - startX;
    const dy = currentY - startY;

    if (hasMoved) {
      const blockClick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      cardEl.addEventListener("click", blockClick, { capture: true, once: true });
      setTimeout(() => cardEl.removeEventListener("click", blockClick, { capture: true }), 100);

      const thresholdH = 60;
      const thresholdV = 50;

      if (activeDirection === "left" && dx < -thresholdH) {
        enqueueSong(song);
        cardEl.classList.add("swipe-success-left");
        setTimeout(() => cardEl.classList.remove("swipe-success-left"), 300);
      } else if (activeDirection === "right" && dx > thresholdH) {
        quickAddToRecentPlaylist(song);
        cardEl.classList.add("swipe-success-right");
        setTimeout(() => cardEl.classList.remove("swipe-success-right"), 300);
      } else if (activeDirection === "down" && dy > thresholdV) {
        showPlaylistPickerModal(song);
      }
    }

    resetCard();
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerEnd);
  window.addEventListener("pointercancel", onPointerEnd);
}
