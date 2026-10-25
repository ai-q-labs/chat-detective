const { parseCommand } = require('./commands');

function splitIntro(intro, maxLength = 500) {
  const text = String(intro || '').trim();
  const limit = Math.max(1, Number(maxLength) || 500);
  if (!text) return [];
  const sentenceEnds = [];
  const punctuation = /[.!?]["'”’)]*\s+/g;
  let match;
  while ((match = punctuation.exec(text))) sentenceEnds.push(match.index + match[0].trimEnd().length);
  const chunks = [];
  let remaining = text;
  if (text.length <= limit) {
    const candidates = sentenceEnds.filter(end => end < text.length);
    if (!candidates.length) return [text];
    const splitAt = candidates.sort((a, b) => Math.abs(a - text.length / 2) - Math.abs(b - text.length / 2))[0];
    return [text.slice(0, splitAt).trim(), text.slice(splitAt).trim()].filter(Boolean);
  }
  while (remaining.length > limit) {
    const ends = [];
    const sentencePattern = /[.!?]["'”’)]*\s+/g;
    while ((match = sentencePattern.exec(remaining))) if (match.index + match[0].trimEnd().length <= limit) ends.push(match.index + match[0].trimEnd().length);
    let splitAt = ends.at(-1);
    if (!splitAt) {
      splitAt = remaining.lastIndexOf(' ', limit);
      if (splitAt < 1) splitAt = limit;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function createGame(caseData, opts = {}) {
  const voteSeconds = Math.max(1, Number(opts.voteSeconds || 30));
  const now = () => Number(opts.now ? opts.now() : Date.now());
  const suspects = Object.keys(caseData.suspects);
  let game; let timerDuration = null;
  const ballots = { search: {}, ask: {}, accusation: {} };
  const calls = new Set();
  function fresh() {
    return { title: caseData.title, intro: caseData.intro, phase: 'intro', round: 0, deadline: null, searched: [], evidence: [], testimony: null, truthRevealed: false, sharpEyes: [], lies: [], misses: 0, votes: {}, revealed: false, solution: null, ending: null, accusationResult: null, simulated: !!opts.simulated };
  }
  game = fresh();
  const tally = ballot => Object.values(ballot || {}).reduce((acc, value) => (acc[value] = (acc[value] || 0) + 1, acc), {});
  function currentBallot() { return ({ search: 'search', question: 'ask', accusation: 'accusation' })[game.phase] || null; }
  function snapshot() {
    const s = structuredClone(game);
    s.timerDuration = timerDuration;
    s.remainingSeconds = game.deadline ? Math.max(0, Math.ceil((game.deadline - now()) / 1000)) : null;
    s.suspects = Object.fromEntries(Object.entries(caseData.suspects).map(([id, suspect]) => [id, { ...suspect, lie: game.lies.find(lie => lie.suspect === id) || null }]));
    s.locations = caseData.locations.map(l => ({ id: l.id, name: l.name, evidence: game.evidence.find(e => e.id === l.evidence.id) || null }));
    s.testimonyCard = game.phase === 'objection' && game.testimony ? { suspect: game.testimony, ...caseData.testimonies[game.testimony], revealedTruth: game.truthRevealed } : null;
    s.lieStats = { caught: game.lies.length, total: Object.values(caseData.testimonies).filter(testimony => testimony.contradictedBy).length };
    const key = currentBallot();
    s.currentBallot = key;
    s.votes = key ? { [key]: tally(ballots[key]) } : {};
    if (game.revealed) s.finalVotes = tally(ballots.accusation);
    return s;
  }
  function output(effects = []) { effects.push({ broadcast: snapshot() }); return effects; }
  const say = text => ({ say: text });
  function clearBallot(key) { ballots[key] = {}; }
  function phase(name, duration) { game.phase = name; timerDuration = duration || null; game.deadline = duration ? now() + duration * 1000 : null; }
  function startSearch(effects) {
    const remaining = caseData.locations.filter(location => !game.searched.includes(location.id));
    if (remaining.length === 1) {
      const last = remaining[0];
      game.round++; game.testimony = null; game.truthRevealed = false; game.searched.push(last.id); game.evidence.push({ ...last.evidence, location: last.name });
      clearBallot('ask'); phase('question', voteSeconds);
      effects.push(say(`Last place to search: ${last.name}. ${last.evidence.id}: ${last.evidence.text} Vote !ask ${suspects.join(', ')}`));
      return;
    }
    if (game.round >= Math.min(3, caseData.locations.length) || remaining.length === 0) {
      clearBallot('accusation'); phase('accusation', voteSeconds * 2); effects.push(say(`Final vote: who took the trophy? !accuse ${suspects.join(', ')}`)); return;
    }
    clearBallot('search'); game.round++; game.testimony = null; game.truthRevealed = false; phase('search', voteSeconds);
    effects.push(say(`Round ${game.round}: choose a location with !search ${caseData.locations.filter(l => !game.searched.includes(l.id)).map(l => l.id).join(' · ')}`));
  }
  function resolveSearch(effects) {
    const counts = tally(ballots.search);
    const eligible = caseData.locations.filter(l => !game.searched.includes(l.id));
    const chosen = eligible.sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0) || String(b.id).localeCompare(String(a.id), undefined, { numeric: true })).pop();
    if (!chosen) return;
    game.searched.push(chosen.id); game.evidence.push({ ...chosen.evidence, location: chosen.name });
    clearBallot('ask'); phase('question', voteSeconds);
    effects.push(say(`${chosen.evidence.id} found at ${chosen.name}: ${chosen.evidence.text}`)); effects.push(say(`Who should we question? Vote !ask ${suspects.join(', ')}`));
  }
  function resolveQuestion(effects) {
    const counts = tally(ballots.ask);
    const selected = suspects.slice().sort((a, b) => (counts[a] || 0) - (counts[b] || 0) || b.localeCompare(a)).pop() || suspects[0];
    game.testimony = selected; game.truthRevealed = false; phase('objection', voteSeconds);
    effects.push(say(`${selected}, ${caseData.suspects[selected].name}: “${caseData.testimonies[selected].text}” Call !contradict ${caseData.locations.map(l => l.evidence.id).join(', ')}`));
  }
  function reveal(effects) {
    if (game.revealed) return;
    game.revealed = true; game.solution = caseData.solution;
    const votes = ballots.accusation; const counts = tally(votes); const values = Object.values(votes); const total = values.length;
    const right = values.filter(value => value === caseData.solution.suspect).length;
    const popular = Object.keys(counts).sort((a, b) => counts[a] - counts[b] || b.localeCompare(a)).pop();
    game.accusationResult = { counts, total, right, percent: total ? Math.round(right * 100 / total) : 0 };
    game.ending = caseData.endings[popular] || caseData.endings.default;
    phase('revealed', null); effects.push(say(`${game.ending} ${caseData.solution.text} Closing the case: ${game.accusationResult.percent}% voted correctly. Sharp Eyes: ${game.sharpEyes.join(', ') || 'none'}.`));
  }
  function advance(effects) {
    if (game.phase === 'intro') { for (const message of splitIntro(caseData.intro)) effects.push(say(message)); startSearch(effects); }
    else if (game.phase === 'search') resolveSearch(effects);
    else if (game.phase === 'question') resolveQuestion(effects);
    else if (game.phase === 'objection') startSearch(effects);
    else if (game.phase === 'accusation') reveal(effects);
  }
  function hostAction(action) {
    const effects = [];
    if (action === 'reset') { game = fresh(); clearBallot('search'); clearBallot('ask'); clearBallot('accusation'); calls.clear(); }
    else if (action === 'reveal') reveal(effects);
    else if (action === 'next') advance(effects);
    return output(effects);
  }
  function handle(event) {
    if (!event || !event.type) return output();
    if (event.type === 'host') return hostAction(event.action);
    if (event.type === 'tick') {
      const effects = [];
      if (game.deadline && Number(event.now) >= game.deadline) advance(effects);
      return output(effects);
    }
    if (event.type === 'chat') {
      const parsed = parseCommand(event.text, caseData); if (!parsed) return output();
      const user = String(event.user || 'anonymous').toLowerCase();
      if (parsed.type === 'host') return event.isHost ? hostAction(parsed.action) : output();
      const voteKey = parsed.type === 'search' ? 'search' : parsed.type === 'ask' ? 'ask' : parsed.type === 'accuse' ? 'accusation' : null;
      if (voteKey) {
        const validPhase = (voteKey === 'search' && game.phase === 'search' && !game.searched.includes(parsed.value)) || (voteKey === 'ask' && game.phase === 'question') || (voteKey === 'accusation' && game.phase === 'accusation');
        if (validPhase) ballots[voteKey][user] = parsed.value;
      } else if (parsed.type === 'contradict' && game.phase === 'objection' && game.testimony) {
        const key = `${game.round}:${game.testimony}`; const callKey = `${key}:${user}`;
        if (!calls.has(callKey)) {
          calls.add(callKey); const testimony = caseData.testimonies[game.testimony];
          if (testimony.contradictedBy === parsed.value && game.evidence.some(e => e.id === parsed.value)) {
            if (game.truthRevealed) return output();
            game.truthRevealed = true; game.lastSharpEye = { user, at: now() };
            if (!game.lies.some(lie => lie.suspect === game.testimony)) game.lies.push({ suspect: game.testimony, evidenceId: parsed.value, truth: testimony.truth, user });
            if (!game.sharpEyes.includes(user)) game.sharpEyes.push(user);
            return output([say(`The evidence cracks the story. Sharp Eye: ${user}! “${testimony.truth}”`)]);
          }
          game.misses++;
        }
      }
      return output();
    }
    return output();
  }
  return { handle, state: snapshot };
}
module.exports = { createGame, splitIntro };
