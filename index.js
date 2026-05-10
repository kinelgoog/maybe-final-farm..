const SteamUser = require('steam-user');
const express   = require('express');
const fs        = require('fs');
const https     = require('https');

const LOGIN      = process.env.STEAM_LOGIN    || '';
const PASS       = process.env.STEAM_PASSWORD || '';
const APPS       = (process.env.APP_IDS || '730, 322170, 4465480').split(',').map(Number);
const PORT       = process.env.PORT || 3000;
const STEAM_KEY  = process.env.STEAM_API_KEY  || '';
const STEAM_ID   = process.env.STEAM_ID       || '';
const DATA_FILE  = '/tmp/idler_data.json';

function loadData(){try{return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));}catch{return {};}}
function saveData(d){try{fs.writeFileSync(DATA_FILE,JSON.stringify(d,null,2));}catch{}}

let persisted = loadData();
if(!persisted.totalMs)    persisted.totalMs    = 0;
if(!persisted.sessions)   persisted.sessions   = [];
if(!persisted.lastOnline) persisted.lastOnline = null;
if(!persisted.uptimeDays) persisted.uptimeDays = [];

const state = {
  status:     'connecting',
  loggedIn:   false,
  username:   '',
  avatarUrl:  '',
  profileUrl: '',
  startTime:  null,
  idling:     true,
};

const ACHIEVEMENTS = [
  {id:'h1',   hours:1,   label:'1 час фарма',   icon:'⭐'},
  {id:'h10',  hours:10,  label:'10 часов фарма', icon:'🌟'},
  {id:'h50',  hours:50,  label:'50 часов фарма', icon:'💫'},
  {id:'h100', hours:100, label:'100 часов',      icon:'🏆'},
  {id:'h500', hours:500, label:'500 часов',      icon:'👑'},
];

function getTotalHours(){
  const cur = state.loggedIn && state.startTime ? (Date.now()-state.startTime) : 0;
  return (persisted.totalMs + cur) / 3600000;
}

function fetchProfile(){
  state.username  = 'afk.';
  state.avatarUrl = 'https://avatars.akamai.steamstatic.com/1c3cc1ada7d31eeb13536c50a053ad620f42f239_full.jpg';
  state.profileUrl= 'https://steamcommunity.com/profiles/76561199809677831';
  console.log('Profile hardcoded:', state.username);
}

let uptimeInterval=null;
function startUptimeTracking(){
  if(uptimeInterval)clearInterval(uptimeInterval);
  uptimeInterval=setInterval(()=>{
    if(!state.loggedIn)return;
    const today=new Date().toISOString().slice(0,10);
    const ex=persisted.uptimeDays.find(d=>d.date===today);
    if(ex)ex.upMs+=60000;else persisted.uptimeDays.push({date:today,upMs:60000});
    persisted.uptimeDays=persisted.uptimeDays.slice(-7);
    saveData(persisted);
  },60000);
}

function getUptimePercent(){
  if(!persisted.uptimeDays.length)return 0;
  const last7=persisted.uptimeDays.slice(-7);
  const totalPossible=last7.length*24*3600000;
  const totalUp=last7.reduce((s,d)=>s+d.upMs,0);
  return Math.min(100,Math.round(totalUp/totalPossible*100));
}

function saveSession(){
  if(!state.startTime)return;
  persisted.totalMs+=Date.now()-state.startTime;
  persisted.sessions.push({start:state.startTime,end:Date.now(),ms:Date.now()-state.startTime});
  persisted.sessions=persisted.sessions.slice(-20);
  saveData(persisted);
  state.startTime=null;
}

const client=new SteamUser({promptSteamGuardCode:false,autoRelogin:true});

client.on('loggedOn',()=>{
  console.log('Logged in!');
  state.loggedIn=true;state.status='idling';state.startTime=Date.now();
  persisted.lastOnline=Date.now();saveData(persisted);
  client.setPersona(SteamUser.EPersonaState.Offline);
  if(state.idling)client.gamesPlayed(APPS);
  fetchProfile();startUptimeTracking();
});

