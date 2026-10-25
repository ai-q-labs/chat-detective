const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { auth, createTwitch } = require('../src/twitch');

const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });
const tokenIdentity = (clientId, userId = 'bot-id', login = 'detectivebot') => ({ client_id: clientId, user_id: userId, login, scopes: ['user:read:chat', 'user:write:chat'], expires_in: 3600 });

test('device-code flow displays the code, polls, and stores tokens', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-detective-auth-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const tokenFile = path.join(dir, 'token.json'); const requests = []; const shown = [];
  const fetchMock = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/device')) return response(200, { device_code: 'device-secret', user_code: 'ABCD-EFGH', verification_uri: 'https://twitch.tv/activate', interval: 1, expires_in: 300 });
    return response(200, { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
  };
  const tokens = await auth('client-id', message => shown.push(message), fetchMock, { tokenFile, sleep: async () => {} });
  assert.equal(tokens.access_token, 'access'); assert.match(shown[0], /ABCD-EFGH/);
  assert.equal(requests.length, 2); assert.match(requests[1].options.body.get('grant_type'), /device_code/);
  assert.equal(JSON.parse(await fs.readFile(tokenFile, 'utf8')).refresh_token, 'refresh');
});

test('Helix API retries once after 401 using a rotated refresh token', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-detective-refresh-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const tokenFile = path.join(dir, 'token.json'); const calls = []; let sendCount = 0;
  const fetchMock = async (url, options = {}) => {
    calls.push({ url, authorization: options.headers?.authorization });
    if (url.endsWith('/oauth2/validate')) return response(200, tokenIdentity('client-id'));
    if (url === 'https://api.twitch.tv/helix/users') return response(200, { data: [{ id: 'bot-id' }] });
    if (url.includes('/helix/users?login=')) return response(200, { data: [{ id: 'channel-id' }] });
    if (url.endsWith('/oauth2/token')) return response(200, { access_token: 'new-access', refresh_token: 'new-refresh' });
    if (url.endsWith('/helix/chat/messages')) { sendCount++; return sendCount === 1 ? response(401, {}) : response(200, { data: [{ is_sent: true }] }); }
    throw new Error(`Unexpected mock request ${url}`);
  };
  const sockets = [];
  class FakeSocket { constructor(url) { this.url = url; this.listeners = {}; sockets.push(this); } addEventListener(name, fn) { this.listeners[name] = fn; } close() { this.listeners.close?.(); } }
  const twitch = await createTwitch('client-id', 'detective', () => {}, () => {}, { fetch: fetchMock, tokens: { access_token: 'old-access', refresh_token: 'old-refresh' }, tokenFile, WebSocket: FakeSocket });
  const sent = await twitch.sendChat('hello');
  assert.equal(sent.status, 200); assert.equal(sendCount, 2);
  const messageCalls = calls.filter(c => c.url.endsWith('/helix/chat/messages'));
  assert.deepEqual(messageCalls.map(c => c.authorization), ['Bearer old-access', 'Bearer new-access']);
  assert.equal(JSON.parse(await fs.readFile(tokenFile, 'utf8')).refresh_token, 'new-refresh');
  twitch.close(); assert.equal(sockets.length, 1);
});

test('session_reconnect transfers to the supplied socket without resubscribing', async () => {
  let subscriptions = 0; const sockets = []; const statuses = []; let subscriptionRequest; const received = [];
  const fetchMock = async (url, options = {}) => {
    if (url.endsWith('/oauth2/validate')) return response(200, tokenIdentity('id', 'bot'));
    if (url.endsWith('/helix/users')) return response(200, { data: [{ id: 'bot' }] });
    if (url.includes('/helix/users?login=')) return response(200, { data: [{ id: 'broadcaster' }] });
    if (url.endsWith('/eventsub/subscriptions')) { subscriptions++; subscriptionRequest = options; return response(202, { data: [{ id: 'sub-id' }] }); }
    throw new Error(`Unexpected mock request ${url}`);
  };
  class FakeSocket { constructor(url) { this.url = url; this.listeners = {}; sockets.push(this); } addEventListener(n, f) { this.listeners[n] = f; } emit(type, payload) { return this.listeners.message({ data: JSON.stringify({ metadata: { message_type: type }, payload }) }); } close() { this.closed = true; this.listeners.close?.(); } }
  const twitch = await createTwitch('id', 'channel', event => received.push(event), status => statuses.push(status), { fetch: fetchMock, tokens: { access_token: 'token' }, WebSocket: FakeSocket });
  assert.ok(statuses.some(status => status.includes('detectivebot') && status.includes('user:read:chat') && status.includes('expires in 3600s')));
  await sockets[0].emit('session_welcome', { session: { id: 'first', keepalive_timeout_seconds: 60 } });
  const payload = JSON.parse(subscriptionRequest.body);
  assert.deepEqual(payload, { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: 'broadcaster', user_id: 'bot' }, transport: { method: 'websocket', session_id: 'first' } });
  assert.equal(subscriptionRequest.headers['Client-Id'], 'id');
  assert.ok(statuses.some(status => status.includes('EventSub subscription response: HTTP 202')));
  await sockets[0].emit('notification', { subscription: { type: 'channel.chat.message' }, event: { chatter_user_login: 'viewer', chatter_user_id: 'viewer-id', message: { text: '!search 1' }, badges: [] } });
  assert.deepEqual(received, [{ user: 'viewer', text: '!search 1', isHost: false }]);
  await sockets[0].emit('session_reconnect', { session: { reconnect_url: 'wss://new-session' } });
  assert.equal(sockets[1].url, 'wss://new-session');
  await sockets[1].emit('session_welcome', { session: { id: 'second', keepalive_timeout_seconds: 60 } });
  assert.equal(subscriptions, 1); assert.equal(sockets[0].closed, true);
  twitch.close();
});

