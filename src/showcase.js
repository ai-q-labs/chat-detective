const $ = id => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const simOrigin = (qs.get('sim') || 'http://localhost:3001').replace(/\/$/, '');
let tourStartedAt = 0;
let tourDeadlineAt = 0;
let chatPopup = null;
let popupBlocked = false;
let liveHighlightKey = '';
let liveHighlightUntil = 0;
let liveHighlightTimer = null;
let liveChatPollTimer = null;
let simFramesPromise = null;
let simFrames = null;
const liveChatStyles = document.createElement('style');
liveChatStyles.textContent = `.popup-warning,.popup-open{padding:13px 14px;margin:0 0 14px;border-radius:7px;font-size:20px;line-height:1.3}.popup-warning{background:#472a22;border:1px solid #d17a55;color:#fff0e7}.popup-open{background:#24362d;border:1px solid #86ad82;color:#eff8e8}.received-lines{max-height:690px;overflow-y:auto;scrollbar-color:#a18a61 #202829;padding-right:5px}.received-line{position:relative;padding:14px 11px 16px;margin:0 0 9px;border:1px solid #5c625a;border-radius:7px;background:#182022;color:#faf8f2;font-size:23px;line-height:1.25;box-shadow:0 4px 12px #0004;overflow-wrap:anywhere}.received-line b{display:block;color:#f0c66e;font-weight:800;font-size:24px}.received-line .message{display:block;margin-top:3px}.received-line em{display:block;margin-top:7px;color:#b8c8bc;font:700 15px ui-monospace,Consolas,monospace;letter-spacing:.08em;font-style:normal}.received-line.highlight{background:#593d1b;border:2px solid #ffd36d;box-shadow:0 0 0 3px #ffd36d44,0 0 28px #f0b74799;animation:vote-arrives .45s ease-out}.received-empty{padding:22px 12px;color:#eee7d9;font-size:23px}@keyframes vote-arrives{from{transform:scale(.97);filter:brightness(1.7)}to{transform:scale(1);filter:brightness(1)}}`;
document.head.append(liveChatStyles);

function openChatPopupFromGesture() {
  const channel = window.SHOWCASE_CHANNEL || '';
  if (!channel) { popupBlocked = false; chatPopup = null; return; }
  const left = Math.max(0, (screen.availLeft || 0) + screen.availWidth - 440);
  const top = (screen.availTop || 0) + 120;
  const popoutUrl = `https://www.twitch.tv/popout/${encodeURIComponent(channel)}/chat?popout=`;
  try { chatPopup = window.open(popoutUrl, 'cd-twitch-chat', `popup,width=420,height=760,left=${left},top=${top}`); }
  catch { chatPopup = null; }
  popupBlocked = !chatPopup;
  if (chatPopup) {
    try { chatPopup.document.title = 'Chat Detective · Twitch chat'; chatPopup.document.body.textContent = 'Loading the live Twitch chat…'; } catch {}
  }
}
function closeChatPopup() {
  try { if (chatPopup && !chatPopup.closed) chatPopup.close(); } catch {}
  chatPopup = null;
}