client.on('steamGuard',(domain,cb)=>cb(''));

client.on('error',err=>{
  console.error('Steam error:',err.message);
  saveSession();
  state.loggedIn=false;state.status='error: '+err.message;
});

client.on('disconnected',(eresult,msg)=>{
  console.log('Disconnected:',msg);
  saveSession();
  state.loggedIn=false;state.status='reconnecting';
});

client.logOn({accountName:LOGIN,password:PASS});

const app=express();
app.use(express.json());

app.get('/',(req,res)=>res.send(HTML));

app.get('/status',(req,res)=>{
  const totalHours=getTotalHours();
  const achieved=ACHIEVEMENTS.filter(a=>totalHours>=a.hours).map(a=>a.id);
  res.json({
    loggedIn:state.loggedIn,status:state.status,
    username:state.username,avatarUrl:state.avatarUrl,profileUrl:state.profileUrl,
    startTime:state.startTime,idling:state.idling,
    totalHours,uptimePercent:getUptimePercent(),
    lastOnline:persisted.lastOnline,
    sessions:persisted.sessions.slice(-10).reverse(),
    achieved,
  });
});

app.post('/stop',(req,res)=>{state.idling=false;client.gamesPlayed([]);console.log('Stopped');res.json({ok:true});});
app.post('/start',(req,res)=>{state.idling=true;if(state.loggedIn)client.gamesPlayed(APPS);console.log('Started');res.json({ok:true});});
app.get('/health',(req,res)=>res.json({ok:true}));

app.listen(PORT,()=>console.log(`Server on port ${PORT}`));

const HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>фармилка часов</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #080808;
  --card: #111111;
  --card-border: rgba(255,255,255,0.08);
  --card-highlight: rgba(255,255,255,0.04);
  --text: #f2f2f2;
  --muted: rgba(255,255,255,0.38);
  --dim: rgba(255,255,255,0.14);
  --green: #22c55e;
  --green-glow: rgba(34,197,94,0.2);
  --red: #ef4444;
  --yellow: #eab308;
  --mono: 'DM Mono', monospace;
  --sans: 'DM Sans', sans-serif;
}
.light {
  --bg: #f7f7f5;
  --card: #ffffff;
  --card-border: rgba(0,0,0,0.08);
  --card-highlight: rgba(0,0,0,0.02);
  --text: #0f0f0f;
  --muted: rgba(0,0,0,0.42);
  --dim: rgba(0,0,0,0.14);
  --green: #16a34a;
  --green-glow: rgba(22,163,74,0.12);
  --red: #dc2626;
  --yellow: #ca8a04;
}
*, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
html { -webkit-font-smoothing: antialiased; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: none;
  transition: background .4s, color .4s;
}
canvas { position:fixed; inset:0; z-index:0; pointer-events:none; }
.cursor { position:fixed; width:6px; height:6px; background:var(--text); border-radius:50%; pointer-events:none; z-index:9999; transform:translate(-50%,-50%); transition:transform .1s; }
.cursor-ring { position:fixed; width:24px; height:24px; border:1px solid var(--dim); border-radius:50%; pointer-events:none; z-index:9998; transform:translate(-50%,-50%); transition:left .08s, top .08s; }

/* Corner controls */
.corner { position:fixed; z-index:200; display:flex; align-items:center; gap:6px; padding:8px 12px; background:var(--card); border:1px solid var(--card-border); border-radius:10px; cursor:none; font-family:var(--mono); font-size:11px; color:var(--muted); transition:all .2s; backdrop-filter:blur(12px); }
.corner:hover { color:var(--text); border-color:var(--dim); }
#c-ach { top:16px; left:16px; }
#c-theme { top:16px; right:16px; }
.corner svg { width:14px; height:14px; flex-shrink:0; }

