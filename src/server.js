const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const caseData = require('../cases/trophy-at-table-nine.json');
const { createGame } = require('./game');

const sim = process.argv.includes('--sim') || process.env.SIM === '1';
const port = Number(process.env.PORT || 3000);
const game = createGame(caseData, { voteSeconds: Number(process.env.VOTE_SECONDS || 30), simulated: sim });
const clients = new Set(); const chatLines = []; const chatQueue = [];
let twitch; let chatSending = false;
async function drainChatQueue() {
  if (chatSending || !twitch || !chatQueue.length) return;
  chatSending = true;
  const message = chatQueue.shift();
  try {
    const response = await twitch.sendChat(message);
    if (response.ok) appendChatLine({ user: twitch.me.login || 'Chat Detective', text: message, source: 'bot', at: Date.now() });
    else console.error(`Twitch chat send failed (HTTP ${response.status}).`);
  } catch (error) { console.error(`Twitch chat send failed: ${error.message}`); }
  setTimeout(() => { chatSending = false; drainChatQueue(); }, 1000);
}
function state() { return { ...game.state(), chatLines: chatLines.slice(-20), serverNow: Date.now() }; }
function appendChatLine(line) { chatLines.push(line); if (chatLines.length > 20) chatLines.shift(); }
function dispatch(event) {
  if (event.type === 'chat') {
    appendChatLine({ user: event.user || 'anonymous', text: event.text || '', source: sim ? 'sim' : 'twitch', at: Date.now() });
  }
  const effects = game.handle(event);
  for (const effect of effects) {
    if (effect.say) {
      console.log(`CHAT: ${effect.say}`);
      if (twitch) { chatQueue.push(effect.say); drainChatQueue(); }
      else appendChatLine({ user: 'Chat Detective', text: effect.say, source: 'bot', at: Date.now() });
    }
    if (effect.broadcast) for (const res of clients) if (!res.destroyed) res.write(`data: ${JSON.stringify({ ...effect.broadcast, chatLines: chatLines.slice(-20), serverNow: Date.now() })}\n\n`);
  }
  return effects;
}

const overlayPath = path.join(__dirname, 'overlay.html');

