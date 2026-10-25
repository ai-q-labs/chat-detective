const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../cases/trophy-at-table-nine.json');
const { createGame, splitIntro } = require('../src/game');

function setup(caseData = data) {
  let clock = 1000;
  const game = createGame(caseData, { voteSeconds: 30, now: () => clock, simulated: true });
  const send = (user, text, isHost = false) => game.handle({ type: 'chat', user, text, isHost });
  const host = action => game.handle({ type: 'host', action });
  const state = () => game.state();
  const next = () => host('next');
  const find = id => send('voter', `!search ${id}`);
  const ask = id => { for (const user of ['a', 'b', 'c']) send(user, `!ask ${id}`); next(); };
  return { game, send, host, next, state, find, ask, advance: ms => { clock += ms; game.handle({ type: 'tick', now: clock }); } };
}

test('search vote finds evidence and advances to question', () => {
  const g = setup(); g.next(); g.find(1); g.advance(30000);
  assert.equal(g.state().phase, 'question'); assert.equal(g.state().evidence[0].id, 'E1');
});

test('intro stays open until the host advances and reset returns to intro', () => {
  const g = setup();
  assert.equal(g.state().phase, 'intro');
  g.send('viewer', '!search 1');
  assert.equal(g.state().phase, 'intro');
  g.next(); assert.equal(g.state().phase, 'search');
  g.host('reset'); assert.equal(g.state().phase, 'intro');
});

test('question ballot opens with the configured timer and advances when it expires', () => {
  const g = setup(); g.next(); g.find(1); g.next();
  assert.equal(g.state().phase, 'question'); assert.equal(g.state().timerDuration, 30); assert.notEqual(g.state().deadline, null);
  g.advance(30000); assert.equal(g.state().phase, 'objection');
});

test('host can pause a ballot timer, keep the vote open, and resume its remaining time', () => {
  const g = setup(); g.next();
  g.host('pause-timer');
  assert.equal(g.state().timerPaused, true);
  assert.equal(g.state().remainingSeconds, 30);
  g.advance(60000);
  assert.equal(g.state().phase, 'search');
  g.send('viewer', '!search 2');
  assert.equal(g.state().votes.search[2], 1);
  g.host('resume-timer');
  assert.equal(g.state().timerPaused, false);
  g.advance(30000);
  assert.equal(g.state().phase, 'question');
});

test('testimony card exists only during objection, while the caught lie remains on the board', () => {
  const g = setup(); g.next(); g.find(3); g.next(); g.send('voter', '!ask C'); g.next();
  assert.equal(g.state().phase, 'objection'); assert.equal(g.state().testimonyCard.suspect, 'C');
  g.send('sharp', '!contradict E3'); g.next();
  assert.equal(g.state().phase, 'search'); assert.equal(g.state().testimonyCard, null);
  assert.deepEqual(g.state().suspects.C.lie, { suspect: 'C', evidenceId: 'E3', truth: data.testimonies.C.truth, user: 'sharp' });
  assert.deepEqual(g.state().lieStats, { caught: 1, total: 2 });
});

test('the last unsearched location is opened automatically before the question ballot', () => {
  const g = setup(); g.next();
  for (const id of [1, 2]) {
    g.send(`search${id}`, `!search ${id}`); g.next(); g.send(`ask${id}`, '!ask A'); g.next();
    if (id === 1) g.next();
  }
  const effects = g.next();
  assert.equal(g.state().phase, 'question'); assert.equal(g.state().currentBallot, 'ask');
  assert.equal(g.state().searched.length, 3); assert.equal(g.state().evidence[2].id, 'E3');
  assert.ok(effects.some(effect => effect.say?.startsWith('Last place to search: Delivery bag.')));
});

test('intro messages split at the sentence boundary closest to the middle', () => {
  const parts = splitIntro('Short opening. A longer second sentence lands near the middle. The final sentence closes the scene.');
  assert.equal(parts.length, 2); assert.equal(parts[0], 'Short opening. A longer second sentence lands near the middle.');
  assert.equal(parts[1], 'The final sentence closes the scene.');
  assert.ok(parts.every(part => !/[A-Za-z]$/.test(part) || part.endsWith('.')));
});

test('long intros produce messages no longer than 500 characters', () => {
  const sentence = `A complete sentence with a clear ending. ${'Clue detail '.repeat(38)}.`;
  const parts = splitIntro(sentence, 500);
  assert.ok(parts.length > 1); assert.ok(parts.every(part => part.length <= 500));
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), sentence.replace(/\s+/g, ' '));
});

test('search ballots reset between rounds', () => {
  const g = setup(); g.next(); g.send('old-voter', '!search 1'); g.next();
  g.send('old-voter', '!ask A'); g.next(); g.next();
  assert.equal(g.state().phase, 'search'); assert.deepEqual(g.state().votes.search, {});
  g.send('new-voter', '!search 2'); g.next(); assert.equal(g.state().evidence[1].id, 'E2');
});

