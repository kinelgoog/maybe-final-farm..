const express  = require('express');
const Farmer   = require('./farmer');
const { connectDB, getAllAccounts, saveAccount, deleteAccount } = require('./db');

const PORT = process.env.PORT || 3000;
const app  = express();
app.use(express.json());

// Хранилище фармеров
const farmers = new Map(); // login -> Farmer

// Запуск фармера
function startFarmer(login, password) {
  if (farmers.has(login)) return;
  const f = new Farmer(login, password);
  farmers.set(login, f);
  f.start();
  console.log(`Started farmer: ${login}`);
}

// Инициализация — загружаем аккаунты из MongoDB и запускаем
async function init() {
  await connectDB();
  const accounts = await getAllAccounts();
  for (const acc of accounts) {
    if (acc.login && acc.password) {
      startFarmer(acc.login, acc.password);
    }
  }
  // Первый аккаунт из env (обратная совместимость)
  const envLogin = process.env.STEAM_LOGIN;
  const envPass  = process.env.STEAM_PASSWORD;
  if (envLogin && envPass && !farmers.has(envLogin)) {
    await saveAccount(envLogin, { login: envLogin, password: envPass });
    startFarmer(envLogin, envPass);
  }
}

// ── API ───────────────────────────────────────────────────────

app.get('/status', (req, res) => {
  const list = [];
  for (const f of farmers.values()) list.push(f.getStatus());
  res.json(list);
});

app.post('/account/add', async (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.json({ ok: false, error: 'Нужны login и password' });
  if (farmers.has(login)) return res.json({ ok: false, error: 'Аккаунт уже добавлен' });
  await saveAccount(login, { login, password });
  startFarmer(login, password);
  res.json({ ok: true });
});

app.post('/account/remove', async (req, res) => {
  const { login } = req.body;
  if (!login) return res.json({ ok: false, error: 'Нужен login' });
  const f = farmers.get(login);
  if (f) { f.stop(); farmers.delete(login); }
  await deleteAccount(login);
  res.json({ ok: true });
});

app.post('/account/stop', (req, res) => {
  const { login } = req.body;
  const f = farmers.get(login);
  if (!f) return res.json({ ok: false });
  f.stop();
  res.json({ ok: true });
});

