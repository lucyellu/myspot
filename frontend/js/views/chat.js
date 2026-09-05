/**
 * Chat room view for myspot
 * Displays chat interface with message list, input area, and participant list
 * Matches myspot's sage/retro cassette aesthetic
 */

import ChatClient, { createChatRoom, joinChatRoom, updateUsername } from '../chat-client.js';
import * as supabase from '../supabase.js';

let currentChatClient = null;
let currentRoomCode = null;

/**
 * Initialize the chat view
 */
export async function init(urlParams) {
  const roomCode = urlParams.get('room');
  const isCreate = urlParams.get('create') === 'true';

  // Clear the view
  const view = document.getElementById("view");
  view.innerHTML = "";

  if (isCreate) {
    await showCreateRoomModal();
  } else if (roomCode) {
    await joinRoom(roomCode);
  } else {
    // Show room selection/create option
    showRoomSelection();
  }
}

/**
 * Show modal to create a new room
 */
async function showCreateRoomModal() {
  const modal = document.getElementById('chat-create-modal');
  if (modal) {
    modal.hidden = false;
    return;
  }

  // Create the modal
  const modalHTML = `
    <div id="chat-create-modal" class="modal-overlay">
      <div class="modal-content">
        <h2>Create Chat Room</h2>
        <div class="form-group">
          <label>Room Name</label>
          <input type="text" id="room-name-input" class="text-input" placeholder="Enter room name..." maxlength="50">
        </div>
        <div class="form-group">
          <label>Your Username</label>
          <input type="text" id="username-input" class="text-input" placeholder="${supabase.getGuestName()}" value="${supabase.getGuestName()}" maxlength="20">
        </div>
        <div class="form-actions">
          <button id="create-room-btn" class="btn btn-primary">Create Room</button>
          <button id="cancel-create-btn" class="btn">Cancel</button>
        </div>
        <p class="small muted">Room will support up to 6 participants with voice chat, subtitles, and waveform visualizer.</p>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const modal = document.getElementById('chat-create-modal');

  // Add event listeners
  document.getElementById('create-room-btn').addEventListener('click', async () => {
    const roomName = document.getElementById('room-name-input').value.trim();
    const username = document.getElementById('username-input').value.trim();

    if (!roomName) {
      alert('Please enter a room name');
      return;
    }

    if (!username) {
      alert('Please enter a username');
      return;
    }

    // Update username if changed
    if (username !== supabase.getGuestName()) {
      updateUsername(username);
    }

    await createAndJoinRoom(roomName);
    modal.hidden = true;
  });

  document.getElementById('cancel-create-btn').addEventListener('click', () => {
    modal.hidden = true;
    window.location.hash = '#/';
  });

  // Allow Enter key to submit
  document.getElementById('room-name-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('create-room-btn').click();
    }
  });

  modal.hidden = false;
}

/**
 * Show room selection interface
 */
function showRoomSelection() {
  const view = document.getElementById("view");
  const tpl = document.getElementById("tpl-chat-welcome").content.cloneNode(true);
  view.append(tpl);

  // Add event listeners
  document.getElementById('create-room-option').addEventListener('click', () => {
    window.location.hash = '#/chat?create=true';
  });

  document.getElementById('join-room-option').addEventListener('click', () => {
    showJoinRoomModal();
  });
}

/**
 * Show modal to join a room by code
 */
function showJoinRoomModal() {
  const roomCode = prompt('Enter room code:');
  if (roomCode && roomCode.trim()) {
    window.location.hash = `#/chat?room=${encodeURIComponent(roomCode.trim())}`;
  }
}

/**
 * Create and join a new room
 */
async function createAndJoinRoom(roomName) {
  try {
    const response = await createChatRoom(roomName);
    console.log('[chat] Room created:', response);

    // Update URL to reflect the new room
    window.location.hash = `#/chat?room=${response.room_code}`;
  } catch (error) {
    console.error('[chat] Failed to create room:', error);
    alert('Failed to create room: ' + error.message);
  }
}

/**
 * Join an existing room
 */
async function joinRoom(roomCode) {
  currentRoomCode = roomCode;

  try {
    const roomInfo = await joinChatRoom(roomCode);
    console.log('[chat] Joined room:', roomInfo);

    // Create chat client
    currentChatClient = new ChatClient(roomInfo, {
      user_id: roomInfo.user_id,
      username: supabase.getGuestName()
    });

    // Set up callbacks
    currentChatClient.onMessage = handleNewMessage;
    currentChatClient.onParticipantJoin = handleParticipantJoin;
    currentChatClient.onParticipantLeave = handleParticipantLeave;
    currentChatClient.onTyping = handleTyping;
    currentChatClient.onError = handleError;

    // Render chat interface
    renderChatInterface(roomInfo);

    // Connect to the room
    await currentChatClient.connect();

    // Load initial messages
    renderMessages();

  } catch (error) {
    console.error('[chat] Failed to join room:', error);
    renderError('Failed to join room: ' + error.message);
  }
}

/**
 * Render the main chat interface
 */