const control = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Chat Detective · Host desk</title><style>:root{--bg:#1b1e1f;--panel:#262b2c;--paper:#eee5d2;--gold:#e3b55e;--muted:#b8b4aa}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 20% 0,#34312b,#1b1e1f 58%);color:#f3ede1;font:20px/1.4 system-ui,sans-serif;max-width:1200px;margin:0 auto;padding:28px}h1,h2{font-family:ui-monospace,Consolas,monospace}h1{font-size:32px;color:var(--gold);margin:0 0 5px}.sub{font:700 16px ui-monospace,Consolas,monospace;letter-spacing:.12em;color:#bcb4a5}.status{display:grid;grid-template-columns:1fr auto;gap:15px;background:#262b2c;border:1px solid #514a3d;padding:18px;border-radius:12px;margin:20px 0}.phase{font-size:28px}.clock{font:700 32px ui-monospace,Consolas,monospace;color:var(--gold)}.counts,.chatlog,.chatbox{background:var(--panel);border:1px solid #454849;border-radius:12px;padding:18px;margin:13px 0}.counts h2,.chatlog h2,.chatbox h2{font-size:23px;margin:0 0 12px}.voterow{display:grid;grid-template-columns:minmax(200px,1fr) 2fr 55px;gap:10px;align-items:center;margin:8px 0}.track{height:12px;background:#4b4e4d;border-radius:9px;overflow:hidden}.track i{display:block;height:100%;background:linear-gradient(90deg,#b8783b,#edc96f);transition:width .45s}.buttons,.quick{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}button{font:700 22px system-ui;border:0;border-radius:9px;padding:13px 20px;background:var(--gold);color:#211c14;cursor:pointer}button.secondary{background:#485052;color:white}button:hover{filter:brightness(1.1)}.chatbox{display:none}.sim .chatbox{display:block}.entry{display:flex;gap:9px}.entry input{font:20px system-ui;background:#171a1b;color:white;border:1px solid #606362;padding:12px;border-radius:8px;min-width:0}.entry #username{width:200px}.entry #message{flex:1}.quick button{font:700 18px ui-monospace,Consolas,monospace;padding:9px 13px;background:#465052;color:#f4eee3}.chatlog{max-height:340px;overflow:auto}.line{padding:5px 0;border-bottom:1px solid #414546;font-size:18px}.line b{color:var(--gold)}.line em{color:#a6a49e;font-style:normal;font-size:15px}.simtag{color:var(--gold);font:700 16px ui-monospace,Consolas,monospace}</style></head><body><div class="sub">THE HOST DESK · CASE BOARD CONTROL</div><h1>Chat Detective</h1><div class="simtag" id="mode"></div><section class="status"><div><div class="phase" id="phase"></div><div id="round"></div></div><div class="clock" id="clock">—</div></section><section class="counts"><h2>LIVE VOTES</h2><div id="votes"></div></section><div class="buttons"><button onclick="host('next')">Next / Advance</button><button onclick="host('reveal')">Reveal</button><button class="secondary" onclick="host('reset')">Reset case</button></div><section class="chatbox"><h2>SIMULATED CHAT · Send as a viewer</h2><div class="entry"><input id="username" value="viewer1" aria-label="Username"><input id="message" placeholder="Type a command" aria-label="Message"><button onclick="send()">Send</button></div><div class="quick" id="quick"></div></section><section class="chatlog"><h2>LAST 20 CHAT LINES</h2><div id="lines"></div></section><script>const sim=${sim},$=id=>document.getElementById(id);if(sim){document.body.classList.add('sim');$('mode').textContent='SIMULATED CHAT'}let current;const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));async function host(action){const r=await fetch('/host',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})});if(r.ok)refresh()}async function post(text){await fetch('/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:$('username').value,text})})}function send(){post($('message').value);$('message').value=''}function render(s){if(!s)return;current=s;$('phase').textContent='Phase: '+s.phase.toUpperCase();$('round').textContent='Round '+s.round+' · Evidence: '+(s.evidence||[]).map(e=>e.id).join(', ');const seconds=s.deadline?Math.max(0,Math.ceil((s.deadline-(s.serverNow||Date.now()))/1000)):null;$('clock').textContent=seconds===null?'—':seconds+'s';const key=s.currentBallot;const counts=key?s.votes[key]||{}:{};const choices=key==='search'?(s.locations||[]).filter(l=>!s.searched.includes(l.id)).map(l=>[l.id,l.name]):key==='ask'||key==='accusation'?Object.entries(s.suspects||{}).map(([k,v])=>[k,v.name]):[];$('votes').innerHTML=choices.length?choices.map(([id,name])=>{const n=counts[id]||0,max=Math.max(1,...Object.values(counts));return '<div class="voterow"><span>'+escapeHtml(id)+' · '+escapeHtml(name)+'</span><div class="track"><i style="width:'+Math.round(n/max*100)+'%"></i></div><b>'+n+'</b></div>'}).join(''):'No active vote';$('lines').innerHTML=(s.chatLines||[]).slice(-20).reverse().map(l=>'<div class="line"><b>'+escapeHtml(l.user)+'</b>: '+escapeHtml(l.text)+' <em>'+escapeHtml(l.source)+'</em></div>').join('')||'<div class="line">No chat lines yet.</div>';if(sim){let commands=[];if(s.phase==='search')commands=(s.locations||[]).filter(l=>!s.searched.includes(l.id)).map(l=>'!search '+l.id);if(s.phase==='question')commands=Object.keys(s.suspects).map(k=>'!ask '+k);if(s.phase==='objection')commands=(s.locations||[]).map(l=>'!contradict '+l.evidence.id);if(s.phase==='accusation')commands=Object.keys(s.suspects).map(k=>'!accuse '+k);$('quick').replaceChildren();commands.forEach(c=>{const b=document.createElement('button');b.textContent=c;b.addEventListener('click',()=>post(c));$('quick').append(b)})}}$('message').addEventListener('keydown',e=>{if(e.key==='Enter')send()});const es=new EventSource('/events');es.onmessage=e=>{try{render(JSON.parse(e.data))}catch(err){console.error('Invalid state event',err)}};es.onerror=()=>{$('phase').textContent='Reconnecting to live state…'};async function refresh(){try{const r=await fetch('/state',{cache:'no-store'});if(r.ok)render(await r.json())}catch{}}refresh();setInterval(refresh,1000);</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/overlay') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(overlayPath)); }
  if (req.method === 'GET' && url.pathname === '/overlay.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); return res.end(fs.readFileSync(path.join(__dirname, 'overlay.js'))); }
  if (req.method === 'GET' && url.pathname === '/control') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(control); }
  if (req.method === 'GET' && url.pathname === '/events') { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); res.flushHeaders?.(); clients.add(res); res.write(`data: ${JSON.stringify(state())}\n\n`); res.on('close', () => clients.delete(res)); return; }
  if (req.method === 'GET' && url.pathname === '/state') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(state())); }
  if (req.method === 'GET' && url.pathname === '/case') { const c = { ...caseData }; if (!game.state().revealed) delete c.solution; res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(c)); }
  if (req.method === 'POST' && ['/host', '/chat'].includes(url.pathname)) {
    let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 100_000) req.destroy(); });
    req.on('end', () => { try { const data = JSON.parse(body || '{}'); dispatch(url.pathname === '/host' ? { type: 'host', action: data.action } : { type: 'chat', user: data.user, text: data.text, isHost: false }); res.writeHead(204); res.end(); } catch { res.writeHead(400); res.end(); } }); return;
  }
  res.writeHead(404); res.end('Not found');
});
let tickTimer;
function start({ quiet = false } = {}) {
  if (server.listening) return Promise.resolve(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(port, () => { server.removeListener('error', reject); tickTimer = setInterval(() => dispatch({ type: 'tick', now: Date.now() }), 250); if (!quiet) console.log(`Chat Detective ${sim ? '(simulation)' : '(Twitch)'} listening at http://localhost:${port}`); if (!sim) startTwitch(); resolve(server); });
  });
}
async function startTwitch() {
  try { const { createTwitch } = require('./twitch'); twitch = await createTwitch(process.env.TWITCH_CLIENT_ID, process.env.TWITCH_CHANNEL, message => dispatch({ type: 'chat', ...message }), console.log); }
  catch (error) { console.error(error.message); }
}
function stop() { clearInterval(tickTimer); twitch?.close(); for (const res of clients) res.end(); clients.clear(); return new Promise(resolve => server.close(() => resolve())); }
if (require.main === module) start();
process.on('SIGINT', () => stop().then(() => process.exit(0)));
module.exports = { server, start, stop, dispatch, state };
