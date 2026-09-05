/**
 * Chat client module for myspot
 * Handles text chat, message history, and real-time messaging via Supabase
 * Adapted from Cohere's chatChannel.js
 */

import * as supabase from './supabase.js';
import { api } from './api.js';

// Helper function to match the apiRequest signature expected in chat-client.js
async function apiRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body;

  // Build URL with query params if present
  let url = path;
  if (options.query) {
    const params = new URLSearchParams(options.query);
    url += (path.includes('?') ? '&' : '?') + params.toString();
  }

  const fetchOpts = { method };
  if (body && method !== 'GET' && method !== 'HEAD') {
    fetchOpts.headers = { 'Content-Type': 'application/json' };
    fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await fetch(url.startsWith('http') ? url : (window.MYSPOT_API_BASE || '') + url, fetchOpts);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}: ${text || path}`);
  }

  const ct = response.headers.get('content-type') || '';
  return ct.includes('application/json') ? response.json() : response.text();
}

// Message limit for chat history (ephemeral memory limit)
const MAX_MESSAGES = 200;

/**
 * ChatClient class - manages a single chat room connection
 */
class ChatClient {
  constructor(roomInfo, userInfo) {
    this.roomCode = roomInfo.room_code;
    this.roomId = roomInfo.room_id;
    this.roomName = roomInfo.name;
    this.userId = userInfo.user_id;
    this.username = userInfo.username;
    this.maxParticipants = roomInfo.max_participants || 6;
    this.supabaseConfig = roomInfo.supabase_config || null;

    // Message store (ephemeral, limited to MAX_MESSAGES)
    this.messages = [];

    // Participant tracking
    this.participants = new Map();
    this.participantCount = 0;

    // Channel references
    this.chatChannel = null;
    this.presenceChannel = null;

    // Event callbacks
    this.onMessage = null;
    this.onParticipantJoin = null;
    this.onParticipantLeave = null;
    this.onTyping = null;
    this.onError = null;

    // State tracking
    this.isConnected = false;
    this.isConnecting = false;

    // Typing indicators
    this.typingUsers = new Set();
    this.typingTimeout = null;
  }

  /**
   * Connect to the chat room
   */
  async connect() {
    if (this.isConnected || this.isConnecting) {
      console.warn('[chat] Already connected or connecting');
      return;
    }

    this.isConnecting = true;

    try {
      // Initialize Supabase client
      const supabaseConfig = {
        url: this.supabaseConfig?.url,
        anon_key: this.supabaseConfig?.anon_key
      };

      if (!supabaseConfig.url || !supabaseConfig.anon_key) {
        throw new Error('Supabase configuration is missing. Please ensure the backend is configured correctly.');
      }

      if (!supabase.initSupabase(supabaseConfig)) {
        throw new Error('Failed to initialize Supabase client');
      }

      // Create chat channel
      this.chatChannel = supabase.createChatChannel(this.roomCode);

      // Create presence channel
      this.presenceChannel = supabase.createPresenceChannel(this.roomCode);

      // Subscribe to chat channel
      supabase.subscribeChannel(
        this.chatChannel,
        this._handleBroadcast.bind(this),
        null,
        this._handleError.bind(this)
      );

      // Subscribe to presence channel
      supabase.subscribeChannel(
        this.presenceChannel,
        null,
        this._handlePresence.bind(this),
        this._handleError.bind(this)
      );

      // Track our presence
      supabase.trackPresence(this.presenceChannel, {
        username: this.username,
        room_id: this.roomId
      });

      // Load message history from backend
      await this._loadHistory();

      // Get current participants
      await this._loadParticipants();

      this.isConnected = true;
      this.isConnecting = false;

      console.log('[chat] Connected to room:', this.roomCode);
      this._notifyConnected();

    } catch (error) {
      console.error('[chat] Connection error:', error);
      this.isConnecting = false;
      this._handleError(error);
    }
  }

  /**
   * Disconnect from the chat room
   */
  disconnect() {
    if (!this.isConnected) return;

    // Unsubscribe from channels
    if (this.chatChannel) {
      supabase.unsubscribeChannel(this.chatChannel);
      this.chatChannel = null;
    }

    if (this.presenceChannel) {
      supabase.unsubscribeChannel(this.presenceChannel);
      this.presenceChannel = null;
    }

    // Notify backend that we're leaving
    apiRequest(`/api/chat/rooms/${this.roomCode}/leave`, {
      method: 'DELETE',
      body: JSON.stringify({ user_id: this.userId })
    }).catch(err => console.warn('[chat] Leave notification failed:', err));

    this.isConnected = false;
    console.log('[chat] Disconnected from room:', this.roomCode);
  }

  /**
   * Send a text message
   */
  async sendMessage(text) {
    if (!this.isConnected) {
      console.warn('[chat] Not connected, cannot send message');
      return false;
    }

    const messageData = {
      user_id: this.userId,
      username: this.username,
      message: text.trim(),
      message_type: 'text',
      timestamp: new Date().toISOString()
    };

    // Broadcast via Supabase (real-time)
    const success = supabase.broadcastMessage(
      this.chatChannel,
      'msg',
      messageData
    );

    if (success) {
      // Also save to backend for persistence
      apiRequest(`/api/chat/rooms/${this.roomCode}/messages`, {
        method: 'POST',
        body: JSON.stringify(messageData)
      }).catch(err => console.warn('[chat] Failed to save message:', err));

      // Add to local message store
      this._addMessage({
        ...messageData,
        created_at: messageData.timestamp,
        local: true
      });
    }

    return success;
  }

  /**
   * Send a typing indicator
   */
  sendTyping() {
    if (!this.isConnected) return;

    supabase.broadcastMessage(
      this.chatChannel,
      'typing',
      {
        user_id: this.userId,
        username: this.username
      }
    );
  }

  /**
   * Load message history from backend
   */
  async _loadHistory() {
    try {
      const response = await apiRequest(
        `/api/chat/rooms/${this.roomCode}/messages?limit=${MAX_MESSAGES}`
      );

      if (response.messages) {
        // Messages come in reverse chronological order, reverse them
        this.messages = response.messages.reverse();
        console.log('[chat] Loaded', this.messages.length, 'messages from history');
      }
    } catch (error) {
      console.error('[chat] Failed to load message history:', error);
    }
  }

  /**
   * Load current participants from backend
   */
  async _loadParticipants() {
    try {
      const response = await apiRequest(
        `/api/chat/rooms/${this.roomCode}/participants`
      );

      if (response.participants) {
        response.participants.forEach(p => {
          this.participants.set(p.user_id, {
            username: p.username,
            joined_at: p.joined_at,
            last_active: p.last_active
          });
        });
        this.participantCount = this.participants.size;
        console.log('[chat] Loaded', this.participantCount, 'participants');
      }
    } catch (error) {
      console.error('[chat] Failed to load participants:', error);
    }
  }

  /**
   * Handle incoming broadcast events
   */
  _handleBroadcast(payload) {
    const { event, payload: data } = payload;

    switch (event) {
      case 'msg':
        this._handleMessage(data);
        break;

      case 'typing':
        this._handleTyping(data);
        break;

      default:
        console.log('[chat] Unknown broadcast event:', event);
    }
  }

  /**
   * Handle incoming messages
   */
  _handleMessage(data) {
    // Ignore our own messages (we already added them locally)
    if (data.local) return;

    // Add to message store
    this._addMessage(data);

    // Notify callback
    if (this.onMessage) {
      this.onMessage(data);
    }
  }

  /**
   * Handle typing indicators
   */
  _handleTyping(data) {
    if (data.user_id === this.userId) return;

    this.typingUsers.add(data.username);

    // Clear existing timeout
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }

    // Remove typing indicator after 3 seconds
    this.typingTimeout = setTimeout(() => {
      this.typingUsers.clear();
      if (this.onTyping) {
        this.onTyping(Array.from(this.typingUsers));
      }
    }, 3000);

    if (this.onTyping) {
      this.onTyping(Array.from(this.typingUsers));
    }
  }

  /**
   * Handle presence events
   */
  _handlePresence(payload) {
    const { event, key: userId, newPresences, currentPresences } = payload;

    switch (event) {
      case 'JOIN':
        newPresences.forEach(presence => {
          const data = presence[userId];
          if (data && data.username) {
            this.participants.set(userId, {
              username: data.username,
              joined_at: new Date().toISOString(),
              last_active: new Date().toISOString()
            });
            this.participantCount = this.participants.size;

            console.log('[chat] Participant joined:', data.username);
            if (this.onParticipantJoin) {
              this.onParticipantJoin(data);
            }
          }
        });
        break;

      case 'LEAVE':
        const left = this.participants.get(userId);
        this.participants.delete(userId);
        this.participantCount = this.participants.size;

        if (left) {
          console.log('[chat] Participant left:', left.username);
          if (this.onParticipantLeave) {
            this.onParticipantLeave(left);
          }
        }
        break;

      default:
        console.log('[chat] Unknown presence event:', event);
    }
  }

  /**
   * Handle errors
   */
  _handleError(error) {
    console.error('[chat] Error:', error);
    if (this.onError) {
      this.onError(error);
    }
  }

  /**
   * Add message to store (enforces MAX_MESSAGES limit)
   */
  _addMessage(message) {
    this.messages.push({
      id: message.id || Date.now(),
      user_id: message.user_id,
      username: message.username,
      message: message.message,
      message_type: message.message_type || 'text',
      created_at: message.created_at || message.timestamp
    });

    // Enforce message limit
    if (this.messages.length > MAX_MESSAGES) {
      const removed = this.messages.splice(0, this.messages.length - MAX_MESSAGES);
      console.log('[chat] Removed', removed.length, 'old messages (limit:', MAX_MESSAGES + ')');
    }
  }

  /**
   * Notify that we're connected
   */
  _notifyConnected() {
    // You can add a specific callback for this if needed
    console.log('[chat] Connected and ready');
  }

  /**
   * Get all messages
   */
  getMessages() {
    return this.messages;
  }

  /**
   * Get current participants
   */
  getParticipants() {
    return Array.from(this.participants.values());
  }

  /**
   * Check if room is full
   */
  isFull() {
    return this.participantCount >= this.maxParticipants;
  }
}

// Global room info cache (will be set when creating/joining rooms)
let roomInfo = null;

/**
 * Create a new chat room
 */
export async function createChatRoom(name, contextType = null, contextId = null) {
  try {
    const username = supabase.getGuestName();
    const response = await apiRequest('/api/chat/rooms', {
      method: 'POST',
      body: JSON.stringify({
        name,
        context_type: contextType,
        context_id: contextId,
        username
      })
    });

    roomInfo = response;
    return response;
  } catch (error) {
    console.error('[chat] Failed to create room:', error);
    throw error;
  }
}

/**
 * Join an existing chat room
 */
export async function joinChatRoom(roomCode) {
  try {
    const username = supabase.getGuestName();
    const response = await apiRequest(`/api/chat/rooms/${roomCode}/join`, {
      method: 'POST',
      body: JSON.stringify({ username })
    });

    roomInfo = response;
    return response;
  } catch (error) {
    console.error('[chat] Failed to join room:', error);
    throw error;
  }
}

/**
 * Get chat room info
 */
export async function getChatRoomInfo(roomCode) {
  try {
    const response = await apiRequest(`/api/chat/rooms/${roomCode}`);
    return response;
  } catch (error) {
    console.error('[chat] Failed to get room info:', error);
    throw error;
  }
}

/**
 * Create a ChatClient instance for the current room
 */
export function createChatClient() {
  if (!roomInfo) {
    throw new Error('No room info available. Create or join a room first.');
  }

  const userInfo = {
    user_id: roomInfo.user_id,
    username: supabase.getGuestName()
  };

  return new ChatClient(roomInfo, userInfo);
}

/**
 * Update guest username
 */
export function updateUsername(newName) {
  supabase.setGuestName(newName);
}

export default ChatClient;