/* Achievement panel */
.ach-panel {
  position:fixed; top:52px; left:16px; z-index:199;
  background:var(--card); border:1px solid var(--card-border);
  border-radius:16px; padding:18px; width:270px;
  backdrop-filter:blur(20px); display:none;
  max-height:75vh; overflow-y:auto;
}
.ach-panel.open { display:block; }
.ach-head { font-size:10px; font-family:var(--mono); color:var(--muted); letter-spacing:.12em; text-transform:uppercase; margin-bottom:16px; }
.ach-item { margin-bottom:14px; }
.ach-row { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
.ach-ico { width:28px; height:28px; flex-shrink:0; }
.ach-ico svg { width:28px; height:28px; }
.ach-name { font-size:12px; font-weight:600; color:var(--text); }
.ach-sub { font-size:10px; font-family:var(--mono); color:var(--muted); margin-top:1px; }
.ach-track { background:var(--card-highlight); border:1px solid var(--card-border); border-radius:100px; height:3px; overflow:hidden; }
.ach-fill { height:100%; border-radius:100px; transition:width 1s ease; }
.ach-fill.done { background:var(--green); }
.ach-fill.pend { background:var(--dim); }
.ach-item.done .ach-name { color:var(--green); }

/* Main scene */
.scene { position:relative; z-index:1; width:100%; max-width:360px; padding:16px; perspective:1000px; }
.card {
  background:var(--card);
  border:1px solid var(--card-border);
  border-radius:20px;
  overflow:hidden;
  transform-style:preserve-3d;
  transition:transform .12s ease, background .4s, border-color .4s;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.03), 0 24px 48px rgba(0,0,0,0.4);
}
.light .card { box-shadow: 0 0 0 1px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.08); }