function fit() {
  const scale = Math.min(innerWidth / 1920, innerHeight / 1080);
  const stage = $('stage');
  stage.style.transform = `scale(${scale})`;
  stage.style.left = `${(innerWidth - 1920 * scale) / 2}px`;
  stage.style.top = `${(innerHeight - 1080 * scale) / 2}px`;
}
function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function logStep(index, label) {
  const elapsed = Math.floor((Date.now() - tourStartedAt) / 1000);
  console.log(`[tour] ${label} at ${elapsed}s`);
  $('stepCount').textContent = `· ${String(index).padStart(2, '0')} / 05`;
  $('topMode').textContent = label.toUpperCase();
}
function caption(label, sentence) {
  $('caption').innerHTML = `<span class="step-badge">${safe(label)}</span><span>${safe(sentence)}</span>`;
}
function say(label, sentence) {
  caption(label, sentence);
  return new Promise(resolve => {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return setTimeout(resolve, Math.min(4200, Math.max(1500, sentence.length * 42)));
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(sentence);
    const voices = speechSynthesis.getVoices();
    const english = voices.filter(voice => /^en(?:[-_]|$)/i.test(voice.lang));
    utterance.voice = english.find(voice => /Microsoft Zira/i.test(voice.name)) || english.find(voice => /^en-US$/i.test(voice.lang)) || english[0] || null;
    utterance.rate = 1.25;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    speechSynthesis.speak(utterance);
    setTimeout(resolve, Math.max(4000, sentence.length * 85));
  });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function get(url) { const response = await fetch(url, { cache: 'no-store' }); if (!response.ok) throw new Error(`${url} returned ${response.status}`); return response.json(); }
async function post(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.status === 204 ? null : response.json();
}
function showFeed(leftUrl, sideHtml, mode) {
  $('screen').innerHTML = `<iframe class="feed" title="${safe(mode)}" src="${safe(leftUrl)}"></iframe>`;
  $('side').innerHTML = sideHtml;
}
function preloadSimFrames() {
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  Object.assign(holder.style, { position: 'absolute', left: '-1500px', top: '0', width: '1366px', height: '848px', overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' });
  const overlay = document.createElement('iframe');
  overlay.title = 'Preloaded simulated case overlay';
  overlay.src = `${simOrigin}/overlay?backdrop=1`;
  Object.assign(overlay.style, { display: 'block', width: '1366px', height: '848px', border: '0' });
  const chat = document.createElement('iframe');
  chat.title = 'Preloaded simulated chat log';
  chat.src = `${simOrigin}/chatlog`;
  Object.assign(chat.style, { display: 'block', width: '420px', height: '780px', border: '0' });
  const loaded = frame => new Promise((resolve, reject) => {
    frame.addEventListener('load', resolve, { once: true });
    frame.addEventListener('error', () => reject(new Error(`Could not preload ${frame.title}`)), { once: true });
    setTimeout(() => reject(new Error(`Timed out preloading ${frame.title}`)), 20000);
  });
  const ready = Promise.all([loaded(overlay), loaded(chat)]).then(() => { simFrames = { holder, overlay, chat }; return simFrames; });
  holder.append(overlay, chat);
  document.body.append(holder);
  return ready;
}
async function intro() {
  logStep(1, 'Title');
  await say('01 · TITLE', 'Chat Detective — the whole Twitch chat plays one detective.');
  await say('01 · TITLE', 'The streamer opens the case and controls the pace. Chat searches, questions suspects, spots lies, and votes on the culprit.');
}
async function liveTwitch() {
  logStep(2, 'Live on Twitch');
  const channel = window.SHOWCASE_CHANNEL || '';
  if (!channel) {
    closeChatPopup();
    showFeed('/overlay?backdrop=1', '<h2>LIVE TWITCH CHAT · RECEIVED BY EVENTSUB</h2><div class="waiting">Set TWITCH_CHANNEL before recording the live segment.</div>', 'Live overlay');
    await say('02 · LIVE TWITCH', 'The live channel is not configured on this server, so the real chat vote is unavailable.');
    return;
  }
  if (!chatPopup || chatPopup.closed) popupBlocked = true;
  const popupNotice = popupBlocked
    ? '<div class="popup-warning">CHAT POPUP BLOCKED · Allow popups for this page or open Twitch chat manually. The tour will continue without a simulated vote.</div>'
    : '<div class="popup-open">Twitch chat is open in its own window. Viewer lines below are received by EventSub.</div>';
  showFeed('/overlay?backdrop=1', `<h2>LIVE TWITCH CHAT · RECEIVED BY EVENTSUB</h2>${popupNotice}<div class="received-lines" id="liveLines"></div>`, 'Live overlay');
  renderLiveChat(await get('/state'));
  clearInterval(liveChatPollTimer);
  liveChatPollTimer = setInterval(() => get('/state').then(renderLiveChat).catch(() => {}), 700);
  await say('02 · LIVE TWITCH', 'This is the live Twitch server. The streamer advances the case, and viewers cast the search vote in real channel chat.');
  const before = await get('/state');
  const seenLines = new Set((before.chatLines || []).map(chatLineKey));
  await post('/host', { action: 'next' });
  await post('/host', { action: 'pause-timer' });
  const deadline = Math.min(Date.now() + 45000, tourDeadlineAt - 100000);
  await say('02 · LIVE TWITCH', 'Type !search 2 in the Twitch chat window.');
  let found = false;
  while (Date.now() < deadline) {
    const state = await get('/state');
    const lines = state.chatLines || [];
    const validLocationIds = new Set((state.locations || []).filter(location => !state.searched.includes(location.id)).map(location => String(location.id).toLowerCase()));
    const newSearchLine = lines.find(line => {
      const command = line.source === 'twitch' && /^!search\s+(\S+)/i.exec(line.text);
      return command && validLocationIds.has(command[1].toLowerCase()) && !seenLines.has(chatLineKey(line));
    });
    for (const line of lines) seenLines.add(chatLineKey(line));
    const total = Object.values(state.votes?.search || {}).reduce((sum, count) => sum + count, 0);
    if (state.phase === 'search' && total > 0 && newSearchLine) {
      found = true;
      liveHighlightKey = chatLineKey(newSearchLine); liveHighlightUntil = Date.now() + 3000;
      renderLiveChat(state);
      clearTimeout(liveHighlightTimer);
      liveHighlightTimer = setTimeout(() => {
        document.querySelectorAll('.received-line').forEach(node => { if (node.dataset.key === liveHighlightKey) node.classList.remove('highlight'); });
        liveHighlightKey = '';
      }, 3000);
      break;
    }
    renderLiveChat(state);
    if (state.phase !== 'search' && state.evidence?.length > before.evidence.length) break;
    await pause(700);
  }
  if (found) {
    await say('02 · LIVE TWITCH', 'That vote came from real Twitch chat over EventSub.');
    const current = await get('/state');
    await post('/host', { action: 'next' });
    const openUntil = Date.now() + 5000;
    while (Date.now() < openUntil) {
      const updated = await get('/state');
      if (updated.evidence.length > current.evidence.length || updated.phase === 'question') break;
      await pause(250);
    }
    await pause(4000);
  } else {
    caption('02 · LIVE TWITCH', 'No real Twitch vote arrived in 45 seconds. Moving on without a fake vote.');
    const current = await get('/state');
    if (current.phase === 'search' && current.timerPaused) await post('/host', { action: 'next' });
    await pause(1800);
  }
  await post('/host', { action: 'reset' });
  clearInterval(liveChatPollTimer); liveChatPollTimer = null;
  closeChatPopup();
}
function chatLineKey(line) { return `${line.at}|${line.user}|${line.text}`; }
function renderLiveChat(state) {
  const host = $('liveLines');
  if (!host) return;
  const lines = (state.chatLines || []).slice(-20).reverse();
  host.innerHTML = lines.map(line => {
    const key = chatLineKey(line);
    const source = line.source === 'twitch' ? 'VIEWER · EVENTSUB' : line.source === 'bot' ? 'BOT' : safe(line.source).toUpperCase();
    const highlighted = key === liveHighlightKey && Date.now() < liveHighlightUntil;
    return `<div class="received-line${highlighted ? ' highlight' : ''}" data-key="${safe(key)}"><b>${safe(line.user)}</b><span class="message">${safe(line.text)}</span><em>${source}</em></div>`;
  }).join('') || '<div class="received-empty">Waiting for Twitch chat messages…</div>';
}
async function simulatedCase() {
  closeChatPopup();
  const frames = await (simFramesPromise || preloadSimFrames());
  logStep(3, 'A full simulated case');
  $('screen').innerHTML = '';
  frames.overlay.className = 'feed';
  frames.overlay.removeAttribute('style');
  $('screen').append(frames.overlay);
  $('side').innerHTML = '<h2>SIMULATED CROWD</h2>';
  frames.chat.className = 'feed';
  frames.chat.removeAttribute('style');
  frames.chat.style.height = 'calc(100% - 60px)';
  $('side').append(frames.chat);
  await say('03 · SIMULATED CASE', 'Now a twelve-viewer crowd runs the complete case on the separate simulation server.');
  await post(`${simOrigin}/demo/start`, { speed: 3.5 });
  let lastEvidence = 0; let lastLies = 0; let announcedAccusation = false; let announcedReveal = false;
  const limit = Math.min(Date.now() + 60000, tourDeadlineAt - 32000);
  while (Date.now() < limit) {
    const state = await get(`${simOrigin}/state`);
    if (lastEvidence < state.evidence.length) {
      const evidence = state.evidence.at(-1);
      lastEvidence = state.evidence.length;
      const line = (state.chatLines || []).slice().reverse().find(item => item.source === 'bot' &&
        (item.text.startsWith(`${evidence.id} found at `) || item.text.startsWith(`Last place to search: ${evidence.location}. ${evidence.id}:`)));
      if (line && Date.now() - line.at <= 3000) await say('03 · SIMULATED CASE', `Evidence ${evidence.id} is found.`);
    }
    while (lastLies < state.lies.length) {
      lastLies++;
      await say('03 · SIMULATED CASE', 'A viewer catches the lie with evidence.');
    }
    if (state.phase === 'accusation' && !announcedAccusation) {
      announcedAccusation = true;
      const line = (state.chatLines || []).slice().reverse().find(item => item.source === 'bot' && item.text.startsWith('Final vote:'));
      if (line && Date.now() - line.at <= 3000) await say('03 · SIMULATED CASE', 'The final accusation opens.');
    }
    if (state.revealed && !announcedAccusation) {
      announcedAccusation = true;
      const line = (state.chatLines || []).slice().reverse().find(item => item.source === 'bot' && item.text.startsWith('Final vote:'));
      if (line && Date.now() - line.at <= 3000) await say('03 · SIMULATED CASE', 'The final accusation opens.');
    }
    if (state.revealed && !announcedReveal) {
      announcedReveal = true;
      await say('03 · SIMULATED CASE', `${state.suspects[state.solution.suspect].name} is revealed. ${state.accusationResult.percent}% voted right.`);
      await pause(6000);
      return;
    }
    await pause(350);
  }
  const finalState = await get(`${simOrigin}/state`);
  if (finalState.revealed) { await say('03 · SIMULATED CASE', `${finalState.suspects[finalState.solution.suspect].name} is revealed. ${finalState.accusationResult.percent}% voted right.`); await pause(6000); return; }
  await say('03 · SIMULATED CASE', 'The simulated case exceeded its recording time cap before the reveal.');
}
async function codexBuild() {
  logStep(4, 'Built with OpenAI Codex');
  $('screen').innerHTML = `<div class="title-screen"><div class="eyebrow">THE BUILD RECORD</div><h1>One thread.<br><span id="passCount">Passes.</span></h1><p>From a written game spec to a working Twitch mystery, refined against real runs.</p><div class="build-intro">The project was built with OpenAI Codex from SPEC.md. The build log records the first live Twitch session and this showcase refinement.</div></div>`;
  const log = await get('/build-log.json');
  $('passCount').textContent = `${log.passes.length} passes.`;
  async function narrateBuild() {
    await say('04 · CODEX BUILD', `One Codex thread; ${log.passes.length} passes from a written spec.`);
    await say('04 · CODEX BUILD', 'A live EventSub receive bug was found and fixed.');
    await say('04 · CODEX BUILD', 'Thirty-five tests pass.');
  }
  const narration = narrateBuild();
  for (const [index, pass] of log.passes.entries()) {
    $('side').innerHTML = `<h2>CODEX BUILD LOG · PASS ${index + 1} / ${log.passes.length}</h2><div class="thread">THREAD ${safe(log.thread)}</div><article class="docket"><b>ASKED</b><p>${safe(pass.asked)}</p><b style="margin-top:15px">RESULT</b><p>${safe(pass.result)}</p></article>`;
    await pause(3000);
  }
  await narration;
}
async function finish() {
  logStep(5, 'End');
  await say('05 · END', 'github.com/ai-q-labs/chat-detective. Run npm run sim to try it without Twitch.');
  document.title = 'Tour finished: stop recording';
  $('topMode').textContent = 'TOUR FINISHED · STOP RECORDING';
  $('stepCount').textContent = '· COMPLETE';
}
async function startTour() {
  openChatPopupFromGesture();
  simFramesPromise = preloadSimFrames();
  $('cover').remove();
  tourStartedAt = Date.now();
  tourDeadlineAt = tourStartedAt + 169000;
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
  try {
    await intro(); await liveTwitch(); await simulatedCase(); await codexBuild(); await finish();
  } catch (error) {
    clearInterval(liveChatPollTimer); liveChatPollTimer = null;
    closeChatPopup();
    console.error('[tour] failed', error);
    caption('TOUR ERROR', `Showcase stopped: ${error.message}`);
  }
}
fit(); addEventListener('resize', fit);
$('start').addEventListener('click', startTour);