app.post('/account/start', (req, res) => {
  const { login } = req.body;
  const f = farmers.get(login);
  if (!f) return res.json({ ok: false });
  f.resume();
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.send(HTML));

app.listen(PORT, () => console.log(`Server on port ${PORT}`));
init();

// ── HTML ──────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>фармилка часов:)</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#080808;--card:#111;--card-border:rgba(255,255,255,0.08);--card-hi:rgba(255,255,255,0.04);--text:#f2f2f2;--muted:rgba(255,255,255,0.38);--dim:rgba(255,255,255,0.14);--green:#22c55e;--green-g:rgba(34,197,94,0.2);--red:#ef4444;--yellow:#eab308;--mono:'DM Mono',monospace;--sans:'DM Sans',sans-serif}
.light{--bg:#f7f7f5;--card:#fff;--card-border:rgba(0,0,0,0.08);--card-hi:rgba(0,0,0,0.02);--text:#0f0f0f;--muted:rgba(0,0,0,0.42);--dim:rgba(0,0,0,0.14);--green:#16a34a;--green-g:rgba(22,163,74,0.12);--red:#dc2626;--yellow:#ca8a04}
*{margin:0;padding:0;box-sizing:border-box}
html{-webkit-font-smoothing:antialiased}
body{background:var(--bg);color:var(--text);font-family:var(--sans);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;cursor:none;transition:background .4s,color .4s;user-select:none}
canvas{position:fixed;inset:0;z-index:0;pointer-events:none}
.cursor{position:fixed;width:6px;height:6px;background:var(--text);border-radius:50%;pointer-events:none;z-index:9999;transform:translate(-50%,-50%)}
.cursor-ring{position:fixed;width:24px;height:24px;border:1px solid var(--dim);border-radius:50%;pointer-events:none;z-index:9998;transform:translate(-50%,-50%);transition:left .08s,top .08s}

/* Dynamic Island */
.island{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:300;background:#000;border-radius:20px;padding:8px 16px;font-family:var(--mono);font-size:11px;color:#fff;white-space:nowrap;transition:all .4s cubic-bezier(.34,1.56,.64,1);opacity:0;pointer-events:none;max-width:280px;text-align:center}
.island.show{opacity:1}
.light .island{background:#111}

/* Corner controls */
.corner{position:fixed;z-index:200;display:flex;align-items:center;gap:6px;padding:8px 12px;background:var(--card);border:1px solid var(--card-border);border-radius:10px;cursor:none;font-family:var(--mono);font-size:11px;color:var(--muted);transition:all .2s;backdrop-filter:blur(12px)}
.corner:hover{color:var(--text);border-color:var(--dim)}
.corner svg{width:14px;height:14px;flex-shrink:0}
#c-ach{top:16px;left:16px}
#c-theme{top:16px;right:16px}

/* Achievement panel */
.ach-panel{position:fixed;top:52px;left:16px;z-index:199;background:var(--card);border:1px solid var(--card-border);border-radius:16px;padding:18px;width:270px;backdrop-filter:blur(20px);display:none;max-height:75vh;overflow-y:auto}
.ach-panel.open{display:block}
.ach-head{font-size:10px;font-family:var(--mono);color:var(--muted);letter-spacing:.12em;text-transform:uppercase;margin-bottom:16px}
.ach-section{font-size:9px;font-family:var(--mono);color:var(--dim);letter-spacing:.1em;text-transform:uppercase;margin:12px 0 8px}
.ach-item{margin-bottom:12px}
.ach-row{display:flex;align-items:center;gap:10px;margin-bottom:5px}
.ach-ico{width:26px;height:26px;flex-shrink:0}
.ach-ico svg{width:26px;height:26px}
.ach-name{font-size:12px;font-weight:600;color:var(--text)}
.ach-sub{font-size:10px;font-family:var(--mono);color:var(--muted);margin-top:1px}
.ach-track{background:var(--card-hi);border:1px solid var(--card-border);border-radius:100px;height:3px;overflow:hidden}
.ach-fill{height:100%;border-radius:100px;transition:width 1s ease}
.ach-fill.done{background:var(--green)}
.ach-fill.pend{background:var(--dim)}
.ach-item.done .ach-name{color:var(--green)}

/* Slider */
.slider-wrap{position:relative;z-index:1;width:100%;max-width:360px;padding:16px;overflow:hidden;touch-action:pan-y}
.slider{display:flex;transition:transform .35s cubic-bezier(.4,0,.2,1)}
.slide{width:100%;flex-shrink:0;padding:0}

/* Dots */
.dots{display:flex;gap:6px;justify-content:center;margin-top:10px;z-index:1;position:relative}
.dot-ind{width:6px;height:6px;border-radius:50%;background:var(--dim);transition:all .2s;cursor:none}
.dot-ind.active{background:var(--text);width:18px;border-radius:3px}

/* Card */
.card{background:var(--card);border:1px solid var(--card-border);border-radius:20px;overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,0.03),0 24px 48px rgba(0,0,0,0.4)}
.light .card{box-shadow:0 0 0 1px rgba(0,0,0,0.04),0 8px 32px rgba(0,0,0,0.08)}

/* Add card */
.card-add{background:var(--card);border:1px solid var(--card-border);border-radius:20px;min-height:200px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;cursor:none}
.card-add:hover{border-color:var(--dim)}
.add-icon{width:44px;height:44px;border-radius:12px;background:var(--card-hi);border:1px solid var(--card-border);display:flex;align-items:center;justify-content:center}
.add-label{font-size:13px;color:var(--muted);font-family:var(--mono)}

/* Add form */
.add-form{padding:24px;display:none;flex-direction:column;gap:10px}
.add-form.open{display:flex}
.inp{width:100%;padding:11px 14px;background:var(--card-hi);border:1px solid var(--card-border);border-radius:10px;color:var(--text);font-family:var(--mono);font-size:13px;outline:none;transition:border .2s}
.inp:focus{border-color:var(--dim)}
.inp::placeholder{color:var(--muted)}
.btn-add{padding:11px;background:var(--green);color:#fff;border:none;border-radius:10px;font-family:var(--sans);font-size:13px;font-weight:600;cursor:none;transition:all .18s}
.light .btn-add{color:#000}
.btn-cancel{padding:11px;background:transparent;color:var(--muted);border:1px solid var(--card-border);border-radius:10px;font-family:var(--sans);font-size:13px;cursor:none;transition:all .18s}

/* Card header */
.card-header{padding:18px 18px 0;display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:8px}
.brand-dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green-g);animation:pulse 2s infinite}
.brand-dot.off{background:var(--red);box-shadow:0 0 8px rgba(239,68,68,0.2);animation:none}
.brand-dot.pend{background:var(--yellow);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.brand-name{font-size:12px;font-weight:600;color:var(--text)}
.brand-sub{font-size:10px;font-family:var(--mono);color:var(--muted)}
.badge{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:var(--card-hi);border:1px solid var(--card-border);border-radius:100px;font-family:var(--mono);font-size:10px;color:var(--muted)}

/* Card body */
.card-body{padding:14px 18px 18px}
.user-row{display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:10px;background:var(--card-hi);border:1px solid var(--card-border);border-radius:12px}
.avatar{width:34px;height:34px;border-radius:8px;object-fit:cover;background:var(--card-hi);border:1px solid var(--card-border)}
.avatar-ph{width:34px;height:34px;border-radius:8px;background:var(--card-hi);border:1px solid var(--card-border);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:var(--muted);flex-shrink:0}
.user-info{flex:1;min-width:0}
.user-name{font-size:13px;font-weight:600;color:var(--text);text-decoration:none;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.user-name:hover{color:var(--green)}

/* Hours */
.hours-block{text-align:center;padding:6px 0 10px}
.hours-label{font-size:9px;font-family:var(--mono);color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px}
.hours-num{font-size:48px;font-weight:700;color:var(--text);letter-spacing:-.04em;line-height:1;font-variant-numeric:tabular-nums}
.hours-unit{font-size:10px;font-family:var(--mono);color:var(--muted);margin-top:3px}

/* Progress */
.prog-wrap{background:var(--card-hi);border-radius:100px;height:2px;margin-bottom:4px;overflow:hidden}
.prog-bar{height:100%;background:var(--green);border-radius:100px;transition:width 1s ease}
.prog-labels{display:flex;justify-content:space-between}
.prog-labels span{font-size:9px;font-family:var(--mono);color:var(--dim)}

/* Cards status */
.cards-block{margin-top:10px;padding:10px;background:var(--card-hi);border:1px solid var(--card-border);border-radius:12px}
.cards-row{display:flex;justify-content:space-between;align-items:center}
.cards-label{font-size:10px;font-family:var(--mono);color:var(--muted)}
.cards-val{font-size:11px;font-family:var(--mono);font-weight:500;color:var(--text)}
.cards-timer{font-size:9px;font-family:var(--mono);color:var(--dim);margin-top:3px}

.div{border:none;border-top:1px solid var(--card-border);margin:12px 0}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px}
.stat{padding:10px;background:var(--card-hi);border:1px solid var(--card-border);border-radius:12px}
.stat-v{font-size:16px;font-weight:700;color:var(--text);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.stat-l{font-size:8px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-top:3px}
.info{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px}
.info-k{font-size:11px;color:var(--muted)}
.info-v{font-size:11px;font-family:var(--mono);color:var(--text)}
.sec-title{font-size:9px;font-family:var(--mono);color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:7px}
.sess{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--card-border)}
.sess:last-child{border:none}
.sess-d{font-size:9px;font-family:var(--mono);color:var(--muted)}
.sess-h{font-size:9px;font-family:var(--mono);font-weight:500;color:var(--text)}
.no-data{font-size:10px;font-family:var(--mono);color:var(--dim)}
.ctrl{display:flex;gap:7px;margin-top:12px}
.ctrl-btn{flex:1;padding:10px;border:none;border-radius:10px;font-family:var(--sans);font-size:12px;font-weight:600;cursor:none;transition:all .18s}
.ctrl-btn:active{transform:scale(.97)}
#b-stop{background:rgba(239,68,68,0.12);color:var(--red);border:1px solid rgba(239,68,68,0.2)}
#b-stop:hover{background:rgba(239,68,68,0.18)}
#b-start{background:rgba(34,197,94,0.12);color:var(--green);border:1px solid rgba(34,197,94,0.2)}
#b-start:hover{background:rgba(34,197,94,0.18)}
.btn-remove{width:100%;padding:8px;background:transparent;color:var(--red);border:1px solid rgba(239,68,68,0.15);border-radius:10px;font-family:var(--mono);font-size:11px;cursor:none;margin-top:6px;transition:all .18s}
.btn-remove:hover{background:rgba(239,68,68,0.08)}
</style>
</head>
<body>
<div class="cursor" id="cur"></div>
<div class="cursor-ring" id="ring"></div>
<canvas id="c"></canvas>

<div class="island" id="island"></div>

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

<div class="slider-wrap" id="slider-wrap">
  <div class="slider" id="slider"></div>
</div>
<div class="dots" id="dots"></div>

<script>
// cursor
const cur=document.getElementById('cur'),ring=document.getElementById('ring');
document.addEventListener('mousemove',e=>{cur.style.left=e.clientX+'px';cur.style.top=e.clientY+'px';ring.style.left=e.clientX+'px';ring.style.top=e.clientY+'px';});

// theme
let dark=localStorage.getItem('theme')!=='light';
function applyTheme(){document.body.classList.toggle('light',!dark);document.getElementById('theme-lbl').textContent=dark?'светлая':'тёмная';document.getElementById('theme-ico').innerHTML=dark?'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>':'<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';}
function toggleTheme(){dark=!dark;localStorage.setItem('theme',dark?'dark':'light');applyTheme();}
applyTheme();

// stars
const canvas=document.getElementById('c'),ctx=canvas.getContext('2d');
let W,H,stars=[];
function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight;initStars();}
function mkStar(t){return{x:Math.random()*W,y:t?-20:Math.random()*H,size:1.8+Math.random()*3.2,speed:0.4+Math.random()*1.3,op:0.15+Math.random()*0.55,wb:Math.random()*Math.PI*2,ws:0.004+Math.random()*0.008,trail:[]};}
function initStars(){stars=[];for(let i=0;i<90;i++)stars.push(mkStar(false));}
function drawStar(cx,cy,r){const p=Math.PI;ctx.beginPath();for(let i=0;i<5;i++){const a=i*2*p/5-p/2,ai=(i*2+1)*p/5-p/2;ctx.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);ctx.lineTo(cx+Math.cos(ai)*r*0.42,cy+Math.sin(ai)*r*0.42);}ctx.closePath();}
function animate(){ctx.clearRect(0,0,W,H);const col=dark?'#fff':'#222';stars.forEach(s=>{s.wb+=s.ws;s.x+=Math.sin(s.wb)*0.25;s.y+=s.speed;s.trail.push({x:s.x,y:s.y});if(s.trail.length>20)s.trail.shift();s.trail.forEach((pt,i)=>{const r=i/s.trail.length;ctx.save();ctx.globalAlpha=s.op*r*0.25;ctx.fillStyle=col;drawStar(pt.x,pt.y,s.size*r*0.6);ctx.fill();ctx.restore();});ctx.save();ctx.translate(s.x,s.y);ctx.rotate(s.wb);ctx.globalAlpha=s.op;ctx.fillStyle=col;drawStar(0,0,s.size);ctx.fill();ctx.restore();if(s.y>H+20)Object.assign(s,mkStar(true));});requestAnimationFrame(animate);}
resize();window.addEventListener('resize',resize);animate();

// Dynamic Island
let islandTimer=null;
function showIsland(text,duration=3000){
  const el=document.getElementById('island');
  el.textContent=text;el.classList.add('show');
  if(islandTimer)clearTimeout(islandTimer);
  islandTimer=setTimeout(()=>el.classList.remove('show'),duration);
}

// Achievements
const ACHS_H=[{h:1,name:'Первый час',icon:'h1'},{h:10,name:'Десятка',icon:'h10'},{h:50,name:'Полтинник',icon:'h50'},{h:100,name:'Сотка',icon:'h100'},{h:500,name:'Легенда',icon:'h500'}];
const ACHS_C=[{c:1,name:'Первая карточка',icon:'c1'},{c:10,name:'10 карточек',icon:'c10'},{c:50,name:'50 карточек',icon:'c50'},{c:100,name:'100 карточек',icon:'c100'},{c:500,name:'500 карточек',icon:'c500'}];
const ACH_ICONS={
  h1:'<svg viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="13" stroke="currentColor" stroke-width="1.5"/><path d="M14 8v6l4 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  h10:'<svg viewBox="0 0 28 28" fill="none"><path d="M14 4l2.5 7.5H24l-6.5 4.5 2.5 7.5L14 19l-6 4.5 2.5-7.5L4 11.5h7.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  h50:'<svg viewBox="0 0 28 28" fill="none"><path d="M14 3l3 8h8l-6.5 5 2.5 8L14 20l-7 4 2.5-8L3 11h8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="14" cy="14" r="3" stroke="currentColor" stroke-width="1.5"/></svg>',
  h100:'<svg viewBox="0 0 28 28" fill="none"><path d="M8 21V10l4-4h4l4 4v11H8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M11 21v-6h6v6" stroke="currentColor" stroke-width="1.5"/></svg>',
  h500:'<svg viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="11" stroke="currentColor" stroke-width="1.5"/><path d="M14 8l1.5 4.5H20l-3.5 2.5 1.5 4.5L14 17l-4 2.5 1.5-4.5L8 12.5h4.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  c1:'<svg viewBox="0 0 28 28" fill="none"><rect x="5" y="4" width="18" height="20" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M9 10h10M9 14h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  c10:'<svg viewBox="0 0 28 28" fill="none"><rect x="5" y="4" width="18" height="20" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M9 10h10M9 14h10M9 18h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  c50:'<svg viewBox="0 0 28 28" fill="none"><rect x="3" y="6" width="18" height="20" rx="3" stroke="currentColor" stroke-width="1.5"/><rect x="7" y="2" width="18" height="20" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M11 10h10M11 14h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  c100:'<svg viewBox="0 0 28 28" fill="none"><rect x="2" y="8" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.5"/><rect x="5" y="4" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.5"/><rect x="8" y="2" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.5"/></svg>',
  c500:'<svg viewBox="0 0 28 28" fill="none"><path d="M14 3C8 3 3 8 3 14s5 11 11 11 11-5 11-11S20 3 14 3z" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="9" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>',
};

function renderAch(accounts){
  if(!accounts||!accounts.length)return;
  const d=accounts[0];
  const totalH=d.totalHours||0;
  const totalC=d.totalCards||0;
  let html='<div class="ach-section">часы</div>';
  ACHS_H.forEach((a,i)=>{
    const done=(d.achievedHours||[]).includes(a.h);
    const prev=i>0?ACHS_H[i-1].h:0;
    const pct=done?100:Math.max(0,Math.min(100,Math.round((totalH-prev)/(a.h-prev)*100)));
    html+='<div class="ach-item '+(done?'done':'')+'"><div class="ach-row"><div class="ach-ico" style="color:'+(done?'var(--green)':'var(--muted)')+'">'+ACH_ICONS[a.icon]+'</div><div><div class="ach-name">'+a.name+'</div><div class="ach-sub">'+(done?'✓ выполнено':totalH.toFixed(1)+'/'+a.h+' ч')+'</div></div></div><div class="ach-track"><div class="ach-fill '+(done?'done':'pend')+'" style="width:'+pct+'%"></div></div></div>';
  });
  html+='<div class="ach-section">карточки</div>';
  ACHS_C.forEach((a,i)=>{
    const done=(d.achievedCards||[]).includes(a.c);
    const prev=i>0?ACHS_C[i-1].c:0;
    const pct=done?100:Math.max(0,Math.min(100,Math.round((totalC-prev)/(a.c-prev)*100)));
    html+='<div class="ach-item '+(done?'done':'')+'"><div class="ach-row"><div class="ach-ico" style="color:'+(done?'var(--green)':'var(--muted)')+'">'+ACH_ICONS[a.icon]+'</div><div><div class="ach-name">'+a.name+'</div><div class="ach-sub">'+(done?'✓ выполнено':totalC+'/'+a.c+' карт.')+'</div></div></div><div class="ach-track"><div class="ach-fill '+(done?'done':'pend')+'" style="width:'+pct+'%"></div></div></div>';
  });
  document.getElementById('ach-list').innerHTML=html;
}

function toggleAch(){document.getElementById('ach-panel').classList.toggle('open');}
document.addEventListener('click',e=>{if(!e.target.closest('#ach-panel')&&!e.target.closest('#c-ach'))document.getElementById('ach-panel').classList.remove('open');});

// Slider / swipe
let currentSlide=0,slides=[],totalSlides=0;
const sliderEl=document.getElementById('slider');
let touchStartX=0,touchStartY=0;
document.getElementById('slider-wrap').addEventListener('touchstart',e=>{touchStartX=e.touches[0].clientX;touchStartY=e.touches[0].clientY;},{passive:true});
document.getElementById('slider-wrap').addEventListener('touchend',e=>{
  const dx=e.changedTouches[0].clientX-touchStartX;
  const dy=e.changedTouches[0].clientY-touchStartY;
  if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>40){
    if(dx<0&&currentSlide<totalSlides-1)goTo(currentSlide+1);
    else if(dx>0&&currentSlide>0)goTo(currentSlide-1);
  }
},{passive:true});

function goTo(i){
  currentSlide=i;
  sliderEl.style.transform='translateX(-'+(i*100)+'%)';
  document.querySelectorAll('.dot-ind').forEach((d,j)=>d.classList.toggle('active',j===i));
}

// Timers per account
const timers={};
function startTimer(login,ms){
  if(timers[login])clearInterval(timers[login].interval);
  timers[login]={start:ms,interval:setInterval(()=>tickTimer(login),5000)};
  tickTimer(login);
}
function tickTimer(login){
  const t=timers[login];if(!t)return;
  const h=(Date.now()-t.start)/3600000;
  const el=document.getElementById('hv-'+login);if(el)el.textContent=h.toFixed(2);
  const tm=Math.floor(h*60),hh=Math.floor(tm/60),mm=tm%60;
  const ut=document.getElementById('ut-'+login);if(ut)ut.textContent=hh+'ч '+mm+'м';
  const pb=document.getElementById('pb-'+login);if(pb)pb.style.width=Math.min(h/24*100,100)+'%';
}

// Card timer
const cardTimers={};
function startCardTimer(login){
  if(cardTimers[login])clearInterval(cardTimers[login]);
  cardTimers[login]=setInterval(()=>{
    const el=document.getElementById('ct-'+login);
    if(!el)return;
    // просто показываем что идёт проверка каждые 30 минут
    const mins=Math.floor((Date.now()/60000)%30);
    el.textContent='след. проверка через '+(30-mins)+'м';
  },30000);
}

function fmtDate(ms){if(!ms)return'—';const d=new Date(ms);return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});}