/* Card header strip */
.card-header {
  padding:20px 20px 0;
  display:flex; align-items:center; justify-content:space-between;
}
.brand { display:flex; align-items:center; gap:8px; }
.brand-dot { width:7px; height:7px; border-radius:50%; background:var(--green); box-shadow:0 0 8px var(--green-glow); animation:pulse 2s infinite; }
.brand-dot.off { background:var(--red); box-shadow:0 0 8px rgba(239,68,68,0.2); animation:none; }
.brand-dot.pend { background:var(--yellow); box-shadow:0 0 8px rgba(234,179,8,0.2); animation:pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
.brand-name { font-size:12px; font-weight:600; color:var(--text); letter-spacing:-.01em; }
.brand-sub { font-size:10px; font-family:var(--mono); color:var(--muted); }

/* Status badge */
.badge { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; background:var(--card-highlight); border:1px solid var(--card-border); border-radius:100px; font-family:var(--mono); font-size:10px; color:var(--muted); }

/* Card body */
.card-body { padding:16px 20px 20px; }

/* User row */
.user-row { display:flex; align-items:center; gap:10px; margin-bottom:16px; padding:12px; background:var(--card-highlight); border:1px solid var(--card-border); border-radius:12px; }
.avatar { width:36px; height:36px; border-radius:10px; object-fit:cover; background:var(--card-highlight); border:1px solid var(--card-border); }
.avatar-ph { width:36px; height:36px; border-radius:10px; background:var(--card-highlight); border:1px solid var(--card-border); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; color:var(--muted); flex-shrink:0; }
.user-info { flex:1; min-width:0; }
.user-name { font-size:13px; font-weight:600; color:var(--text); text-decoration:none; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.user-name:hover { color:var(--green); }
.user-badge { margin-top:3px; }

/* Hours display */
.hours-block { text-align:center; padding:8px 0 12px; }
.hours-label { font-size:10px; font-family:var(--mono); color:var(--muted); letter-spacing:.1em; text-transform:uppercase; margin-bottom:4px; }
.hours-num { font-size:52px; font-weight:700; color:var(--text); letter-spacing:-.04em; line-height:1; font-variant-numeric:tabular-nums; }
.hours-unit { font-size:11px; font-family:var(--mono); color:var(--muted); margin-top:4px; }

/* Progress bar */
.prog-wrap { background:var(--card-highlight); border-radius:100px; height:2px; margin-bottom:4px; overflow:hidden; }
.prog-bar { height:100%; background:var(--green); border-radius:100px; transition:width 1s ease; }
.prog-labels { display:flex; justify-content:space-between; }
.prog-labels span { font-size:9px; font-family:var(--mono); color:var(--dim); }

/* Divider */
.div { border:none; border-top:1px solid var(--card-border); margin:14px 0; }

/* Stats grid */
.stats { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px; }
.stat { padding:12px; background:var(--card-highlight); border:1px solid var(--card-border); border-radius:12px; }
.stat-v { font-size:18px; font-weight:700; color:var(--text); letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
.stat-l { font-size:9px; font-family:var(--mono); color:var(--muted); text-transform:uppercase; letter-spacing:.08em; margin-top:3px; }

/* Info rows */
.info { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
.info-k { font-size:11px; color:var(--muted); }
.info-v { font-size:11px; font-family:var(--mono); color:var(--text); }

/* Sessions */
.sec-title { font-size:10px; font-family:var(--mono); color:var(--muted); letter-spacing:.1em; text-transform:uppercase; margin-bottom:8px; }
.sess { display:flex; justify-content:space-between; align-items:center; padding:7px 0; border-bottom:1px solid var(--card-border); }
.sess:last-child { border:none; }
.sess-d { font-size:10px; font-family:var(--mono); color:var(--muted); }
.sess-h { font-size:10px; font-family:var(--mono); font-weight:500; color:var(--text); }
.no-data { font-size:10px; font-family:var(--mono); color:var(--dim); }

/* Controls */
.ctrl { display:flex; gap:8px; margin-top:14px; }
.ctrl-btn { flex:1; padding:11px; border:none; border-radius:10px; font-family:var(--sans); font-size:13px; font-weight:600; cursor:none; transition:all .18s; letter-spacing:-.01em; }
.ctrl-btn:active { transform:scale(.97); }
#b-stop { background:rgba(239,68,68,0.12); color:var(--red); border:1px solid rgba(239,68,68,0.2); }
#b-stop:hover { background:rgba(239,68,68,0.18); }
#b-start { background:rgba(34,197,94,0.12); color:var(--green); border:1px solid rgba(34,197,94,0.2); }
#b-start:hover { background:rgba(34,197,94,0.18); }

/* Connecting screen */
.connecting { padding:40px 20px; text-align:center; }
.conn-icon { margin:0 auto 16px; width:40px; height:40px; border-radius:10px; background:var(--card-highlight); border:1px solid var(--card-border); display:flex; align-items:center; justify-content:center; }
.conn-title { font-size:15px; font-weight:600; color:var(--text); margin-bottom:6px; }
.conn-sub { font-size:12px; font-family:var(--mono); color:var(--muted); }

.view { display:none; }
.view.active { display:block; }
</style>
</head>
<body>
<div class="cursor" id="cur"></div>
<div class="cursor-ring" id="ring"></div>
<canvas id="c"></canvas>

<div class="corner" id="c-ach" onclick="toggleAch()">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 21h8M12 21v-4M6 3h12l-1 7a5 5 0 01-10 0L6 3z"/><path d="M6 8H4a2 2 0 000 4h2M18 8h2a2 2 0 010 4h-2"/></svg>
  достижения
</div>
<div class="corner" id="c-theme" onclick="toggleTheme()">
  <svg id="theme-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
  <span id="theme-lbl">светлая</span>
</div>

<div class="ach-panel" id="ach-panel">
  <div class="ach-head">достижения</div>
  <div id="ach-list"></div>
</div>

<div class="scene" id="scene">
  <div class="card" id="card">

    <div id="v-connecting" class="view active">
      <div class="connecting">
        <div class="conn-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" color="var(--muted)"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        </div>
        <div class="conn-title">фармилка часов:)</div>
        <div class="conn-sub" id="conn-txt">подключение к акку</div>
      </div>
    </div>

    <div id="v-online" class="view">
      <div class="card-header">
        <div class="brand">
          <div class="brand-dot" id="brand-dot"></div>
          <div>
            <div class="brand-name">фармилка часов:)</div>
            <div class="brand-sub">кс2, ксго и гд</div>
          </div>
        </div>
        <div class="badge" id="status-badge">автор — @itskinel</div>
      </div>

      <div class="card-body">
        <div class="user-row">
          <img class="avatar" id="av-img" src="" style="display:none" alt="">
          <div class="avatar-ph" id="av-ph">?</div>
          <div class="user-info">
            <a class="user-name" id="uname" href="#" target="_blank">—</a>
            <div class="user-badge">
              <div class="badge" style="margin-top:2px">в неведимке</div>
            </div>
          </div>
        </div>

        <div class="hours-block">
          <div class="hours-label">сессия</div>
          <div class="hours-num" id="hv">0.00</div>
          <div class="hours-unit">часов</div>
        </div>

        <div class="prog-wrap"><div class="prog-bar" id="pbar" style="width:0%"></div></div>
        <div class="prog-labels"><span>прогресс за сутки</span><span id="utime">0ч 0м</span></div>

        <hr class="div">

        <div class="stats">
          <div class="stat"><div class="stat-v" id="s-total">0.00</div><div class="stat-l">всего часов</div></div>
          <div class="stat"><div class="stat-v" id="s-up">0%</div><div class="stat-l">uptime 7д</div></div>
        </div>

        <div class="info"><span class="info-k">последний онлайн</span><span class="info-v" id="s-last">—</span></div>

        <hr class="div">

        <div class="sec-title">история сессий</div>
        <div id="sess-list"></div>

        <div class="ctrl">
          <button class="ctrl-btn" id="b-stop" onclick="stopFarm()">остановить фарм</button>
          <button class="ctrl-btn" id="b-start" onclick="startFarm()" style="display:none">запустить фарм</button>
        </div>
      </div>
    </div>

  </div>
</div>

<script>
// cursor
const cur=document.getElementById('cur'),ring=document.getElementById('ring');
document.addEventListener('mousemove',e=>{
  cur.style.left=e.clientX+'px';cur.style.top=e.clientY+'px';
  ring.style.left=e.clientX+'px';ring.style.top=e.clientY+'px';
});

// theme
let dark=localStorage.getItem('theme')!=='light';
function applyTheme(){
  document.body.classList.toggle('light',!dark);
  document.getElementById('theme-lbl').textContent=dark?'светлая':'тёмная';
  document.getElementById('theme-ico').innerHTML=dark
    ?'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'
    :'<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
}
function toggleTheme(){dark=!dark;localStorage.setItem('theme',dark?'dark':'light');applyTheme();}
applyTheme();

// stars
const canvas=document.getElementById('c'),ctx=canvas.getContext('2d');
let W,H,stars=[];
function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight;initStars();}
function mkStar(t){return{x:Math.random()*W,y:t?-20:Math.random()*H,size:1.8+Math.random()*3.2,speed:0.4+Math.random()*1.3,op:0.15+Math.random()*0.55,wb:Math.random()*Math.PI*2,ws:0.004+Math.random()*0.008,trail:[]};}
function initStars(){stars=[];for(let i=0;i<90;i++)stars.push(mkStar(false));}
function drawStar(cx,cy,r){const p=Math.PI;ctx.beginPath();for(let i=0;i<5;i++){const a=i*2*p/5-p/2,ai=(i*2+1)*p/5-p/2;ctx.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);ctx.lineTo(cx+Math.cos(ai)*r*0.42,cy+Math.sin(ai)*r*0.42);}ctx.closePath();}
function animate(){
  ctx.clearRect(0,0,W,H);
  const col=dark?'rgba(255,255,255,':'rgba(0,0,0,';
  stars.forEach(s=>{
    s.wb+=s.ws;s.x+=Math.sin(s.wb)*0.25;s.y+=s.speed;
    s.trail.push({x:s.x,y:s.y});if(s.trail.length>20)s.trail.shift();
    s.trail.forEach((pt,i)=>{const r=i/s.trail.length;ctx.save();ctx.globalAlpha=s.op*r*0.25;ctx.fillStyle=col+s.op*r*0.25+')';ctx.fillStyle=dark?'#fff':'#000';ctx.globalAlpha=s.op*r*0.25;drawStar(pt.x,pt.y,s.size*r*0.6);ctx.fill();ctx.restore();});
    ctx.save();ctx.translate(s.x,s.y);ctx.rotate(s.wb);ctx.globalAlpha=s.op;ctx.fillStyle=dark?'#fff':'#222';drawStar(0,0,s.size);ctx.fill();ctx.restore();
    if(s.y>H+20)Object.assign(s,mkStar(true));
  });
  requestAnimationFrame(animate);
}
resize();window.addEventListener('resize',resize);animate();

