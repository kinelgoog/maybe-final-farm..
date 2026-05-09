const SteamUser = require('steam-user');
const express = require('express');
const path = require('path');

const LOGIN = process.env.STEAM_LOGIN || '';
const PASS  = process.env.STEAM_PASSWORD || '';
const APPS  = (process.env.APP_IDS || '730').split(',').map(Number);
const PORT  = process.env.PORT || 3000;

const client = new SteamUser({ promptSteamGuardCode: false, autoRelogin: true });
const app = express();

const state = {
  status: 'connecting',
  loggedIn: false,
  username: '',
  startTime: null,
};

// ── Steam events ──────────────────────────────────────────────
client.on('loggedOn', () => {
  console.log(`Logged in as: ${client.steamID}`);
  state.loggedIn  = true;
  state.status    = 'idling';
  state.username  = LOGIN;
  state.startTime = Date.now();
  client.setPersona(SteamUser.EPersonaState.Offline);
  client.gamesPlayed(APPS);
});

client.on('steamGuard', (domain, cb) => {
  // Steam Guard отключён — просто передаём пустой код чтобы не зависнуть
  console.log('Steam Guard triggered (should not happen if disabled)');
  cb('');
});

client.on('error', (err) => {
  console.error('Steam error:', err.message);
  state.loggedIn = false;
  state.status   = 'error: ' + err.message;
});

client.on('disconnected', (eresult, msg) => {
  console.log('Disconnected:', msg);
  state.loggedIn = false;
  state.status   = 'reconnecting';
});

// Логинимся
function doLogin() {
  console.log('Logging in...');
  state.status = 'connecting';
  client.logOn({ accountName: LOGIN, password: PASS });
}

doLogin();

// ── Web server ────────────────────────────────────────────────
app.use(express.json());

app.get('/', (req, res) => res.send(HTML));

app.get('/status', (req, res) => res.json({
  loggedIn:  state.loggedIn,
  status:    state.status,
  username:  state.username,
  startTime: state.startTime,
}));

app.get('/health', (req, res) => res.json({ ok: true, loggedIn: state.loggedIn }));

app.listen(PORT, () => console.log(`Web server on port ${PORT}`));