test('startup rejects a valid token that lacks the chat-reading scope', async () => {
  const fetchMock = async url => url.endsWith('/oauth2/validate')
    ? response(200, { ...tokenIdentity('id'), scopes: ['user:write:chat'] })
    : response(500, {});
  await assert.rejects(createTwitch('id', 'channel', () => {}, () => {}, { fetch: fetchMock, tokens: { access_token: 'secret' }, WebSocket: class {} }), /missing user:read:chat/);
});

test('subscription rejection logs the HTTP response and a targeted fix without retrying the socket', async () => {
  const statuses = []; const sockets = [];
  const fetchMock = async url => {
    if (url.endsWith('/oauth2/validate')) return response(200, tokenIdentity('id', 'bot'));
    if (url.endsWith('/helix/users')) return response(200, { data: [{ id: 'bot' }] });
    if (url.includes('/helix/users?login=')) return response(200, { data: [{ id: 'broadcaster' }] });
    if (url.endsWith('/eventsub/subscriptions')) return response(403, { message: 'missing scope' });
    throw new Error(`Unexpected mock request ${url}`);
  };
  class FakeSocket { constructor(url) { this.url = url; this.listeners = {}; sockets.push(this); } addEventListener(name, fn) { this.listeners[name] = fn; } emit(type, payload) { return this.listeners.message({ data: JSON.stringify({ metadata: { message_type: type }, payload }) }); } close() { this.closed = true; this.listeners.close?.({ code: 1000, reason: 'client close' }); } }
  const twitch = await createTwitch('id', 'channel', () => {}, status => statuses.push(status), { fetch: fetchMock, tokens: { access_token: 'hidden-token' }, WebSocket: FakeSocket });
  await sockets[0].emit('session_welcome', { session: { id: 'session', keepalive_timeout_seconds: 20 } });
  assert.ok(statuses.some(status => status.includes('subscription response: HTTP 403') && status.includes('missing scope')));
  assert.ok(statuses.some(status => status.includes('subscription refused (HTTP 403)') && status.includes('user:read:chat')));
  assert.equal(sockets[0].closed, true); assert.equal(sockets.length, 1);
  twitch.close();
});

test('drops only EventSub echoes whose message IDs were returned by Send Chat Message', async () => {
  const received = []; const sockets = [];
  const fetchMock = async (url) => {
    if (url.endsWith('/oauth2/validate')) return response(200, tokenIdentity('id', 'bot'));
    if (url.endsWith('/helix/users')) return response(200, { data: [{ id: 'bot' }] });
    if (url.includes('/helix/users?login=')) return response(200, { data: [{ id: 'broadcaster' }] });
    if (url.endsWith('/eventsub/subscriptions')) return response(202, {});
    if (url.endsWith('/helix/chat/messages')) return response(200, { data: [{ message_id: 'bot-message-1', is_sent: true }] });
    throw new Error(`Unexpected mock request ${url}`);
  };
  class FakeSocket { constructor(url) { this.url = url; this.listeners = {}; sockets.push(this); } addEventListener(n, f) { this.listeners[n] = f; } emit(type, payload) { return this.listeners.message({ data: JSON.stringify({ metadata: { message_type: type }, payload }) }); } close() { this.closed = true; } }
  const twitch = await createTwitch('id', 'channel', event => received.push(event), () => {}, { fetch: fetchMock, tokens: { access_token: 'token' }, WebSocket: FakeSocket });
  await sockets[0].emit('session_welcome', { session: { id: 'session', keepalive_timeout_seconds: 60 } });
  await twitch.sendChat('hello');
  const notification = (id, userId, login, text) => sockets[0].emit('notification', { subscription: { type: 'channel.chat.message' }, event: { message_id: id, chatter_user_id: userId, chatter_user_login: login, message: { text }, badges: [] } });
  await notification('bot-message-1', 'bot', 'detectivebot', 'hello');
  await notification('broadcaster-own-message', 'broadcaster', 'channel', '!next');
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { user: 'channel', text: '!next', isHost: true });
  twitch.close();
});
