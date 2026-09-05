/**
 * Supabase integration module for myspot chat rooms
 * Handles Supabase client initialization, guest identity, and channel management
 */

// Guest identity system - matches Cohere's anonymous guest ID pattern
const GUEST_ID_KEY = 'myspot_guest_id';
const GUEST_NAME_KEY = 'myspot_guest_name';

/**
 * Get or create a persistent guest ID
 * Stored in localStorage to persist across sessions
 */
export function getGuestId() {
  let guestId = localStorage.getItem(GUEST_ID_KEY);
  if (!guestId) {
    // Generate a new guest ID
    guestId = 'guest_' + Math.random().toString(36).substring(2, 15) +
              '_' + Date.now().toString(36);
    localStorage.setItem(GUEST_ID_KEY, guestId);
  }
  return guestId;
}

/**
 * Get or create a guest username
 * Users can customize their username, defaults to "Guest + random"
 */
export function getGuestName() {
  let guestName = localStorage.getItem(GUEST_NAME_KEY);
  if (!guestName) {
    const adjectives = ['Sage', 'Retro', 'Cassette', 'Vinyl', 'Wave', 'Synth', 'Beat', 'Radio', 'Tune', 'Jam'];
    const nouns = ['Fan', 'Lover', 'Maker', 'Builder', 'Master', 'Ninja', 'Wizard', 'Guru', 'Head', 'Bot'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    guestName = `${adj}${noun}${Math.floor(Math.random() * 1000)}`;
    localStorage.setItem(GUEST_NAME_KEY, guestName);
  }
  return guestName;
}

/**
 * Set a custom guest username
 */
export function setGuestName(name) {
  localStorage.setItem(GUEST_NAME_KEY, name);
}

/**
 * Supabase client cache
 */
let supabaseClient = null;
let supabaseConfig = null;

/**
 * Initialize Supabase client with configuration from backend
 * Call this after getting room info from the backend API
 */
export function initSupabase(config) {
  if (supabaseClient && supabaseConfig === config) {
    return supabaseClient; // Return existing client if config hasn't changed
  }

  if (!config || !config.url || !config.anon_key) {
    console.error('[supabase] Invalid config:', config);
    return null;
  }

  try {
    // Access the global supabase object from the CDN script
    const { createClient } = window.supabase;

    supabaseClient = createClient(
      config.url,
      config.anon_key,
      {
        realtime: {
          params: {
            eventsPerSecond: 10 // Higher for chat, lower for voice
          }
        }
      }
    );

    supabaseConfig = config;
    console.log('[supabase] Client initialized');
    return supabaseClient;
  } catch (error) {
    console.error('[supabase] Failed to initialize client:', error);
    return null;
  }
}

/**
 * Get the current Supabase client instance
 */
export function getSupabase() {
  return supabaseClient;
}

/**
 * Create a chat channel for real-time messaging
 * @param {string} roomCode - The room code for the channel name
 * @returns {Channel} Supabase channel for chat
 */
export function createChatChannel(roomCode) {
  const client = getSupabase();
  if (!client) {
    console.error('[supabase] Cannot create channel: client not initialized');
    return null;
  }

  const channelName = `chat:${roomCode}`;
  const channel = client.channel(channelName, {
    config: {
      presence: {
        key: getGuestId()
      }
    }
  });

  console.log('[supabase] Created chat channel:', channelName);
  return channel;
}

/**
 * Create a voice channel for WebRTC signaling
 * @param {string} roomCode - The room code for the channel name
 * @returns {Channel} Supabase channel for voice signaling
 */
export function createVoiceChannel(roomCode) {
  const client = getSupabase();
  if (!client) {
    console.error('[supabase] Cannot create voice channel: client not initialized');
    return null;
  }

  const channelName = `voice:${roomCode}`;
  const channel = client.channel(channelName);

  console.log('[supabase] Created voice channel:', channelName);
  return channel;
}

/**
 * Create a presence channel for tracking who's in the room
 * @param {string} roomCode - The room code for the channel name
 * @returns {Channel} Supabase channel for presence
 */
export function createPresenceChannel(roomCode) {
  const client = getSupabase();
  if (!client) {
    console.error('[supabase] Cannot create presence channel: client not initialized');
    return null;
  }

  const channelName = `room:${roomCode}`;
  const channel = client.channel(channelName, {
    config: {
      presence: {
        key: getGuestId()
      }
    }
  });

  console.log('[supabase] Created presence channel:', channelName);
  return channel;
}

/**
 * Subscribe to a channel
 * @param {Channel} channel - The channel to subscribe
 * @param {Function} onBroadcast - Callback for broadcast events
 * @param {Function} onPresence - Callback for presence events (optional)
 * @param {Function} onError - Callback for errors (optional)
 */
export function subscribeChannel(channel, onBroadcast, onPresence = null, onError = null) {
  if (!channel) {
    console.error('[supabase] Cannot subscribe: no channel');
    return;
  }

  // Listen for broadcast events
  channel
    .on('broadcast', { event: '*' }, (payload) => {
      console.log('[supabase] Broadcast received:', payload);
      if (onBroadcast) onBroadcast(payload);
    });

  // Listen for presence events (optional)
  if (onPresence) {
    channel
      .on('presence', { event: '*' }, (payload) => {
        console.log('[supabase] Presence event:', payload);
        onPresence(payload);
      });
  }

  // Handle errors
  if (onError) {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBE_ERROR' || status === 'CHANNEL_ERROR') {
        console.error('[supabase] Channel error:', status);
        onError(status);
      }
    });
  }

  // Subscribe to the channel
  channel.subscribe((status) => {
    console.log('[supabase] Channel subscription status:', status);
    if (status === 'SUBSCRIBED') {
      console.log('[supabase] Successfully subscribed to channel');
    }
  });
}