// parallax
const card=document.getElementById('card'),scene=document.getElementById('scene');
scene.addEventListener('mousemove',e=>{
  const r=card.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
  card.style.transform='rotateY('+(( e.clientX-cx)/r.width*10)+'deg) rotateX('+(-(e.clientY-cy)/r.height*10)+'deg)';
});
scene.addEventListener('mouseleave',()=>{card.style.transform='';});

// achievements
const ACHS=[
  {id:'h1',  hours:1,   name:'Первый час',    sub:'нафармить 1 час'},
  {id:'h10', hours:10,  name:'Десятка',       sub:'нафармить 10 часов'},
  {id:'h50', hours:50,  name:'Полтинник',     sub:'нафармить 50 часов'},
  {id:'h100',hours:100, name:'Сотка',         sub:'нафармить 100 часов'},
  {id:'h500',hours:500, name:'Легенда',       sub:'нафармить 500 часов'},
];
// SVG icons для каждого достижения
const ACH_ICONS={
  h1:'<svg viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="13" stroke="currentColor" stroke-width="1.5"/><path d="M14 8v6l4 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  h10:'<svg viewBox="0 0 28 28" fill="none"><path d="M14 4l2.5 7.5H24l-6.5 4.5 2.5 7.5L14 19l-6 4.5 2.5-7.5L4 11.5h7.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  h50:'<svg viewBox="0 0 28 28" fill="none"><path d="M14 3l3 8h8l-6.5 5 2.5 8L14 20l-7 4 2.5-8L3 11h8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="14" cy="14" r="3" stroke="currentColor" stroke-width="1.5"/></svg>',
  h100:'<svg viewBox="0 0 28 28" fill="none"><path d="M8 21V10l4-4h4l4 4v11H8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M11 21v-6h6v6" stroke="currentColor" stroke-width="1.5"/><path d="M14 6V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  h500:'<svg viewBox="0 0 28 28" fill="none"><path d="M14 3C8 3 3 8 3 14s5 11 11 11 11-5 11-11S20 3 14 3z" stroke="currentColor" stroke-width="1.5"/><path d="M14 8l1.5 4.5H20l-3.5 2.5 1.5 4.5L14 17l-4 2.5 1.5-4.5L8 12.5h4.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
};

