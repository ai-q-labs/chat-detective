const fs = require('node:fs/promises');
const path = require('node:path');
const TOKEN_FILE = path.join(__dirname, '..', '.twitch-token.json');
const SCOPES = 'user:read:chat user:write:chat';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function loadStoredTokens(tokenFile = TOKEN_FILE) {
  try { return JSON.parse(await fs.readFile(tokenFile, 'utf8')); }
  catch { throw new Error(`No readable Twitch token at ${tokenFile}. Run npm start to authorize first.`); }
}

async function auth(clientId, onCode = () => {}, fetchImpl = fetch, options = {}) {
  const tokenFile = options.tokenFile || TOKEN_FILE;
  const sleep = options.sleep || wait;
  let tokens;
  try { tokens = JSON.parse(await fs.readFile(tokenFile, 'utf8')); } catch {}
  if (tokens?.refresh_token) {
    const refreshed = await fetchImpl('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: tokens.refresh_token }) });
    if (refreshed.ok) { tokens = await refreshed.json(); await fs.writeFile(tokenFile, JSON.stringify(tokens, null, 2)); return tokens; }
  }
  const response = await fetchImpl('https://id.twitch.tv/oauth2/device', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, scopes: SCOPES }) });
  if (!response.ok) throw new Error(`Twitch device auth failed (${response.status})`);
  const device = await response.json(); onCode(`Authorize Chat Detective at ${device.verification_uri} with code ${device.user_code}`);
  const interval = Math.max(1, device.interval || 5) * 1000; const expires = Date.now() + device.expires_in * 1000;
  while (Date.now() < expires) {
    await sleep(interval);
    const poll = await fetchImpl('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, device_code: device.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    if (poll.ok) { tokens = await poll.json(); await fs.writeFile(tokenFile, JSON.stringify(tokens, null, 2)); return tokens; }
    const error = await poll.json();
    if (error.message === 'slow_down') await sleep(interval);
    else if (error.message !== 'authorization_pending') throw new Error(`Twitch device auth failed: ${error.message}`);
  }
  throw new Error('Twitch device code expired');
}

async function readBody(response) {
  if (typeof response.text === 'function') return response.text();
  if (typeof response.json === 'function') return JSON.stringify(await response.json());
  return '';
}