function renderChatInterface(roomInfo) {
  const view = document.getElementById("view");
  const tpl = document.getElementById("tpl-chat").content.cloneNode(true);
  view.append(tpl);

  // Set room info
  document.getElementById('chat-room-name').textContent = roomInfo.name;
  document.getElementById('chat-room-code').textContent = roomInfo.room_code;

  // Add event listeners
  document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    } else {
      // Send typing indicator
      if (currentChatClient) {
        currentChatClient.sendTyping();
      }
    }
  });

  document.getElementById('send-btn').addEventListener('click', sendMessage);
  document.getElementById('invite-btn').addEventListener('click', showInviteLink);
  document.getElementById('leave-btn').addEventListener('click', leaveRoom);
  document.getElementById('voice-chat-btn').addEventListener('click', () => {
    // TODO: Implement voice chat (Task 9)
    alert('Voice chat coming soon! This will enable WebRTC for up to 6 people.');
  });
}

/**
 * Render messages in the chat
 */
function renderMessages() {
  const container = document.getElementById('messages-container');
  if (!container || !currentChatClient) return;

  const messages = currentChatClient.getMessages();
  const myUserId = currentChatClient.userId;

  container.innerHTML = messages.map(msg => {
    const isMe = msg.user_id === myUserId;
    return `
      <div class="message ${isMe ? 'message-me' : 'message-other'}">
        <div class="message-header">
          <span class="message-username">${escapeHtml(msg.username)}</span>
          <span class="message-time">${formatTime(msg.created_at)}</span>
        </div>
        <div class="message-body">${escapeHtml(msg.message)}</div>
      </div>
    `;
  }).join('');

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

/**
 * Send a message
 */
function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();

  if (!text || !currentChatClient) return;

  currentChatClient.sendMessage(text);
  input.value = '';

  // Re-render messages to include our message
  renderMessages();
}

/**
 * Handle new incoming message
 */
function handleNewMessage(message) {
  // Add to UI
  const container = document.getElementById('messages-container');
  if (!container) return;

  const myUserId = currentChatClient.userId;
  const isMe = message.user_id === myUserId;

  const messageHTML = `
    <div class="message ${isMe ? 'message-me' : 'message-other'}">
      <div class="message-header">
        <span class="message-username">${escapeHtml(message.username)}</span>
        <span class="message-time">${formatTime(message.created_at || message.timestamp)}</span>
      </div>
      <div class="message-body">${escapeHtml(message.message)}</div>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', messageHTML);
  container.scrollTop = container.scrollHeight;
}

/**
 * Handle participant joining
 */
function handleParticipantJoin(participant) {
  updateParticipantsList();
  showSystemMessage(`${escapeHtml(participant.username)} joined the room`);
}

/**
 * Handle participant leaving
 */
function handleParticipantLeave(participant) {
  updateParticipantsList();
  showSystemMessage(`${escapeHtml(participant.username)} left the room`);
}

/**
 * Handle typing indicator
 */
function handleTyping(users) {
  const indicator = document.getElementById('typing-indicator');
  if (!indicator) return;

  if (users.length > 0) {
    indicator.textContent = `${users.join(', ')} ${users.length === 1 ? 'is' : 'are'} typing...`;
    indicator.hidden = false;
  } else {
    indicator.hidden = true;
  }
}

/**
 * Handle errors
 */
function handleError(error) {
  console.error('[chat] Error:', error);
  showSystemMessage(`Error: ${error.message}`);
}

/**
 * Update participants list
 */
function updateParticipantsList() {
  const list = document.getElementById('participants-list');
  const count = document.getElementById('participant-count');
  if (!list || !currentChatClient) return;

  const participants = currentChatClient.getParticipants();
  count.textContent = participants.length;

  list.innerHTML = participants.map(p => `
    <div class="participant-item">
      <span class="participant-name">${escapeHtml(p.username)}</span>
      <span class="participant-status online">●</span>
    </div>
  `).join('');
}

/**
 * Show system message
 */
function showSystemMessage(text) {
  const container = document.getElementById('messages-container');
  if (!container) return;

  const messageHTML = `
    <div class="message message-system">
      <div class="message-body">${text}</div>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', messageHTML);
  container.scrollTop = container.scrollHeight;
}

/**
 * Show invite link
 */
function showInviteLink() {
  const inviteURL = window.location.href;
  const shareText = `Join my chat room "${currentChatClient.roomName}" on myspot! Room code: ${currentRoomCode}`;

  if (navigator.share) {
    navigator.share({
      title: 'Join my chat room',
      text: shareText,
      url: inviteURL
    }).catch(console.error);
  } else {
    // Fallback: copy to clipboard
    navigator.clipboard.writeText(inviteURL).then(() => {
      alert('Invite link copied to clipboard!');
    }).catch(() => {
      prompt('Share this link:', inviteURL);
    });
  }
}

/**
 * Leave the current room
 */
function leaveRoom() {
  if (currentChatClient) {
    currentChatClient.disconnect();
    currentChatClient = null;
  }

  currentRoomCode = null;
  window.location.hash = '#/';
}

/**
 * Render error message
 */
function renderError(message) {
  const view = document.getElementById("view");
  view.innerHTML = `
    <div class="error-container">
      <h2>Error</h2>
      <p>${escapeHtml(message)}</p>
      <button class="btn" onclick="window.location.hash='#/'">Back to Home</button>
    </div>
  `;
}

/**
 * Clean up when leaving the view
 */
export function destroy() {
  if (currentChatClient) {
    currentChatClient.disconnect();
    currentChatClient = null;
  }
  currentRoomCode = null;
}

// Utility functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default { init, destroy };
