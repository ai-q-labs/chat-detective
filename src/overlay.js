const COLORS = { A: '#cf765c', B: '#6b9fb4', C: '#8da66a', D: '#b08ac0' };
const $ = id => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let stageScale = 1;
let lastState = null;
let lastNoticeAt = null;
let lastTestimonyKey = null;
let sharpTimer = null;

if (new URLSearchParams(location.search).get('backdrop') === '1') document.body.classList.add('with-backdrop');

function fitStage() {
  stageScale = Math.min(innerWidth / 1920, innerHeight / 1080);
  const width = 1920 * stageScale;
  const height = 1080 * stageScale;
  $('stage-root').style.transform = `scale(${stageScale})`;
  $('stage-root').style.left = `${(innerWidth - width) / 2}px`;
  $('stage-root').style.top = `${(innerHeight - height) / 2}px`;
}

function renderSuspects(state) {
  $('suspects').innerHTML = Object.entries(state.suspects || {}).map(([id, suspect]) => {
    const lie = suspect.lie;
    return `<div class="suspect ${lie ? 'liar' : ''}" data-id="${escapeHtml(id)}">
      <div class="suspect-head"><span class="initial">${escapeHtml(id)}</span><b>${escapeHtml(suspect.name)}</b></div>
      <small>${escapeHtml(suspect.role)}</small>
      ${lie ? `<div class="lie-stamp">LIED · ${escapeHtml(lie.evidenceId)}</div><div class="lie-truth" title="${escapeHtml(lie.truth)}">TRUTH: ${escapeHtml(lie.truth)}</div>` : ''}
    </div>`;
  }).join('');
}

function renderEvidence(locations) {
  const host = $('evidence');
  const rows = locations || [];
  if (host.children.length !== rows.length) {
    host.innerHTML = rows.map((location, index) => `<article class="evidence-slot face-down" data-slot="${index}">
      <div class="question">?</div><div class="evidence-copy"><h3></h3><p>Evidence not yet found</p></div>
    </article>`).join('');
  }
  rows.forEach((location, index) => {
    const slot = host.children[index];
    const found = !!location.evidence;
    slot.classList.toggle('face-up', found);
    slot.classList.toggle('face-down', !found);
    slot.dataset.evidenceId = found ? location.evidence.id : '';
    const question = slot.querySelector('.question');
    const heading = slot.querySelector('h3');
    const text = slot.querySelector('p');
    if (found) {
      if (question) question.remove();
      heading.textContent = `${location.evidence.id} · ${location.name}`;
      text.textContent = location.evidence.text;
      if (slot.dataset.wasFound !== '1') {
        slot.style.animation = 'none';
        void slot.offsetWidth;
        slot.style.animation = '';
        slot.dataset.wasFound = '1';
      }
    } else {
      if (!question) {
        const mark = document.createElement('div');
        mark.className = 'question';
        mark.textContent = '?';
        slot.prepend(mark);
      }
      heading.textContent = location.name;
      text.textContent = 'Evidence not yet found';
      slot.dataset.wasFound = '0';
    }
  });
}

function renderStrings(lies) {
  const svg = $('boardStrings');
  const boardRect = $('board').getBoundingClientRect();
  const liveKeys = new Set();
  for (const lie of lies || []) {
    const key = `${lie.suspect}|${lie.evidenceId}`;
    liveKeys.add(key);
    let path = Array.from(svg.children).find(item => item.dataset.key === key);
    if (!path) {
      path = document.createElementNS(SVG_NS, 'path');
      path.classList.add('board-string');
      path.dataset.key = key;
      svg.appendChild(path);
    }
    const evidence = Array.from(document.querySelectorAll('.evidence-slot')).find(slot => slot.dataset.evidenceId === lie.evidenceId);
    const suspect = Array.from(document.querySelectorAll('.suspect')).find(card => card.dataset.id === lie.suspect);
    if (!evidence || !suspect) continue;
    const evidenceRect = evidence.getBoundingClientRect();
    const suspectRect = suspect.getBoundingClientRect();
    const sx = (evidenceRect.left - boardRect.left) / stageScale;
    const sy = (evidenceRect.top + evidenceRect.height / 2 - boardRect.top) / stageScale;
    const ex = (suspectRect.right - boardRect.left) / stageScale;
    const ey = (suspectRect.top + suspectRect.height / 2 - boardRect.top) / stageScale;
    path.setAttribute('d', `M ${sx} ${sy} C ${sx - 30} ${sy}, ${ex + 30} ${ey}, ${ex} ${ey}`);
  }
  for (const path of Array.from(svg.children)) if (!liveKeys.has(path.dataset.key)) path.remove();
}