async function createTwitch(clientId, channel, onChat, onStatus = () => {}, options = {}) {
  if (!clientId || !channel) throw new Error('Set TWITCH_CLIENT_ID and TWITCH_CHANNEL');
  const fetchImpl = options.fetch || fetch;
  let tokens = options.tokens || await auth(clientId, onStatus, fetchImpl, options.authOptions);
  const persist = async () => {
    if (options.tokenFile) await fs.writeFile(options.tokenFile, JSON.stringify(tokens, null, 2));
    else if (!options.tokens) await fs.writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  };
  async function refresh() {
    if (!tokens.refresh_token) throw new Error('Twitch access token expired and no refresh token is available');
    const response = await fetchImpl('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: tokens.refresh_token }) });
    if (!response.ok) throw new Error(`Twitch token refresh failed (${response.status})`);
    tokens = await response.json(); await persist();
  }
  async function api(url, request = {}) {
    const requestOnce = () => fetchImpl(url, { ...request, headers: { ...request.headers, authorization: `Bearer ${tokens.access_token}`, 'Client-Id': clientId } });
    let response = await requestOnce();
    if (response.status === 401) { await refresh(); response = await requestOnce(); }
    return response;
  }
  async function validate() {
    const request = () => fetchImpl('https://id.twitch.tv/oauth2/validate', { headers: { authorization: `OAuth ${tokens.access_token}` } });
    let response = await request();
    if (response.status === 401) { await refresh(); response = await request(); }
    if (!response.ok) throw new Error(`Twitch token validation failed (${response.status}); reauthorize with this Client ID.`);
    const identity = await response.json();
    if (identity.client_id !== clientId) throw new Error('Twitch token belongs to a different Client ID. Set TWITCH_CLIENT_ID to the app that issued the token, or remove .twitch-token.json and authorize again.');
    if (!identity.user_id || !identity.login) throw new Error('Twitch EventSub chat requires a user access token. Reauthorize with the public client device-code flow.');
    const scopes = identity.scopes || [];
    onStatus(`Twitch token valid: ${identity.login} (user ${identity.user_id}); scopes: ${scopes.join(', ') || 'none'}; expires in ${identity.expires_in}s`);
    const missingScopes = ['user:read:chat', 'user:write:chat'].filter(scope => !scopes.includes(scope));
    if (missingScopes.length) throw new Error(`Twitch token is missing ${missingScopes.join(', ')}. Remove .twitch-token.json and authorize again to grant the required chat scopes.`);
    return identity;
  }

  const identity = await validate();
  const meResponse = await api('https://api.twitch.tv/helix/users');
  if (!meResponse.ok) throw new Error(`Twitch account lookup failed (${meResponse.status})`);
  const me = (await meResponse.json()).data[0];
  if (!me || me.id !== identity.user_id) throw new Error('Twitch token user did not match GET /helix/users. Reauthorize and verify the selected account.');
  onStatus(`Helix account lookup OK: ${me.login} (${me.id})`);
  const channelResponse = await api(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(channel)}`);
  if (!channelResponse.ok) throw new Error(`Twitch channel lookup failed (${channelResponse.status})`);
  const broadcaster = (await channelResponse.json()).data[0];
  if (!broadcaster) throw new Error(`Twitch channel not found: ${channel}`);
  onStatus(`Broadcaster lookup OK: ${broadcaster.login} (${broadcaster.id})`);

  const sentMessageIds = new Set();
  async function sendChat(text) {
    const response = await api('https://api.twitch.tv/helix/chat/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ broadcaster_id: broadcaster.id, sender_id: me.id, message: String(text).slice(0, 500) }) });
    if (response.ok) {
      try {
        const body = await response.json();
        for (const item of body.data || []) if (item.message_id) sentMessageIds.add(item.message_id);
      } catch {}
    }
    return response;
  }

  const WebSocketImpl = options.WebSocket || globalThis.WebSocket;
  let activeSocket; let retryTimer; let retryDelay = 1000; let stopped = false; let lastMessageAt = Date.now(); let watchdog; let keepaliveTimeoutSeconds = 10; let subscriptionFailed = false;
  const socketSet = new Set(); const intentional = new WeakSet();
  function safeText(value) {
    let text = String(value || '').replace(/[\r\n]+/g, ' ').trim();
    for (const secret of [tokens.access_token, tokens.refresh_token].filter(Boolean)) text = text.split(secret).join('[redacted]');
    return text;
  }
  function scheduleReconnect() {
    if (stopped || subscriptionFailed || retryTimer) return;
    const delay = retryDelay; retryDelay = Math.min(30000, retryDelay * 2);
    retryTimer = setTimeout(() => { retryTimer = null; connect('wss://eventsub.wss.twitch.tv/ws', false); }, delay);
  }
  function startWatchdog(socket, seconds) {
    clearInterval(watchdog); keepaliveTimeoutSeconds = Number(seconds) > 0 ? Number(seconds) : 10; lastMessageAt = Date.now();
    watchdog = setInterval(() => {
      const idleMs = Date.now() - lastMessageAt; const limitMs = (keepaliveTimeoutSeconds + 5) * 1000;
      if (activeSocket === socket && idleMs > limitMs) {
        onStatus(`EventSub keepalive timeout: no message for ${Math.floor(idleMs / 1000)}s (limit ${keepaliveTimeoutSeconds + 5}s); closing socket.`);
        clearInterval(watchdog); watchdog = null;
        try { socket.close(); } catch {}
      }
    }, 1000);
  }
  function subscriptionHelp(status) {
    if (status === 401) return 'Check the user access token and that TWITCH_CLIENT_ID matches its validated client_id.';
    if (status === 403) return 'Check that the token has user:read:chat and that the token user can read this broadcaster’s chat.';
    if (status === 409) return 'A matching EventSub subscription may already exist; inspect Twitch EventSub subscriptions for this app and user.';
    return 'Check the response body, token scope, broadcaster/user IDs, and matching Client-Id.';
  }
  function connect(url = 'wss://eventsub.wss.twitch.tv/ws', isSessionReconnect = false) {
    if (stopped || subscriptionFailed || !WebSocketImpl) return;
    const socket = new WebSocketImpl(url); socketSet.add(socket);
    socket.addEventListener('message', async event => {
      if (activeSocket === socket) lastMessageAt = Date.now();
      let message; try { message = JSON.parse(event.data); } catch { return; }
      const type = message.metadata?.message_type; const payload = message.payload || {};
      if (type === 'session_welcome') {
        const previousSocket = activeSocket;
        activeSocket = socket; retryDelay = 1000;
        startWatchdog(socket, payload.session?.keepalive_timeout_seconds);
        if (isSessionReconnect) {
          if (previousSocket && previousSocket !== socket) { intentional.add(previousSocket); previousSocket.close(); socketSet.delete(previousSocket); }
          onStatus('EventSub session resumed; existing subscription transferred.');
          return;
        }
        const sessionId = payload.session?.id;
        if (!sessionId) { onStatus('EventSub welcome did not include a session ID; reconnecting.'); socket.close(); return; }
        const result = await api('https://api.twitch.tv/helix/eventsub/subscriptions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: broadcaster.id, user_id: identity.user_id }, transport: { method: 'websocket', session_id: sessionId } }) });
        const body = safeText(await readBody(result));
        onStatus(`EventSub subscription response: HTTP ${result.status}${body ? ` · ${body}` : ''}`);
        if (!result.ok) {
          subscriptionFailed = true; intentional.add(socket);
          onStatus(`EventSub subscription refused (HTTP ${result.status}). ${subscriptionHelp(result.status)}${body ? ` Response: ${body}` : ''}`);
          socket.close(); return;
        }
        onStatus('Connected to Twitch chat; channel.chat.message subscription is enabled.');
      } else if (type === 'session_keepalive') {
        lastMessageAt = Date.now();
      } else if (type === 'session_reconnect') {
        lastMessageAt = Date.now();
        if (payload.session?.reconnect_url) connect(payload.session.reconnect_url, true);
      } else if (type === 'notification' && payload.subscription?.type === 'channel.chat.message') {
        lastMessageAt = Date.now();
        const eventData = payload.event; const badges = eventData.badges || [];
        const messageId = eventData.message_id;
        if (messageId && sentMessageIds.delete(messageId)) return;
        onChat({ user: eventData.chatter_user_login, text: eventData.message.text, isHost: eventData.chatter_user_id === broadcaster.id || badges.some(badge => ['broadcaster', 'moderator'].includes(badge.set_id)) });
      } else if (type === 'revocation') {
        lastMessageAt = Date.now(); onStatus(`EventSub subscription revoked: ${safeText(payload.subscription?.status || 'unknown status')}`);
      } else {
        lastMessageAt = Date.now();
      }
    });
    socket.addEventListener('close', event => {
      socketSet.delete(socket);
      const reason = safeText(event?.reason || '');
      const code = event?.code ?? 'unknown';
      onStatus(`EventSub WebSocket closed: code=${code}, reason=${reason || '(empty)'}.${intentional.has(socket) ? ' Intentional close.' : ''}`);
      if (activeSocket === socket) { activeSocket = null; clearInterval(watchdog); watchdog = null; }
      if (!intentional.has(socket)) { onStatus('Twitch connection closed; reconnecting with backoff.'); scheduleReconnect(); }
    });
    return socket;
  }
  if (!WebSocketImpl) throw new Error('This Node.js version does not provide WebSocket. Use Node.js 22 or later.');
  onStatus('Opening Twitch EventSub WebSocket…');
  connect();
  const validationTimer = setInterval(() => {
    validate().catch(error => {
      onStatus(`Twitch token validation failed; stopping EventSub: ${error.message}`);
      stopped = true; clearTimeout(retryTimer); clearInterval(watchdog); clearInterval(validationTimer);
      for (const socket of socketSet) { intentional.add(socket); socket.close(); }
      socketSet.clear();
    });
  }, 60 * 60 * 1000);
  validationTimer.unref?.();
  return { sendChat, close: () => { stopped = true; clearTimeout(retryTimer); clearInterval(watchdog); clearInterval(validationTimer); for (const socket of socketSet) { intentional.add(socket); socket.close(); } socketSet.clear(); }, broadcaster, me, identity };
}

module.exports = { auth, createTwitch, loadStoredTokens, SCOPES, TOKEN_FILE };
