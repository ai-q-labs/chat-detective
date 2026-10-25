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
async function run() {
  try {
    await ensureServer();
    console.log(`OBS overlay: ${base}/overlay`);
    console.log(`Host control: ${base}/control`);
    await sleep(5000);
    await host('reset'); await host('next');
    const viewers = Array.from({ length: 12 }, (_, i) => `detective${String(i + 1).padStart(2, '0')}`);
    const voteWindow = 30000 / speed;
    const rounds = [
      { location: 3, suspect: 'C', calls: [['!contradict E1', 0], ['!c E1', 1], ['!contradict E3', 2]] },
      { location: 1, suspect: 'D', calls: [['!contradict E2', 3], ['!contradict E1', 4]] },
      { location: 2, suspect: 'A', calls: [] }
    ];
    for (let r = 0; r < rounds.length; r++) {
      const round = rounds[r]; console.log(`Demo round ${r + 1}: search, question, objection`);
      const phase = (await getState()).phase;
      if (phase === 'search') {
        await spread(viewers.map(user => [user, `!search ${round.location}`]), voteWindow);
        await host('next');
      } else if (phase !== 'question') {
        throw new Error(`Expected a search or question phase, got ${phase}`);
      }
      await spread(viewers.map(user => [user, `!ask ${round.suspect}`]), voteWindow);
      await host('next');
      if (round.calls.length) await spread(round.calls.map(([text, index]) => [viewers[index], text]), Math.min(voteWindow, 3000 / speed));
      await host('next');
    }
    console.log('Final accusation: 10 vote C, 2 vote D');
    await spread(viewers.map((user, i) => [user, `!accuse ${i < 10 ? 'C' : 'D'}`]), voteWindow);
    await host('next');
    const final = await getState();
    if (!final.revealed) throw new Error(`Demo stopped before reveal (phase: ${final.phase})`);
    console.log(`Demo complete: revealed ${final.solution.suspect} · ${final.accusationResult.percent}% correct.`);
  } finally {
    if (ownedServer) await require('../src/server').stop();
  }
}
run().catch(error => { console.error(`Demo failed: ${error.message}`); process.exitCode = 1; });
