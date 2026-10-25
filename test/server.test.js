const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');

process.env.SIM = '1';
const app = require('../src/server');

test('event stream remains connected, carries current state and bot/viewer chat, and accepts host actions', async t => {
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, resolve); });
  const { port } = app.server.address();
  let reader;
  t.after(async () => {
    await reader?.cancel().catch(() => {});
    app.server.closeAllConnections?.();
    await new Promise(resolve => app.server.close(resolve));
  });
  const response = await fetch(`http://127.0.0.1:${port}/events`);
  assert.equal(response.status, 200);
  const controlPage = await (await fetch(`http://127.0.0.1:${port}/control`)).text();
  const controlScript = controlPage.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(controlScript));
  assert.match(controlScript, /setInterval\(refresh,1000\)/);
  reader = response.body.getReader();
  const readState = async () => {
    const { value } = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for SSE state')), 1000))
    ]);
    const message = new TextDecoder().decode(value).split('\n').find(line => line.startsWith('data: '));
    return JSON.parse(message.slice(6));
  };
  assert.equal((await readState()).phase, 'intro');

  app.dispatch({ type: 'host', action: 'next' });
  const advanced = await readState();
  assert.equal(advanced.phase, 'search');
  assert.ok(advanced.chatLines.some(line => line.source === 'bot' && line.text.includes('board-game café')));

  app.dispatch({ type: 'chat', user: 'viewer', text: '!search 1' });
  const voted = await readState();
  assert.equal(voted.votes.search[1], 1);
  assert.ok(voted.chatLines.some(line => line.user === 'viewer' && line.text === '!search 1'));

  const reset = await fetch(`http://127.0.0.1:${port}/host`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reset' }) });
  assert.equal(reset.status, 204);
  const resetState = await (await fetch(`http://127.0.0.1:${port}/state`)).json();
  assert.equal(resetState.phase, 'intro');
  assert.deepEqual(resetState.chatLines, []);
});

test('POST /demo/start launches the scripted crowd on a simulation server', async t => {
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, resolve); });
  const port = app.server.address().port;
  t.after(async () => { app.server.closeAllConnections?.(); await new Promise(resolve => app.server.close(resolve)); });
  app.dispatch({ type: 'chat', user: 'old-viewer', text: 'Case closed from previous take' });
  const started = await fetch(`http://127.0.0.1:${port}/demo/start`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' }, body: JSON.stringify({ speed: 50 }) });
  assert.equal(started.status, 202);
  assert.equal(started.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  assert.deepEqual(await started.json(), { started: true, speed: 50 });
  const cleanState = await (await fetch(`http://127.0.0.1:${port}/state`)).json();
  assert.equal(cleanState.chatLines.some(line => line.text.includes('Case closed from previous take')), false);
  const until = Date.now() + 10000;
  let state;
  do { await new Promise(resolve => setTimeout(resolve, 100)); state = await (await fetch(`http://127.0.0.1:${port}/state`)).json(); } while (!state.revealed && Date.now() < until);
  assert.equal(state.revealed, true);
});

test('POST /demo/start is refused by a Twitch-mode server', async t => {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['src/server.js'], { cwd: process.cwd(), env: { ...process.env, SIM: '0', PORT: String(port), TWITCH_CLIENT_ID: '', TWITCH_CHANNEL: '' }, stdio: 'ignore' });
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    try { ready = (await fetch(`${base}/state`)).ok; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.equal(ready, true);
  const response = await fetch(`${base}/demo/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ speed: 8 }) });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /only in sim mode/);
});