// ── HTML ──────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Steam Idler</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;overflow:hidden;cursor:none}
canvas{position:fixed;top:0;left:0;z-index:0;pointer-events:none}
.cursor{position:fixed;width:7px;height:7px;background:#fff;border-radius:50%;pointer-events:none;z-index:9999;transform:translate(-50%,-50%)}
.cursor-ring{position:fixed;width:26px;height:26px;border:1px solid rgba(255,255,255,0.35);border-radius:50%;pointer-events:none;z-index:9998;transform:translate(-50%,-50%);transition:all .12s ease}
.scene{position:relative;z-index:1;perspective:900px}
.card{background:rgba(0,0,0,0.72);border:1px solid rgba(255,255,255,0.11);border-radius:22px;padding:40px 36px;width:340px;text-align:center;backdrop-filter:blur(20px);transform-style:preserve-3d;transition:transform .12s ease;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;inset:0;border-radius:22px;background:radial-gradient(ellipse at 50% 0%,rgba(255,255,255,0.055) 0%,transparent 65%);pointer-events:none}
.star-icon{font-size:30px;margin-bottom:14px;display:block;filter:drop-shadow(0 0 10px rgba(255,255,255,0.5))}
h1{font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;margin-bottom:5px}
.sub{font-size:10px;color:rgba(255,255,255,0.32);font-family:'Space Mono',monospace;letter-spacing:2px;margin-bottom:24px}
.pill{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.09);border-radius:100px;padding:6px 15px;font-family:'Space Mono',monospace;font-size:10px;color:rgba(255,255,255,0.38);margin-bottom:22px}
.dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.22)}
.dot.active{background:#4ade80;box-shadow:0 0 8px #4ade80;animation:pulse 2s infinite}
.dot.pending{background:#facc15;box-shadow:0 0 8px #facc15;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
.hours-label{font-family:'Space Mono',monospace;font-size:9px;color:rgba(255,255,255,0.25);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px}
.hours-big{font-size:50px;font-weight:800;color:#fff;line-height:1;letter-spacing:-3px}
.hours-unit{font-size:10px;color:rgba(255,255,255,0.25);margin-top:3px;font-family:'Space Mono',monospace;letter-spacing:1px}
.uptime-bar-wrap{margin-top:14px;background:rgba(255,255,255,0.05);border-radius:100px;height:3px;overflow:hidden}
.uptime-bar{height:100%;background:#4ade80;border-radius:100px;box-shadow:0 0 6px #4ade80;transition:width 1s ease}
.uptime-lbl{display:flex;justify-content:space-between;margin-top:5px}
.uptime-lbl span{font-family:'Space Mono',monospace;font-size:8px;color:rgba(255,255,255,0.2);letter-spacing:1px}
.divider{border:none;border-top:1px solid rgba(255,255,255,0.07);margin:18px 0}
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.stat{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:13px 10px;text-align:center}
.stat-val{font-size:17px;font-weight:800;color:#fff;letter-spacing:-0.5px}
.stat-lbl{font-family:'Space Mono',monospace;font-size:8px;color:rgba(255,255,255,0.23);letter-spacing:1.5px;text-transform:uppercase;margin-top:3px}
.user-row{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:16px}
.avatar{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff}
.username{font-size:13px;font-weight:700;color:#fff}
.view{display:none}.view.active{display:block}
</style>
</head>
<body>
<div class="cursor" id="cur"></div>
<div class="cursor-ring" id="ring"></div>
<canvas id="c"></canvas>
<div class="scene" id="scene">
<div class="card" id="card">
  <span class="star-icon">&#10027;</span>
  <h1>Steam Idler</h1>
  <p class="sub">CS2 // HOUR FARMER</p>

  <div id="v-connecting" class="view active">
    <div class="pill"><span class="dot pending"></span><span id="conn-txt">подключаемся...</span></div>
  </div>

  <div id="v-online" class="view">
    <div class="user-row">
      <div class="avatar" id="av">?</div>
      <span class="username" id="uname">—</span>
    </div>
    <div class="pill"><span class="dot active"></span><span>фарм идёт · offline</span></div>
    <div class="hours-label">нафармлено этой сессией</div>
    <div class="hours-big" id="hv">0.00</div>
    <div class="hours-unit">часов</div>
    <div class="uptime-bar-wrap"><div class="uptime-bar" id="ubar" style="width:0%"></div></div>
    <div class="uptime-lbl"><span>сессия</span><span id="utime">0ч 0м</span></div>
    <hr class="divider">
    <div class="stats-grid">
      <div class="stat"><div class="stat-val" id="s-days">0</div><div class="stat-lbl">дней онлайн</div></div>
      <div class="stat"><div class="stat-val" id="s-total">0.00</div><div class="stat-lbl">часов сессии</div></div>
      <div class="stat"><div class="stat-val">730</div><div class="stat-lbl">app id</div></div>
      <div class="stat"><div class="stat-val" id="s-uptime">0</div><div class="stat-lbl">дней работы</div></div>
    </div>
  </div>
</div>
</div>
<script>
const cur=document.getElementById('cur'),ring=document.getElementById('ring');
document.addEventListener('mousemove',e=>{cur.style.left=e.clientX+'px';cur.style.top=e.clientY+'px';ring.style.left=e.clientX+'px';ring.style.top=e.clientY+'px'});
const canvas=document.getElementById('c'),ctx=canvas.getContext('2d');
let W,H,stars=[];
function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight;initStars()}
function mkStar(t){return{x:Math.random()*W,y:t?-20:Math.random()*H,size:2.2+Math.random()*3.8,speed:0.5+Math.random()*1.5,op:0.25+Math.random()*0.75,wb:Math.random()*Math.PI*2,ws:0.004+Math.random()*0.008,trail:[]}}
function initStars(){stars=[];for(let i=0;i<100;i++)stars.push(mkStar(false))}
function drawStar(cx,cy,r){const p=Math.PI;ctx.beginPath();for(let i=0;i<5;i++){const a=i*2*p/5-p/2,ai=(i*2+1)*p/5-p/2;ctx.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);ctx.lineTo(cx+Math.cos(ai)*r*0.42,cy+Math.sin(ai)*r*0.42)}ctx.closePath()}
function animate(){ctx.clearRect(0,0,W,H);stars.forEach(s=>{s.wb+=s.ws;s.x+=Math.sin(s.wb)*0.3;s.y+=s.speed;s.trail.push({x:s.x,y:s.y});if(s.trail.length>22)s.trail.shift();s.trail.forEach((pt,i)=>{const r=i/s.trail.length;ctx.save();ctx.globalAlpha=s.op*r*0.3;ctx.fillStyle='#fff';drawStar(pt.x,pt.y,s.size*r*0.65);ctx.fill();ctx.restore()});ctx.save();ctx.translate(s.x,s.y);ctx.rotate(s.wb);ctx.globalAlpha=s.op;ctx.fillStyle='#fff';drawStar(0,0,s.size);ctx.fill();ctx.restore();if(s.y>H+20)Object.assign(s,mkStar(true))});requestAnimationFrame(animate)}
resize();window.addEventListener('resize',resize);animate();
const card=document.getElementById('card'),scene=document.getElementById('scene');
scene.addEventListener('mousemove',e=>{const r=card.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;const dx=(e.clientX-cx)/r.width,dy=(e.clientY-cy)/r.height;card.style.transform=\`rotateY(\${dx*14}deg) rotateX(\${-dy*14}deg)\`});
scene.addEventListener('mouseleave',()=>{card.style.transform='rotateY(0) rotateX(0)'});
function showView(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.getElementById(id).classList.add('active')}
let sessionStart=null,timerInt=null;
function startTimer(ms){if(timerInt)clearInterval(timerInt);sessionStart=ms;timerInt=setInterval(updateStats,5000);updateStats()}
function updateStats(){if(!sessionStart)return;const h=(Date.now()-sessionStart)/3600000;document.getElementById('hv').textContent=h.toFixed(2);document.getElementById('s-total').textContent=h.toFixed(2);const tm=Math.floor(h*60),hh=Math.floor(tm/60),mm=tm%60;document.getElementById('utime').textContent=hh+'ч '+mm+'м';document.getElementById('ubar').style.width=Math.min(h/24*100,100)+'%';document.getElementById('s-days').textContent=Math.floor(h/24);document.getElementById('s-uptime').textContent=Math.floor(h/24)}
const map={idling:'фарм идёт',connecting:'подключаемся...',reconnecting:'переподключение...'};
async function poll(){
  try{
    const d=await fetch('/status').then(r=>r.json());
    if(d.loggedIn){
      showView('v-online');
      const n=d.username||'—';
      document.getElementById('uname').textContent=n;
      document.getElementById('av').textContent=(n[0]||'?').toUpperCase();
      if(!sessionStart)startTimer(d.startTime);
    } else {
      if(document.querySelector('.view.active')?.id==='v-online'){showView('v-connecting');sessionStart=null;if(timerInt)clearInterval(timerInt)}
      document.getElementById('conn-txt').textContent=map[d.status]||d.status;
    }
  }catch(e){}
  setTimeout(poll,3000);
}
poll();
</script>
</body>
</html>`;
