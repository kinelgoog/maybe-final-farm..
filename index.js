const SteamUser = require('steam-user');
const express   = require('express');
const fs        = require('fs');
const https     = require('https');

const LOGIN      = process.env.STEAM_LOGIN    || '';
const PASS       = process.env.STEAM_PASSWORD || '';
const APPS       = (process.env.APP_IDS || '730').split(',').map(Number);
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
  if(!STEAM_KEY||!STEAM_ID)return;
  const url=`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_KEY}&steamids=${STEAM_ID}`;
  https.get(url,res=>{
    let raw='';
    res.on('data',d=>raw+=d);
    res.on('end',()=>{
      try{
        const p=JSON.parse(raw).response.players[0];
        if(p){state.username=p.personaname;state.avatarUrl=p.avatarfull;state.profileUrl=p.profileurl;console.log('Profile:',state.username);}
      }catch(e){console.error('Profile error:',e.message);}
    });
  }).on('error',e=>console.error('Profile error:',e.message));
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
<title>Steam Idler</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#000;--star:#fff;--card-bg:rgba(0,0,0,0.72);--card-border:rgba(255,255,255,0.11);--text:#fff;--sub:rgba(255,255,255,0.32);--pill-bg:rgba(255,255,255,0.05);--pill-border:rgba(255,255,255,0.09);--pill-text:rgba(255,255,255,0.38);--stat-bg:rgba(255,255,255,0.04);--stat-border:rgba(255,255,255,0.07);--stat-label:rgba(255,255,255,0.23);--div:rgba(255,255,255,0.07);--uptime-bg:rgba(255,255,255,0.05);--hours-label:rgba(255,255,255,0.25);--uptime-lbl:rgba(255,255,255,0.2)}
.light{--bg:#f0f0f0;--star:#111;--card-bg:rgba(255,255,255,0.85);--card-border:rgba(0,0,0,0.1);--text:#111;--sub:rgba(0,0,0,0.4);--pill-bg:rgba(0,0,0,0.05);--pill-border:rgba(0,0,0,0.1);--pill-text:rgba(0,0,0,0.5);--stat-bg:rgba(0,0,0,0.04);--stat-border:rgba(0,0,0,0.08);--stat-label:rgba(0,0,0,0.35);--div:rgba(0,0,0,0.08);--uptime-bg:rgba(0,0,0,0.06);--hours-label:rgba(0,0,0,0.35);--uptime-lbl:rgba(0,0,0,0.3)}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;overflow:hidden;cursor:none;transition:background .3s}
canvas{position:fixed;top:0;left:0;z-index:0;pointer-events:none}
.cursor{position:fixed;width:7px;height:7px;background:var(--star);border-radius:50%;pointer-events:none;z-index:9999;transform:translate(-50%,-50%)}
.cursor-ring{position:fixed;width:26px;height:26px;border:1px solid rgba(128,128,128,0.4);border-radius:50%;pointer-events:none;z-index:9998;transform:translate(-50%,-50%);transition:all .12s ease}
.corner-btn{position:fixed;z-index:100;background:var(--card-bg);border:1px solid var(--card-border);border-radius:12px;padding:8px 12px;cursor:none;font-size:16px;backdrop-filter:blur(10px);transition:all .2s;color:var(--text)}
.corner-btn:hover{transform:scale(1.08)}
#btn-achievements{top:16px;left:16px}
#btn-theme{top:16px;right:16px;font-size:12px;font-family:'Space Mono',monospace}
.achievements-panel{position:fixed;top:56px;left:16px;z-index:99;background:var(--card-bg);border:1px solid var(--card-border);border-radius:16px;padding:20px;width:260px;backdrop-filter:blur(20px);display:none;max-height:80vh;overflow-y:auto}
.achievements-panel.open{display:block}
.ach-title{font-size:10px;font-family:'Space Mono',monospace;color:var(--sub);letter-spacing:2px;text-transform:uppercase;margin-bottom:14px}
.ach-item{margin-bottom:14px}
.ach-row{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.ach-icon{font-size:16px}
.ach-label{font-size:12px;font-weight:700;color:var(--text)}
.ach-sublabel{font-size:9px;font-family:'Space Mono',monospace;color:var(--sub)}
.ach-bar-wrap{background:var(--uptime-bg);border-radius:100px;height:3px;overflow:hidden}
.ach-bar{height:100%;border-radius:100px;transition:width 1s ease}
.ach-bar.done{background:#4ade80;box-shadow:0 0 6px #4ade80}
.ach-bar.pending{background:rgba(128,128,128,0.25)}
.ach-item.unlocked .ach-label{color:#4ade80}
.scene{position:relative;z-index:1;perspective:900px}
.card{background:var(--card-bg);border:1px solid var(--card-border);border-radius:22px;padding:34px 30px;width:330px;text-align:center;backdrop-filter:blur(20px);transform-style:preserve-3d;transition:transform .12s ease,background .3s,border-color .3s;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;inset:0;border-radius:22px;background:radial-gradient(ellipse at 50% 0%,rgba(128,128,128,0.06) 0%,transparent 65%);pointer-events:none}
.star-icon{font-size:26px;margin-bottom:10px;display:block}
h1{font-size:20px;font-weight:800;color:var(--text);letter-spacing:-0.5px;margin-bottom:4px}
.sub{font-size:10px;color:var(--sub);font-family:'Space Mono',monospace;letter-spacing:2px;margin-bottom:18px}
.pill{display:inline-flex;align-items:center;gap:7px;background:var(--pill-bg);border:1px solid var(--pill-border);border-radius:100px;padding:6px 14px;font-family:'Space Mono',monospace;font-size:10px;color:var(--pill-text);margin-bottom:16px}
.dot{width:6px;height:6px;border-radius:50%;background:rgba(128,128,128,0.3)}
.dot.active{background:#4ade80;box-shadow:0 0 8px #4ade80;animation:pulse 2s infinite}
.dot.pending{background:#facc15;box-shadow:0 0 8px #facc15;animation:pulse 2s infinite}
.dot.stopped{background:#f87171;box-shadow:0 0 8px #f87171}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
.user-row{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:12px}
.avatar{width:34px;height:34px;border-radius:50%;border:1px solid var(--card-border);object-fit:cover;background:var(--stat-bg)}
.avatar-ph{width:34px;height:34px;border-radius:50%;background:var(--stat-bg);border:1px solid var(--card-border);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--text)}
.username{font-size:13px;font-weight:700;color:var(--text);text-decoration:none}
.username:hover{text-decoration:underline}
.hours-label{font-family:'Space Mono',monospace;font-size:9px;color:var(--hours-label);letter-spacing:2px;text-transform:uppercase;margin-bottom:3px}
.hours-big{font-size:44px;font-weight:800;color:var(--text);line-height:1;letter-spacing:-3px}
.hours-unit{font-size:10px;color:var(--hours-label);margin-top:2px;font-family:'Space Mono',monospace;letter-spacing:1px;margin-bottom:10px}
.uptime-bar-wrap{background:var(--uptime-bg);border-radius:100px;height:3px;overflow:hidden}
.uptime-bar{height:100%;background:#4ade80;border-radius:100px;box-shadow:0 0 6px #4ade80;transition:width 1s ease}
.uptime-lbl{display:flex;justify-content:space-between;margin-top:4px}
.uptime-lbl span{font-family:'Space Mono',monospace;font-size:8px;color:var(--uptime-lbl);letter-spacing:1px}
.divider{border:none;border-top:1px solid var(--div);margin:14px 0}
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:12px}
.stat{background:var(--stat-bg);border:1px solid var(--stat-border);border-radius:12px;padding:11px 8px;text-align:center}
.stat-val{font-size:16px;font-weight:800;color:var(--text);letter-spacing:-0.5px}
.stat-lbl{font-family:'Space Mono',monospace;font-size:8px;color:var(--stat-label);letter-spacing:1.5px;text-transform:uppercase;margin-top:3px}
.info-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px}
.info-label{font-family:'Space Mono',monospace;font-size:9px;color:var(--sub)}
.info-val{font-family:'Space Mono',monospace;font-size:9px;font-weight:700;color:var(--text)}
.sessions-title{font-family:'Space Mono',monospace;font-size:9px;color:var(--hours-label);letter-spacing:2px;text-transform:uppercase;margin-bottom:7px;text-align:left}
.session-item{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--div)}
.session-item:last-child{border-bottom:none}
.session-date{font-family:'Space Mono',monospace;font-size:9px;color:var(--sub)}
.session-hrs{font-family:'Space Mono',monospace;font-size:9px;font-weight:700;color:var(--text)}
.ctrl-row{display:flex;gap:8px;margin-top:4px}
.ctrl-btn{flex:1;padding:11px;border:none;border-radius:12px;font-family:'Syne',sans-serif;font-size:13px;font-weight:700;cursor:none;transition:all .2s}
.ctrl-btn:active{transform:scale(0.97)}
#btn-stop{background:#f87171;color:#fff}
#btn-stop:hover{background:#ef4444}
#btn-start{background:#4ade80;color:#000}
#btn-start:hover{background:#22c55e}
.view{display:none}.view.active{display:block}
</style>
</head>
<body>
<div class="cursor" id="cur"></div>
<div class="cursor-ring" id="ring"></div>
<canvas id="c"></canvas>
<button class="corner-btn" id="btn-achievements" onclick="toggleAch()">🏆</button>
<button class="corner-btn" id="btn-theme" onclick="toggleTheme()">☀️ светлая</button>
<div class="achievements-panel" id="ach-panel">
  <div class="ach-title">достижения</div>
  <div id="ach-list"></div>
</div>
<div class="scene" id="scene">
<div class="card" id="card">
  <span class="star-icon">✫</span>
  <h1>Steam Idler</h1>
  <p class="sub">CS2 // HOUR FARMER</p>
  <div id="v-connecting" class="view active">
    <div class="pill"><span class="dot pending"></span><span id="conn-txt">подключаемся...</span></div>
  </div>
  <div id="v-online" class="view">
    <div class="user-row">
      <img class="avatar" id="avatar-img" src="" style="display:none" alt="">
      <div class="avatar-ph" id="avatar-ph">?</div>
      <a class="username" id="uname" href="#" target="_blank">—</a>
    </div>
    <div class="pill">
      <span class="dot active" id="status-dot"></span>
      <span id="status-txt">фарм идёт · offline</span>
    </div>
    <div class="hours-label">сессия</div>
    <div class="hours-big" id="hv">0.00</div>
    <div class="hours-unit">часов</div>
    <div class="uptime-bar-wrap"><div class="uptime-bar" id="ubar" style="width:0%"></div></div>
    <div class="uptime-lbl"><span>прогресс за сутки</span><span id="utime">0ч 0м</span></div>
    <hr class="divider">
    <div class="stats-grid">
      <div class="stat"><div class="stat-val" id="s-total">0.00</div><div class="stat-lbl">всего часов</div></div>
      <div class="stat"><div class="stat-val" id="s-uptime">0%</div><div class="stat-lbl">uptime 7д</div></div>
    </div>
    <div class="info-row"><span class="info-label">последний онлайн</span><span class="info-val" id="last-online">—</span></div>
    <hr class="divider">
    <div class="sessions-title">история сессий</div>
    <div id="sessions-list"></div>
    <hr class="divider">
    <div class="ctrl-row">
      <button class="ctrl-btn" id="btn-stop" onclick="stopFarm()">⏹ стоп</button>
      <button class="ctrl-btn" id="btn-start" onclick="startFarm()" style="display:none">▶ старт</button>
    </div>
  </div>
</div>
</div>
<script>
const cur=document.getElementById('cur'),ring=document.getElementById('ring');
document.addEventListener('mousemove',e=>{cur.style.left=e.clientX+'px';cur.style.top=e.clientY+'px';ring.style.left=e.clientX+'px';ring.style.top=e.clientY+'px'});
let dark=localStorage.getItem('theme')!=='light';
function applyTheme(){document.body.classList.toggle('light',!dark);document.getElementById('btn-theme').textContent=dark?'☀️ светлая':'🌙 тёмная';}
function toggleTheme(){dark=!dark;localStorage.setItem('theme',dark?'dark':'light');applyTheme();}
applyTheme();
const canvas=document.getElementById('c'),ctx=canvas.getContext('2d');
let W,H,stars=[];
function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight;initStars();}
function mkStar(t){return{x:Math.random()*W,y:t?-20:Math.random()*H,size:2.2+Math.random()*3.8,speed:0.5+Math.random()*1.5,op:0.25+Math.random()*0.75,wb:Math.random()*Math.PI*2,ws:0.004+Math.random()*0.008,trail:[]};}
function initStars(){stars=[];for(let i=0;i<100;i++)stars.push(mkStar(false));}
function drawStar(cx,cy,r){const p=Math.PI;ctx.beginPath();for(let i=0;i<5;i++){const a=i*2*p/5-p/2,ai=(i*2+1)*p/5-p/2;ctx.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);ctx.lineTo(cx+Math.cos(ai)*r*0.42,cy+Math.sin(ai)*r*0.42);}ctx.closePath();}
function animate(){ctx.clearRect(0,0,W,H);const col=dark?'#fff':'#111';stars.forEach(s=>{s.wb+=s.ws;s.x+=Math.sin(s.wb)*0.3;s.y+=s.speed;s.trail.push({x:s.x,y:s.y});if(s.trail.length>22)s.trail.shift();s.trail.forEach((pt,i)=>{const r=i/s.trail.length;ctx.save();ctx.globalAlpha=s.op*r*0.3;ctx.fillStyle=col;drawStar(pt.x,pt.y,s.size*r*0.65);ctx.fill();ctx.restore();});ctx.save();ctx.translate(s.x,s.y);ctx.rotate(s.wb);ctx.globalAlpha=s.op;ctx.fillStyle=col;drawStar(0,0,s.size);ctx.fill();ctx.restore();if(s.y>H+20)Object.assign(s,mkStar(true));});requestAnimationFrame(animate);}
resize();window.addEventListener('resize',resize);animate();
const card=document.getElementById('card'),scene=document.getElementById('scene');
scene.addEventListener('mousemove',e=>{const r=card.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;const dx=(e.clientX-cx)/r.width,dy=(e.clientY-cy)/r.height;card.style.transform='rotateY('+(dx*14)+'deg) rotateX('+(-dy*14)+'deg)';});
scene.addEventListener('mouseleave',()=>{card.style.transform='rotateY(0) rotateX(0)';});
const ACHS=[{id:'h1',hours:1,label:'1 час фарма',icon:'⭐'},{id:'h10',hours:10,label:'10 часов фарма',icon:'🌟'},{id:'h50',hours:50,label:'50 часов фарма',icon:'💫'},{id:'h100',hours:100,label:'100 часов',icon:'🏆'},{id:'h500',hours:500,label:'500 часов',icon:'👑'}];
function renderAchievements(totalHours,achieved){const list=document.getElementById('ach-list');list.innerHTML='';ACHS.forEach((a,i)=>{const done=achieved.includes(a.id);const prev=i>0?ACHS[i-1].hours:0;const pct=done?100:Math.max(0,Math.min(100,Math.round((totalHours-prev)/(a.hours-prev)*100)));list.innerHTML+='<div class="ach-item '+(done?'unlocked':'')+'"><div class="ach-row"><span class="ach-icon">'+a.icon+'</span><div><div class="ach-label">'+a.label+'</div><div class="ach-sublabel">'+(done?'выполнено':totalHours.toFixed(1)+' / '+a.hours+' ч')+'</div></div></div><div class="ach-bar-wrap"><div class="ach-bar '+(done?'done':'pending')+'" style="width:'+pct+'%"></div></div></div>';});}
function toggleAch(){document.getElementById('ach-panel').classList.toggle('open');}
document.addEventListener('click',e=>{if(!e.target.closest('#ach-panel')&&!e.target.closest('#btn-achievements'))document.getElementById('ach-panel').classList.remove('open');});
function setFavicon(color){const cv=document.createElement('canvas');cv.width=32;cv.height=32;const c=cv.getContext('2d');c.fillStyle=color;c.beginPath();c.arc(16,16,14,0,Math.PI*2);c.fill();let link=document.querySelector("link[rel~='icon']");if(!link){link=document.createElement('link');link.rel='icon';document.head.appendChild(link);}link.href=cv.toDataURL();}
function showView(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.getElementById(id).classList.add('active');}
async function stopFarm(){await fetch('/stop',{method:'POST'});document.getElementById('btn-stop').style.display='none';document.getElementById('btn-start').style.display='';document.getElementById('status-dot').className='dot stopped';document.getElementById('status-txt').textContent='фарм остановлен';}
async function startFarm(){await fetch('/start',{method:'POST'});document.getElementById('btn-start').style.display='none';document.getElementById('btn-stop').style.display='';document.getElementById('status-dot').className='dot active';document.getElementById('status-txt').textContent='фарм идёт · offline';}
let sessionStart=null,timerInt=null;
function startTimer(ms){if(timerInt)clearInterval(timerInt);sessionStart=ms;timerInt=setInterval(updateSession,5000);updateSession();}
function updateSession(){if(!sessionStart)return;const h=(Date.now()-sessionStart)/3600000;document.getElementById('hv').textContent=h.toFixed(2);const tm=Math.floor(h*60),hh=Math.floor(tm/60),mm=tm%60;document.getElementById('utime').textContent=hh+'ч '+mm+'м';document.getElementById('ubar').style.width=Math.min(h/24*100,100)+'%';}
function formatDate(ms){if(!ms)return'—';const d=new Date(ms);return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});}
function renderSessions(sessions){const el=document.getElementById('sessions-list');if(!sessions||!sessions.length){el.innerHTML='<div style="font-family:Space Mono,monospace;font-size:9px;color:var(--sub)">нет данных</div>';return;}el.innerHTML=sessions.map(s=>'<div class="session-item"><span class="session-date">'+formatDate(s.start)+'</span><span class="session-hrs">+'+( s.ms/3600000).toFixed(2)+'ч</span></div>').join('');}
const statusMap={idling:'фарм идёт · offline',connecting:'подключаемся...',reconnecting:'переподключение...'};
let prevLoggedIn=false;
async function poll(){
  try{
    const d=await fetch('/status').then(r=>r.json());
    if(d.loggedIn){
      showView('v-online');setFavicon('#4ade80');
      if(d.avatarUrl){const img=document.getElementById('avatar-img');if(img.src!==d.avatarUrl){img.src=d.avatarUrl;img.style.display='';document.getElementById('avatar-ph').style.display='none';}}
      else{document.getElementById('avatar-ph').textContent=(d.username||'?')[0].toUpperCase();}
      const uname=document.getElementById('uname');uname.textContent=d.username||'—';if(d.profileUrl)uname.href=d.profileUrl;
      if(d.idling){document.getElementById('status-dot').className='dot active';document.getElementById('status-txt').textContent='фарм идёт · offline';document.getElementById('btn-stop').style.display='';document.getElementById('btn-start').style.display='none';}
      else{document.getElementById('status-dot').className='dot stopped';document.getElementById('status-txt').textContent='фарм остановлен';document.getElementById('btn-stop').style.display='none';document.getElementById('btn-start').style.display='';}
      if(!sessionStart&&d.startTime)startTimer(d.startTime);
      document.getElementById('s-total').textContent=d.totalHours.toFixed(2);
      document.getElementById('s-uptime').textContent=d.uptimePercent+'%';
      document.getElementById('last-online').textContent=formatDate(d.lastOnline);
      renderSessions(d.sessions);renderAchievements(d.totalHours,d.achieved);
    }else{
      if(prevLoggedIn){sessionStart=null;if(timerInt)clearInterval(timerInt);}
      showView('v-connecting');setFavicon('#f87171');
      document.getElementById('conn-txt').textContent=statusMap[d.status]||d.status;
    }
    prevLoggedIn=d.loggedIn;
  }catch(e){}
  setTimeout(poll,3000);
}
poll();
</script>
</body>
</html>`;
