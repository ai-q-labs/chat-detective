const test = require('node:test');
const assert = require('node:assert/strict');

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
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/state`)).json()).phase, 'intro');
});