function renderTestimony(state) {
  const testimony = state.phase === 'objection' ? state.testimonyCard : null;
  const signature = testimony ? JSON.stringify([testimony.suspect, testimony.text, testimony.truth, testimony.revealedTruth]) : '';
  if (signature === lastTestimonyKey) return testimony;
  lastTestimonyKey = signature;
  const card = $('testimony');
  card.className = `testimony${testimony ? ' show' : ''}${testimony?.revealedTruth ? ' truth cracked' : ''}`;
  if (!testimony) { card.innerHTML = ''; return null; }
  card.style.setProperty('--suspect-color', COLORS[testimony.suspect] || '#e5b65d');
  card.innerHTML = `<h2>TESTIMONY · ${escapeHtml(testimony.suspect)} — ${escapeHtml(state.suspects[testimony.suspect].name)}</h2>
    <p>${testimony.revealedTruth ? `<b>TRUTH:</b> ${escapeHtml(testimony.truth)}` : `“${escapeHtml(testimony.text)}”`}</p>
    <div class="objection-prompt"><span>Spot the lie? Type !contradict ${(state.locations || []).filter(location => location.evidence).map(location => escapeHtml(location.evidence.id)).join(' · ')}</span><b id="objectionCountdown">${state.remainingSeconds ?? '—'}s</b></div>`;
  return testimony;
}

function renderFinal(state) {
  if (!state.revealed) { $('final').classList.remove('show'); return; }
  $('final').classList.add('show');
  const result = state.accusationResult || { counts: state.finalVotes || {}, percent: 0, right: 0, total: 0 };
  const max = Math.max(1, ...Object.values(result.counts));
  const stats = state.lieStats || { caught: (state.lies || []).length, total: 0 };
  const votes = Object.entries(state.suspects).map(([id, suspect]) => `<div class="final-option">${escapeHtml(id)} · ${escapeHtml(suspect.name)} · ${result.counts[id] || 0}<div class="track"><i style="width:${Math.round((result.counts[id] || 0) / max * 100)}%"></i></div></div>`).join('');
  const lies = (state.lies || []).map(lie => `<p><b>${escapeHtml(lie.suspect)} LIED · ${escapeHtml(lie.evidenceId)}:</b> ${escapeHtml(lie.truth)}</p>`).join('');
  $('finalCard').innerHTML = `<div class="eyebrow">CASE CLOSED</div><h1>${escapeHtml(state.solution.suspect)} · ${escapeHtml(state.suspects[state.solution.suspect].name)}</h1>
    <p>${escapeHtml(state.solution.text)}</p><h2>${result.percent}% got it right · ${result.right}/${result.total} voters</h2>
    <div class="final-bars">${votes}</div><h2>Lies caught: ${stats.caught} of ${stats.total}</h2>${lies}
    <p>${escapeHtml(state.ending)}</p><div class="sharp-list">SHARP EYES: ${escapeHtml((state.sharpEyes || []).join(', ') || 'none')}</div>`;
}