function renderAch(totalHours,achieved){
  document.getElementById('ach-list').innerHTML=ACHS.map((a,i)=>{
    const done=achieved.includes(a.id);
    const prev=i>0?ACHS[i-1].hours:0;
    const pct=done?100:Math.max(0,Math.min(100,Math.round((totalHours-prev)/(a.hours-prev)*100)));
    const col=done?'var(--green)':'var(--muted)';
    return '<div class="ach-item '+(done?'done':'')+'">'+
      '<div class="ach-row">'+
        '<div class="ach-ico" style="color:'+col+'">'+ACH_ICONS[a.id]+'</div>'+
        '<div><div class="ach-name">'+a.name+'</div><div class="ach-sub">'+(done?'✓ выполнено':a.sub+' · '+totalHours.toFixed(1)+'/'+a.hours)+'</div></div>'+
      '</div>'+
      '<div class="ach-track"><div class="ach-fill '+(done?'done':'pend')+'" style="width:'+pct+'%"></div></div>'+
    '</div>';
  }).join('');
}

function toggleAch(){document.getElementById('ach-panel').classList.toggle('open');}
document.addEventListener('click',e=>{if(!e.target.closest('#ach-panel')&&!e.target.closest('#c-ach'))document.getElementById('ach-panel').classList.remove('open');});