test('ask ballots reset between rounds', () => {
  const g = setup(); g.next(); g.find(1); g.next(); g.send('x', '!ask D'); g.next();
  g.host('next'); g.find(2); g.next(); assert.deepEqual(g.state().votes.ask, {});
  g.send('fresh', '!ask B'); g.next(); assert.equal(g.state().testimony, 'B');
});

test('only the current ballot vote bars are exposed', () => {
  const g = setup(); g.next(); g.send('x', '!search 1'); assert.deepEqual(Object.keys(g.state().votes), ['search']);
  g.next(); assert.deepEqual(Object.keys(g.state().votes), ['ask']);
});

test('search ties go to the lowest eligible location id', () => {
  const g = setup(); g.next(); g.send('x', '!search 2'); g.send('y', '!search 1'); g.next(); assert.equal(g.state().evidence[0].id, 'E1');
});

test('a searched location is no longer valid on the next search ballot', () => {
  const g = setup(); g.next(); g.find(1); g.next(); g.send('x', '!ask A'); g.next(); g.next();
  g.send('y', '!search 1'); assert.deepEqual(g.state().votes.search, {});
});

test('contradiction cannot reveal truth until the matching evidence is found', () => {
  const g = setup(); g.next(); g.find(1); g.next(); g.send('x', '!ask C'); g.next(); g.send('sharp', '!c E3');
  assert.equal(g.state().truthRevealed, false); assert.equal(g.state().misses, 1);
});

test('one contradiction call per user per testimony', () => {
  const g = setup(); g.next(); g.find(3); g.next(); g.send('x', '!ask C'); g.next();
  g.send('sharp', '!contradict E1'); g.send('sharp', '!contradict E3'); assert.equal(g.state().truthRevealed, false); assert.equal(g.state().misses, 1);
});

test('correct contradiction reveals truth and awards the first Sharp Eye', () => {
  const g = setup(); g.next(); g.find(3); g.next(); g.send('x', '!ask C'); g.next();
  g.send('first', '!c E3'); g.send('second', '!c E3');
  assert.equal(g.state().truthRevealed, true); assert.deepEqual(g.state().sharpEyes, ['first']); assert.equal(g.state().lastSharpEye.user, 'first');
});

test('wrong contradiction only increments the anonymous miss count', () => {
  const g = setup(); g.next(); g.find(3); g.next(); g.send('x', '!ask C'); g.next(); g.send('miss', '!c E1');
  assert.equal(g.state().misses, 1); assert.equal(JSON.stringify(g.state()).includes('miss"'), false);
});

test('host-only chat commands are ignored for regular viewers', () => {
  const g = setup(); g.send('viewer', '!reset'); assert.equal(g.state().phase, 'intro');
  g.send('host', '!next', true); assert.equal(g.state().phase, 'search');
});

test('host can advance, reveal, and reset', () => {
  const g = setup(); g.next(); assert.equal(g.state().phase, 'search'); g.host('reveal'); assert.equal(g.state().revealed, true); g.host('reset'); assert.equal(g.state().phase, 'intro');
});

test('accusation result reports correct voter percentage and split', () => {
  const g = setup(); g.next();
  let round = 0;
  while (g.state().phase !== 'accusation') {
    if (g.state().phase === 'search') { g.send(`search${round}`, `!search ${round + 1}`); g.next(); }
    if (g.state().phase === 'question') { g.send(`ask${round}`, '!ask A'); g.next(); }
    if (g.state().phase === 'objection') { g.next(); round++; }
  }
  assert.equal(g.state().phase, 'accusation');
  for (let i = 0; i < 3; i++) g.send(`right${i}`, '!accuse C'); g.send('wrong', '!accuse D'); g.host('next');
  assert.deepEqual(g.state().accusationResult, { counts: { C: 3, D: 1 }, total: 4, right: 3, percent: 75 });
});

test('solution stays hidden until reveal', () => {
  const g = setup(); assert.equal(g.state().solution, null); g.host('reveal'); assert.equal(g.state().solution.suspect, 'C');
});

test('reveal emits one closing line with accuracy and Sharp Eyes; reset allows a new intro', () => {
  const g = setup();
  g.next(); let location = 1;
  while (g.state().phase !== 'accusation') {
    if (g.state().phase === 'search') { g.send(`search${location}`, `!search ${location++}`); g.next(); }
    else if (g.state().phase === 'question') { g.send(`ask${location}`, '!ask C'); g.next(); }
    else if (g.state().phase === 'objection') g.next();
  }
  for (const user of ['one', 'two']) g.send(user, '!accuse C');
  const effects = g.next();
  const lines = effects.filter(effect => effect.say);
  assert.equal(lines.length, 1);
  assert.match(lines[0].say, /100% voted correctly/);
  assert.match(lines[0].say, /Sharp Eyes: none/);
  assert.equal(g.host('reveal').filter(effect => effect.say).length, 0);
  g.host('reset'); assert.equal(g.state().phase, 'intro');
});

test('reset clears all ballots and evidence', () => {
  const g = setup(); g.next(); g.find(1); g.next(); g.send('q', '!ask A'); g.host('reset');
  assert.equal(g.state().evidence.length, 0); assert.deepEqual(g.state().votes, {}); assert.equal(g.state().round, 0);
});