function render(state) {
  $('simPill').classList.toggle('show', !!state.simulated);
  $('title').textContent = state.title;
  $('intro').textContent = state.phase === 'intro' ? state.intro : '';
  renderSuspects(state);
  renderEvidence(state.locations);
  renderStrings(state.lies);

  const key = state.currentBallot;
  const counts = key ? state.votes[key] || {} : {};
  const options = key === 'search'
    ? (state.locations || []).filter(location => !state.searched.includes(location.id)).map(location => [location.id, location.name])
    : key === 'ask' || key === 'accusation' ? Object.entries(state.suspects || {}).map(([id, suspect]) => [id, suspect.name]) : [];
  $('options').style.setProperty('--option-count', Math.min(5, Math.max(1, options.length)));
  $('ballotTitle').textContent = key === 'search' ? 'SEARCH THE SCENE' : key === 'ask' ? 'CHOOSE A SUSPECT TO QUESTION' : key === 'accusation' ? 'WHO TOOK THE TROPHY?' : 'CASE IN PROGRESS';
  $('options').innerHTML = options.map(([id, label]) => {
    const count = counts[id] || 0;
    const largest = Math.max(1, ...Object.values(counts));
    return `<div class="option"><div class="option-label"><span>${escapeHtml(id)} · ${escapeHtml(label)}</span><b>${count}</b></div><div class="track"><i style="width:${Math.round(count / largest * 100)}%"></i></div></div>`;
  }).join('');
  const found = (state.locations || []).filter(location => location.evidence).map(location => location.evidence.id);
  $('hint').textContent = key === 'search' ? `Type !search ${options.map(item => item[0]).join(' · ')}`
    : key === 'ask' ? `Type !ask ${options.map(item => item[0]).join(' · ')}`
    : key === 'accusation' ? `Type !accuse ${options.map(item => item[0]).join(' · ')}`
    : state.phase === 'objection' ? `Spot the lie? Type !contradict ${found.join(' · ')}` : '';
  const seconds = state.remainingSeconds;
  $('countdown').textContent = seconds === null ? '—' : seconds;
  $('progress').style.strokeDashoffset = seconds === null ? 226 : 226 * (1 - seconds / Math.max(1, state.timerDuration || 30));
  const testimony = renderTestimony(state);
  const objectionCountdown = $('objectionCountdown');
  if (objectionCountdown) objectionCountdown.textContent = `${seconds ?? '—'}s`;

  if (state.lastSharpEye && state.lastSharpEye.at !== lastNoticeAt) {
    lastNoticeAt = state.lastSharpEye.at;
    clearTimeout(sharpTimer);
    $('sharp').innerHTML = `<div class="sharp">SHARP EYE: ${escapeHtml(state.lastSharpEye.user)}</div>`;
    sharpTimer = setTimeout(() => $('sharp').replaceChildren(), 4000);
  }
  const phaseName = state.phase === 'accusation' ? 'ACCUSE' : state.phase === 'objection' ? 'OBJECT' : state.phase.toUpperCase();
  $('boardFooter').innerHTML = `<strong>ROUND ${state.round} · ${phaseName}</strong><span>Sharp Eyes ${ (state.sharpEyes || []).length }</span><span>Misses: ${state.misses}</span>`;

  const temporary = $('stringPath');
  temporary.style.display = testimony?.revealedTruth ? 'block' : 'none';
  if (testimony?.revealedTruth) {
    const evidence = Array.from(document.querySelectorAll('.evidence-slot')).find(slot => slot.dataset.evidenceId === testimony.contradictedBy);
    if (evidence) {
      const evidenceRect = evidence.getBoundingClientRect();
      const testimonyRect = $('testimony').getBoundingClientRect();
      const rootRect = $('stage-root').getBoundingClientRect();
      const point = (x, y) => [(x - rootRect.left) / stageScale, (y - rootRect.top) / stageScale];
      const start = point(evidenceRect.left, evidenceRect.top + evidenceRect.height / 2);
      const end = point(testimonyRect.right, testimonyRect.top + testimonyRect.height / 2);
      temporary.setAttribute('d', `M ${start[0]} ${start[1]} C ${start[0] - 45} ${start[1]}, ${end[0] + 45} ${end[1]}, ${end[0]} ${end[1]}`);
    }
  }
  renderFinal(state);
}

fitStage();
addEventListener('resize', () => { fitStage(); if (lastState) render(lastState); });
$('evidence').addEventListener('scroll', () => lastState && renderStrings(lastState.lies));
const events = new EventSource('/events');
events.onmessage = event => { lastState = JSON.parse(event.data); render(lastState); };
fetch('/state').then(response => response.json()).then(state => { lastState = state; render(state); });