/**
 * Unsubscribe and clean up a channel
 * @param {Channel} channel - The channel to unsubscribe
 */
export function unsubscribeChannel(channel) {
  if (!channel) return;

  try {
    channel.unsubscribe();
    console.log('[supabase] Unsubscribed from channel');
  } catch (error) {
    console.error('[supabase] Error unsubscribing:', error);
  }
}

/**
 * Broadcast a message on a channel
 * @param {Channel} channel - The channel to broadcast on
 * @param {string} event - The event name (e.g., 'msg', 'voice:join')
 * @param {object} payload - The payload to send
 */
export function broadcastMessage(channel, event, payload) {
  if (!channel) {
    console.error('[supabase] Cannot broadcast: no channel');
    return false;
  }

  try {
    channel.send({
      type: 'broadcast',
      event: event,
      payload: payload
    });
    console.log('[supabase] Broadcast sent:', event, payload);
    return true;
  } catch (error) {
    console.error('[supabase] Broadcast error:', error);
    return false;
  }
}

/**
 * Track presence in a channel
 * @param {Channel} channel - The channel to track presence in
 * @param {object} state - The presence state to share
 */
export function trackPresence(channel, state = {}) {
  if (!channel) {
    console.error('[supabase] Cannot track presence: no channel');
    return;
  }

  try {
    channel.track({
      user_id: getGuestId(),
      username: getGuestName(),
      online_at: new Date().toISOString(),
      ...state
    });
    console.log('[supabase] Tracking presence:', state);
  } catch (error) {
    console.error('[supabase] Presence tracking error:', error);
  }
}

/**
 * Get current presence state for a channel
 * @param {Channel} channel - The channel to get presence from
 * @returns {object} Presence state with online users
 */
export function getPresenceState(channel) {
  if (!channel) {
    console.error('[supabase] Cannot get presence: no channel');
    return null;
  }

  try {
    const state = channel.presenceState();
    console.log('[supabase] Current presence state:', state);
    return state;
  } catch (error) {
    console.error('[supabase] Error getting presence state:', error);
    return null;
  }
}

/**
 * Reset the Supabase client (useful for testing or reconnection)
 */
export function resetSupabase() {
  if (supabaseClient) {
    try {
      supabaseClient.removeAllChannels();
      console.log('[supabase] Removed all channels');
    } catch (error) {
      console.error('[supabase] Error removing channels:', error);
    }
  }
  supabaseClient = null;
  supabaseConfig = null;
}

// Export default object
export default {
  getGuestId,
  getGuestName,
  setGuestName,
  initSupabase,
  getSupabase,
  createChatChannel,
  createVoiceChannel,
  createPresenceChannel,
  subscribeChannel,
  unsubscribeChannel,
  broadcastMessage,
  trackPresence,
  getPresenceState,
  resetSupabase
};