function setFav(color){const cv=document.createElement('canvas');cv.width=32;cv.height=32;const c=cv.getContext('2d');c.fillStyle=color;c.beginPath();c.arc(16,16,14,0,Math.PI*2);c.fill();let l=document.querySelector("link[rel~='icon']");if(!l){l=document.createElement('link');l.rel='icon';document.head.appendChild(l);}l.href=cv.toDataURL();}

// Render slides
let prevNotifs={};
function renderSlides(accounts){
  const addSlide='<div class="slide"><div class="card-add" onclick="showAddForm()"><div class="add-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" color="var(--muted)"><path d="M12 5v14M5 12h14"/></svg></div><div class="add-label">добавить аккаунт</div></div><div class="add-form" id="add-form"><input class="inp" id="inp-login" placeholder="логин" autocomplete="off"><input class="inp" id="inp-pass" type="password" placeholder="пароль"><button class="btn-add" onclick="submitAdd()">Добавить</button><button class="btn-cancel" onclick="hideAddForm()">Отмена</button><div id="add-err" style="font-size:11px;font-family:var(--mono);color:var(--red);min-height:14px"></div></div></div>';

  const newSlides=accounts.map(d=>{
    const h=d.totalHours||0;
    const loggedIn=d.loggedIn;
    return \`<div class="slide">
<div class="card">
<div class="card-header">
  <div class="brand">
    <div class="brand-dot \${loggedIn?'':'off'}" id="bd-\${d.login}"></div>
    <div><div class="brand-name">фармилка часов:)</div><div class="brand-sub">кс2, ксго и гд</div></div>
  </div>
  <div class="badge" id="sb-\${d.login}">\${loggedIn?'фарм идёт':'подключение...'}</div>
</div>
<div class="card-body">
  <div class="user-row">
    \${d.avatarUrl?'<img class="avatar" src="'+d.avatarUrl+'" alt="">':'<div class="avatar-ph">'+(d.username||'?')[0].toUpperCase()+'</div>'}
    <div class="user-info">
      <a class="user-name" href="\${d.profileUrl||'#'}" target="_blank">\${d.username||d.login}</a>
      <div class="badge" style="margin-top:2px">в невидимке</div>
    </div>
  </div>
  <div class="hours-block">
    <div class="hours-label">сессия</div>
    <div class="hours-num" id="hv-\${d.login}">\${d.startTime?((Date.now()-d.startTime)/3600000).toFixed(2):'0.00'}</div>
    <div class="hours-unit">часов</div>
  </div>
  <div class="prog-wrap"><div class="prog-bar" id="pb-\${d.login}" style="width:0%"></div></div>
  <div class="prog-labels"><span>прогресс за сутки</span><span id="ut-\${d.login}">0ч 0м</span></div>
  \${d.cardGame?'<div class="cards-block"><div class="cards-row"><span class="cards-label">фарм карточек</span><span class="cards-val">'+d.cardsRemaining+' осталось</span></div><div class="cards-timer" id="ct-'+d.login+'">проверка каждые 30м</div></div>':''}
  <hr class="div">
  <div class="stats">
    <div class="stat"><div class="stat-v">\${h.toFixed(2)}</div><div class="stat-l">всего часов</div></div>
    <div class="stat"><div class="stat-v">\${d.totalCards||0}</div><div class="stat-l">карточек</div></div>
    <div class="stat"><div class="stat-v">\${d.uptimePercent||0}%</div><div class="stat-l">uptime 7д</div></div>
    <div class="stat"><div class="stat-v">\${d.cardQueue||0}</div><div class="stat-l">игр в очереди</div></div>
  </div>
  <div class="info"><span class="info-k">последний онлайн</span><span class="info-v">\${fmtDate(d.lastOnline)}</span></div>
  <hr class="div">
  <div class="sec-title">история сессий</div>
  <div>\${(d.sessions&&d.sessions.length)?d.sessions.map(s=>'<div class="sess"><span class="sess-d">'+fmtDate(s.start)+'</span><span class="sess-h">+'+(s.ms/3600000).toFixed(2)+' ч</span></div>').join(''):'<div class="no-data">нет данных</div>'}</div>
  <div class="ctrl">
    \${d.idling?'<button class="ctrl-btn" id="b-stop" onclick="doStop(\''+d.login+'\')">Остановить</button>':'<button class="ctrl-btn" id="b-start" style="background:rgba(34,197,94,0.12);color:var(--green);border:1px solid rgba(34,197,94,0.2)" onclick="doStart(\''+d.login+'\')">Запустить</button>'}
  </div>
  <button class="btn-remove" onclick="doRemove('${d.login}')">Удалить аккаунт</button>
</div>
</div>
</div>\`;
  }).join('');

  sliderEl.innerHTML = newSlides + addSlide;
  totalSlides = accounts.length + 1;

  // dots
  const dotsEl=document.getElementById('dots');
  dotsEl.innerHTML=Array.from({length:totalSlides},(_,i)=>'<div class="dot-ind'+(i===currentSlide?' active':'')+'"></div>').join('');

  if(currentSlide>=totalSlides)currentSlide=totalSlides-1;
  goTo(currentSlide);

  // таймеры
  accounts.forEach(d=>{
    if(d.loggedIn&&d.startTime){
      if(!timers[d.login]||timers[d.login].start!==d.startTime)startTimer(d.login,d.startTime);
    }
    if(d.cardGame)startCardTimer(d.login);
  });
}

// Add account form
function showAddForm(){document.getElementById('add-form').classList.add('open');}
function hideAddForm(){document.getElementById('add-form').classList.remove('open');document.getElementById('add-err').textContent='';}
async function submitAdd(){
  const login=document.getElementById('inp-login').value.trim();
  const pass=document.getElementById('inp-pass').value.trim();
  if(!login||!pass){document.getElementById('add-err').textContent='Заполни оба поля';return;}
  const r=await fetch('/account/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login,password:pass})});
  const d=await r.json();
  if(d.ok){hideAddForm();showIsland('✓ Аккаунт добавлен');}
  else document.getElementById('add-err').textContent=d.error||'Ошибка';
}

async function doStop(login){await fetch('/account/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login})});showIsland('⏹ Фарм остановлен');}
async function doStart(login){await fetch('/account/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login})});showIsland('▶ Фарм запущен');}
async function doRemove(login){if(!confirm('Удалить аккаунт '+login+'?'))return;await fetch('/account/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login})});showIsland('Аккаунт удалён');}

// Poll
let lastData=[];
let seenNotifs=new Set();
async function poll(){
  try{
    const data=await fetch('/status').then(r=>r.json());
    renderSlides(data);
    renderAch(data);
    if(data.some(d=>d.loggedIn))setFav('#22c55e');
    else setFav('#ef4444');
    // уведомления о карточках
    data.forEach(d=>{
      (d.cardNotifs||[]).forEach(n=>{
        const key=d.login+n.time;
        if(!seenNotifs.has(key)){seenNotifs.add(key);showIsland('🃏 '+n.text);}
      });
    });
  }catch(e){}
  setTimeout(poll,4000);
}
poll();
</script>
</body>
</html>`;
