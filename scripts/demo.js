const port = Number(process.env.PORT || 3000);
const base = `http://localhost:${port}`;
const speed = Math.max(0.1, Number(process.env.DEMO_SPEED || 1));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ownedServer = null;

async function getState() {
  const response = await fetch(`${base}/state`);
  if (!response.ok) throw new Error(`Server status endpoint returned ${response.status}`);
  return response.json();
}
async function ensureServer() {
  try { const current = await getState(); if (!current.simulated) throw new Error('The server on this port is not in simulation mode'); return; }
  catch (error) {
    if (error.message.includes('not in simulation')) throw error;
    process.env.SIM = '1';
    const { server, start } = require('../src/server'); ownedServer = server;
    try { await start({ quiet: true }); } catch (startError) { throw new Error(`Could not start simulation server on port ${port}: ${startError.message}`); }
    await getState();
  }
}
async function post(route, data) {
  const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error(`${route} returned ${response.status}`);
}
async function chat(user, text) { await post('/chat', { user, text }); }
async function host(action) { await post('/host', { action }); }
async function spread(commands, durationMs = 30000) {
  const gap = durationMs / Math.max(1, commands.length);
  for (let index = 0; index < commands.length; index++) {
    const [user, text] = commands[index]; await chat(user, text);
    if (index < commands.length - 1) await sleep(gap);
  }
}
async function playDemo({ demoBase = base, demoSpeed = speed, onLog = console.log } = {}) {
    const targetBase = demoBase.replace(/\/$/, '');
    const request = async (route, data) => {
      const response = await fetch(`${targetBase}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
      if (!response.ok) throw new Error(`${route} returned ${response.status}`);
    };
    const sendChat = (user, text) => request('/chat', { user, text });
    const sendHost = action => request('/host', { action });
    const pace = Math.max(0.1, Number(demoSpeed) || 1);
    const viewers = Array.from({ length: 12 }, (_, i) => `detective${String(i + 1).padStart(2, '0')}`);
    const voteWindow = 30000 / pace;
    const rounds = [
      { location: 3, suspect: 'C', calls: [['!contradict E1', 0], ['!c E1', 1], ['!contradict E3', 2]] },
      { location: 1, suspect: 'D', calls: [['!contradict E2', 3], ['!contradict E1', 4]] },
      { location: 2, suspect: 'A', calls: [] }
    ];
    for (let r = 0; r < rounds.length; r++) {
      const round = rounds[r]; onLog(`Demo round ${r + 1}: search, question, objection`);
      const phase = (await (await fetch(`${targetBase}/state`)).json()).phase;
      if (phase === 'search') {
        await spreadTo(targetBase, sendChat, viewers.map(user => [user, `!search ${round.location}`]), voteWindow);
        await sendHost('next');
      } else if (phase !== 'question') {
        throw new Error(`Expected a search or question phase, got ${phase}`);
      }
      await spreadTo(targetBase, sendChat, viewers.map(user => [user, `!ask ${round.suspect}`]), voteWindow);
      await sendHost('next');
      if (round.calls.length) await spreadTo(targetBase, sendChat, round.calls.map(([text, index]) => [viewers[index], text]), Math.min(voteWindow, 3000 / pace));
      await sendHost('next');
    }
    onLog('Final accusation: 10 vote C, 2 vote D');
    await spreadTo(targetBase, sendChat, viewers.map((user, i) => [user, `!accuse ${i < 10 ? 'C' : 'D'}`]), voteWindow);
    await sendHost('next');
    const final = await (await fetch(`${targetBase}/state`)).json();
    if (!final.revealed) throw new Error(`Demo stopped before reveal (phase: ${final.phase})`);
    onLog(`Demo complete: revealed ${final.solution.suspect} · ${final.accusationResult.percent}% correct.`);
    return final;
}

async function spreadTo(targetBase, send, commands, durationMs) {
  const gap = durationMs / Math.max(1, commands.length);
  for (let index = 0; index < commands.length; index++) {
    const [user, text] = commands[index]; await send(user, text);
    if (index < commands.length - 1) await sleep(gap);
  }
}

async function run() {
  try {
    await ensureServer();
    console.log(`OBS overlay: ${base}/overlay`);
    console.log(`Host control: ${base}/control`);
    await sleep(5000);
    const reset = await fetch(`${base}/host`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reset' }) });
    if (!reset.ok) throw new Error(`/host returned ${reset.status}`);
    const next = await fetch(`${base}/host`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'next' }) });
    if (!next.ok) throw new Error(`/host returned ${next.status}`);
    await playDemo();
  } finally {
    if (ownedServer) await require('../src/server').stop();
  }
}
if (require.main === module) run().catch(error => { console.error(`Demo failed: ${error.message}`); process.exitCode = 1; });
module.exports = { playDemo };