// favicon
function setFav(color){
  const cv=document.createElement('canvas');cv.width=32;cv.height=32;
  const c=cv.getContext('2d');c.fillStyle=color;c.beginPath();c.arc(16,16,14,0,Math.PI*2);c.fill();
  let l=document.querySelector("link[rel~='icon']");
  if(!l){l=document.createElement('link');l.rel='icon';document.head.appendChild(l);}
  l.href=cv.toDataURL();
}

function showView(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.getElementById(id).classList.add('active');}

async function stopFarm(){
  await fetch('/stop',{method:'POST'});
  document.getElementById('b-stop').style.display='none';
  document.getElementById('b-start').style.display='';
  document.getElementById('brand-dot').className='brand-dot off';
  document.getElementById('status-badge').textContent='остановлен';
}
async function startFarm(){
  await fetch('/start',{method:'POST'});
  document.getElementById('b-start').style.display='none';
  document.getElementById('b-stop').style.display='';
  document.getElementById('brand-dot').className='brand-dot';
  document.getElementById('status-badge').textContent='фарм идёт';
}

let sessStart=null,tInt=null;
function startTimer(ms){if(tInt)clearInterval(tInt);sessStart=ms;tInt=setInterval(tick,5000);tick();}
function tick(){
  if(!sessStart)return;
  const h=(Date.now()-sessStart)/3600000;
  document.getElementById('hv').textContent=h.toFixed(2);
  const tm=Math.floor(h*60),hh=Math.floor(tm/60),mm=tm%60;
  document.getElementById('utime').textContent=hh+'ч '+mm+'м';
  document.getElementById('pbar').style.width=Math.min(h/24*100,100)+'%';
}

function fmtDate(ms){
  if(!ms)return'—';
  const d=new Date(ms);
  return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
}

function renderSess(sessions){
  const el=document.getElementById('sess-list');
  if(!sessions||!sessions.length){el.innerHTML='<div class="no-data">нет данных</div>';return;}
  el.innerHTML=sessions.map(s=>'<div class="sess"><span class="sess-d">'+fmtDate(s.start)+'</span><span class="sess-h">+'+( s.ms/3600000).toFixed(2)+' ч</span></div>').join('');
}

const SM={idling:'фарм идёт',connecting:'подключаемся...',reconnecting:'переподключение...'};
let prevLI=false;
async function poll(){
  try{
    const d=await fetch('/status').then(r=>r.json());
    if(d.loggedIn){
      showView('v-online');setFav('#22c55e');
      if(d.avatarUrl){
        const img=document.getElementById('av-img');
        if(img.src!==d.avatarUrl){img.src=d.avatarUrl;img.style.display='';document.getElementById('av-ph').style.display='none';}
      } else {
        document.getElementById('av-ph').textContent=(d.username||'?')[0].toUpperCase();
      }
      const un=document.getElementById('uname');un.textContent=d.username||'—';if(d.profileUrl)un.href=d.profileUrl;
      if(d.idling){
        document.getElementById('brand-dot').className='brand-dot';
        document.getElementById('status-badge').textContent='фарм идёт';
        document.getElementById('b-stop').style.display='';document.getElementById('b-start').style.display='none';
      } else {
        document.getElementById('brand-dot').className='brand-dot off';
        document.getElementById('status-badge').textContent='остановлен';
        document.getElementById('b-stop').style.display='none';document.getElementById('b-start').style.display='';
      }
      if(!sessStart&&d.startTime)startTimer(d.startTime);
      document.getElementById('s-total').textContent=d.totalHours.toFixed(2);
      document.getElementById('s-up').textContent=d.uptimePercent+'%';
      document.getElementById('s-last').textContent=fmtDate(d.lastOnline);
      renderSess(d.sessions);renderAch(d.totalHours,d.achieved);
    } else {
      if(prevLI){sessStart=null;if(tInt)clearInterval(tInt);}
      showView('v-connecting');setFav('#ef4444');
      document.getElementById('conn-txt').textContent=SM[d.status]||d.status;
    }
    prevLI=d.loggedIn;
  }catch(e){}
  setTimeout(poll,3000);
}
poll();
</script>
</body>
</html>`;
