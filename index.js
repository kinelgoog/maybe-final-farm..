const SteamUser = require('steam-user');
const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 10000;
const app = express();
app.use(express.json());

const DATA_FILE = path.join('/tmp', 'idler_data.json');

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { accounts: [], currentAccount: null };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Save error:', e);
  }
}

let persisted = loadData();
const clients = {};

function initAccounts() {
  persisted.accounts.forEach(acc => {
    if (acc.loggedIn) startFarming(acc.id);
  });
}

function startFarming(accountId) {
  const acc = persisted.accounts.find(a => a.id === accountId);
  if (!acc || clients[accountId]) return;

  const client = new SteamUser({ autoRelogin: true });
  clients[accountId] = client;

  client.on('loggedOn', () => {
    console.log('[' + acc.login + '] Logged in');
    if (!acc.steamId && client.steamID) {
      acc.steamId = client.steamID.getSteamID64();
      saveData(persisted);
    }
    client.setPersona(SteamUser.EPersonaState.Offline);
    client.gamesPlayed(acc.appIds);
    updateAccountStatus(accountId, { loggedIn: true, startTime: Date.now() });
    trackCardDrops(accountId);
    checkForNewGames(accountId);
  });

  client.on('error', err => {
    console.error('[' + acc.login + '] Error:', err.message);
    updateAccountStatus(accountId, { loggedIn: false, status: 'error' });
    setTimeout(() => startFarming(accountId), 300000);
  });

  client.on('disconnected', () => {
    updateAccountStatus(accountId, { loggedIn: false, status: 'reconnecting' });
    setTimeout(() => startFarming(accountId), 300000);
  });

  client.logOn({ accountName: acc.login, password: acc.password });
}

function trackCardDrops(accountId) {
  const acc = persisted.accounts.find(a => a.id === accountId);
  if (!acc) return;
  const dropsPerHour = acc.appIds.length * 2;

  setInterval(() => {
    if (!acc.loggedIn || !acc.startTime) return;
    const mins = Math.floor((Date.now() - acc.startTime) / 60000);
    const expected = Math.floor(mins * (dropsPerHour / 60));
    if (expected > acc.totalCards) {
      updateAccountStatus(accountId, { totalCards: expected });
      checkAchievements(accountId, expected);
    }
  }, 300000);
}

function checkForNewGames(accountId) {
  const acc = persisted.accounts.find(a => a.id === accountId);
  if (!acc || !acc.steamId) return;
  const key = process.env.STEAM_API_KEY;
  if (!key) return;

  const url = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=' + key + '&steamid=' + acc.steamId + '&include_appinfo=1';
  https.get(url, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (!json.response || !json.response.games) return;
        const existing = new Set(acc.appIds);
        const newGames = json.response.games
          .filter(g => g.has_community_visible_stats && g.playtime_forever > 30 && !existing.has(g.appid))
          .map(g => g.appid);
        if (newGames.length > 0) {
          const updatedIds = acc.appIds.concat(newGames);
          updateAccountStatus(accountId, { appIds: updatedIds });
          if (clients[accountId]) clients[accountId].gamesPlayed(updatedIds);
          console.log('[' + acc.login + '] Added games:', newGames);
        }
      } catch (e) {}
    });
  });
}

function checkAchievements(accountId, total) {
  const acc = persisted.accounts.find(a => a.id === accountId);
  if (!acc) return;
  [10, 50, 100, 500].forEach(t => {
    const id = 'c' + t;
    if (total >= t && !acc.achievements.includes(id)) {
      updateAccountStatus(accountId, { achievements: acc.achievements.concat(id) });
    }
  });
}

function updateAccountStatus(id, updates) {
  const idx = persisted.accounts.findIndex(a => a.id === id);
  if (idx === -1) return;
  persisted.accounts[idx] = Object.assign({}, persisted.accounts[idx], updates);
  saveData(persisted);
}

// Routes
app.get('/', (req, res) => res.send(HTML));
app.get('/accounts', (req, res) => res.json(persisted));

app.post('/accounts', (req, res) => {
  const { login, password, apps = [] } = req.body;
  const validApps = apps.map(Number).filter(id => id > 0 && id < 10000000);
  if (validApps.length === 0) return res.status(400).json({ error: 'Invalid apps' });
  const newAcc = {
    id: 'acc_' + Date.now(),
    login, password, steamId: '', appIds: validApps,
    loggedIn: false, status: 'connecting', totalCards: 0, achievements: [], startTime: null, totalMinutes: 0
  };
  persisted.accounts.push(newAcc);
  persisted.currentAccount = newAcc.id;
  saveData(persisted);
  setTimeout(() => startFarming(newAcc.id), 2000);
  res.status(201).json(newAcc);
});

app.post('/control/:id', (req, res) => {
  const { action } = req.body;
  const acc = persisted.accounts.find(a => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: 'Not found' });
  if (action === 'start') {
    startFarming(acc.id);
  } else if (action === 'stop' && clients[acc.id]) {
    clients[acc.id].logOff();
    delete clients[acc.id];
    if (acc.startTime) {
      acc.totalMinutes = (acc.totalMinutes || 0) + Math.floor((Date.now() - acc.startTime) / 60000);
      acc.startTime = null;
    }
  } else if (action === 'check') {
    checkForNewGames(acc.id);
  }
  saveData(persisted);
  res.json({ ok: true });
});

app.get('/status/:id', (req, res) => {
  const acc = persisted.accounts.find(a => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: 'Not found' });
  const mins = acc.startTime ? Math.floor((Date.now() - acc.startTime) / 60000) : 0;
  const totalH = ((acc.totalMinutes || 0) + mins) / 60;
  const dropsPerH = acc.appIds.length * 2;
  const interval = dropsPerH > 0 ? 60 / dropsPerH : 30;
  const progress = Math.min(100, (mins % interval) / interval * 100);
  res.json({
    id: acc.id, loggedIn: acc.loggedIn, login: acc.login,
    totalHours: totalH.toFixed(2), totalCards: acc.totalCards,
    cardProgress: progress.toFixed(0),
    cardTimer: Math.floor(interval - (mins % interval)) + 'м',
    appIds: acc.appIds, achievements: acc.achievements, lastUpdate: Date.now()
  });
});

app.get('/health', (req, res) => res.status(200).send('OK'));

initAccounts();
app.listen(PORT, () => console.log('Running on port ' + PORT));

// ==================== HTML + CSS + JS (БЕЗ ШАБЛОННЫХ СТРОК В КЛИЕНТЕ) ====================
const HTML = '<!DOCTYPE html>\n' +
'<html lang="ru">\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
'<title>Steam Idler — Premium</title>\n' +
'<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">\n' +
'<style>\n' +
':root{\n' +
'--bg-primary:#0a0a0f;--bg-secondary:#12121a;--card-bg:rgba(20,20,30,0.6);\n' +
'--card-border:rgba(255,255,255,0.08);--text-primary:#fff;--text-secondary:#a0a0b0;\n' +
'--accent:#a855f7;--accent-glow:rgba(168,85,247,0.3);--success:#00ff88;\n' +
'--success-glow:rgba(0,255,136,0.3);--font-main:"Inter",sans-serif;--font-mono:"JetBrains Mono",monospace}\n' +
'[data-theme="light"]{\n' +
'--bg-primary:#f0f2f5;--bg-secondary:#fff;--card-bg:rgba(255,255,255,0.7);\n' +
'--card-border:rgba(0,0,0,0.08);--text-primary:#1a1a2e;--text-secondary:#666677;\n' +
'--accent:#7e3af2;--accent-glow:rgba(126,58,242,0.2);--success:#00aa55}\n' +
'*{margin:0;padding:0;box-sizing:border-box}\n' +
'body{background:var(--bg-primary);color:var(--text-primary);font-family:var(--font-main);min-height:100vh;overflow-x:hidden;transition:background .5s,color .5s}\n' +
'#star-canvas{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}\n' +
'.glass-card{background:var(--card-bg);backdrop-filter:blur(24px);border:1px solid var(--card-border);border-radius:24px;padding:30px;box-shadow:0 8px 32px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.05);position:relative;overflow:hidden;contain:strict}\n' +
'.glass-card::before{content:"";position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle,var(--accent-glow) 0%,transparent 70%);opacity:.3;z-index:-1}\n' +
'.dynamic-island{position:fixed;top:90px;left:50%;transform:translateX(-50%) translateY(-100px) scale(.8);background:var(--card-bg);backdrop-filter:blur(24px);border:1px solid var(--card-border);border-radius:20px;padding:16px 28px;color:var(--text-primary);font-size:15px;font-weight:600;z-index:1000;opacity:0;transition:all .4s cubic-bezier(.175,.885,.32,1.275);box-shadow:0 12px 40px rgba(0,0,0,.3);min-width:300px;text-align:center;contain:strict}\n' +
'.dynamic-island.show{transform:translateX(-50%) translateY(0) scale(1);opacity:1}\n' +
'.accounts-bar{position:fixed;top:20px;left:50%;transform:translateX(-50%);display:flex;gap:10px;padding:10px 20px;background:var(--card-bg);backdrop-filter:blur(20px);border:1px solid var(--card-border);border-radius:50px;z-index:100;box-shadow:0 8px 32px rgba(0,0,0,.2)}\n' +
'.account-pill{padding:8px 20px;background:transparent;border:1px solid var(--card-border);border-radius:30px;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-secondary);transition:all .3s}\n' +
'.account-pill.active{background:var(--accent);color:#fff;border-color:var(--accent);box-shadow:0 0 20px var(--accent-glow)}\n' +
'.theme-toggle{position:fixed;top:20px;right:20px;width:50px;height:50px;border-radius:50%;background:var(--card-bg);backdrop-filter:blur(20px);border:1px solid var(--card-border);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:100;box-shadow:0 8px 32px rgba(0,0,0,.2);transition:all .3s}\n' +
'.theme-icon{width:22px;height:22px;fill:var(--text-primary)}\n' +
'.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:30px}\n' +
'.stat-box{background:rgba(255,255,255,.03);border:1px solid var(--card-border);border-radius:16px;padding:20px;text-align:center;transition:transform .2s}\n' +
'.stat-box:hover{transform:translateY(-2px)}\n' +
'.stat-value{font-size:36px;font-weight:700;font-family:var(--font-mono);color:var(--text-primary);margin-bottom:8px}\n' +
'.stat-label{font-size:12px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.1em}\n' +
'.progress-bar-container{height:8px;background:rgba(255,255,255,.05);border-radius:10px;overflow:hidden;position:relative}\n' +
'.progress-bar{height:100%;background:linear-gradient(90deg,var(--accent),var(--success));border-radius:10px;width:0;transition:width 1s cubic-bezier(.4,0,.2,1);position:relative}\n' +
'.progress-bar::after{content:"";position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.3),transparent);animation:shimmer 2s infinite}\n' +
'@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}\n' +
'.game-item{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(255,255,255,.03);border:1px solid var(--card-border);border-radius:12px;margin-bottom:8px;transition:all .3s}\n' +
'.game-item:hover{background:rgba(255,255,255,.06);border-color:var(--accent)}\n' +
'.game-name{font-weight:600;font-size:14px}\n' +
'.game-id{font-size:12px;color:var(--text-secondary);font-family:var(--font-mono)}\n' +
'.controls{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:30px}\n' +
'.btn{padding:14px 20px;border:none;border-radius:12px;font-family:var(--font-main);font-weight:600;font-size:14px;cursor:pointer;background:rgba(255,255,255,.05);color:var(--text-primary);border:1px solid var(--card-border);transition:all .3s}\n' +
'.btn.primary{background:var(--accent);color:#fff;border-color:var(--accent);box-shadow:0 4px 20px var(--accent-glow)}\n' +
'.modal{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.8);backdrop-filter:blur(10px);display:none;align-items:center;justify-content:center;z-index:1000;opacity:0;transition:opacity .3s}\n' +
'.modal.show{display:flex;opacity:1}\n' +
'.modal-content{background:var(--card-bg);backdrop-filter:blur(24px);border:1px solid var(--card-border);border-radius:24px;padding:30px;width:90%;max-width:450px;box-shadow:0 24px 64px rgba(0,0,0,.4);contain:strict}\n' +
'.modal-title{font-size:24px;font-weight:700;margin-bottom:24px}\n' +
'.input-field{width:100%;padding:14px 18px;background:rgba(255,255,255,.05);border:1px solid var(--card-border);border-radius:12px;color:var(--text-primary);font-family:var(--font-main);font-size:15px;transition:all .3s}\n' +
'.input-field:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow)}\n' +
'@media(max-width:640px){.stats-grid{grid-template-columns:1fr}.controls{grid-template-columns:1fr}}\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<canvas id="star-canvas"></canvas>\n' +
'<div class="theme-toggle" id="theme-toggle"><svg class="theme-icon" viewBox="0 0 24 24"><path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg></div>\n' +
'<div class="accounts-bar" id="accounts-bar"></div>\n' +
'<div class="dynamic-island" id="dynamic-island"></div>\n' +
'<div style="max-width:600px;margin:0 auto;padding:80px 20px 40px">\n' +
'  <div class="glass-card" id="main-card">\n' +
'    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:30px;padding-bottom:20px;border-bottom:1px solid var(--card-border)">\n' +
'      <div>\n' +
'        <div style="font-size:24px;font-weight:700;background:linear-gradient(135deg,var(--text-primary),var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent">Steam Idler</div>\n' +
'        <div style="font-size:13px;color:var(--text-secondary);margin-top:4px">Premium Farming System</div>\n' +
'      </div>\n' +
'      <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;background:rgba(0,255,136,.1);border:1px solid var(--success);border-radius:30px;font-size:13px;font-weight:600;color:var(--success)">\n' +
'        <span style="width:8px;height:8px;border-radius:50%;background:var(--success);animation:pulse 2s ease-in-out infinite"></span>\n' +
'        <span id="status-text">Фарм идёт</span>\n' +
'      </div>\n' +
'    </div>\n' +
'    <div class="stats-grid">\n' +
'      <div class="stat-box"><div class="stat-value" id="hours-value">0.00</div><div class="stat-label">Всего часов</div></div>\n' +
'      <div class="stat-box"><div class="stat-value" id="cards-value">0</div><div class="stat-label">Карточек</div></div>\n' +
'    </div>\n' +
'    <div style="margin-bottom:25px">\n' +
'      <div style="display:flex;justify-content:space-between;margin-bottom:10px">\n' +
'        <span style="font-size:13px;color:var(--text-secondary);font-weight:500">Прогресс сессии</span>\n' +
'        <span style="font-size:13px;font-family:var(--font-mono);font-weight:600;color:var(--accent)" id="session-time">0ч 0м</span>\n' +
'      </div>\n' +
'      <div class="progress-bar-container"><div class="progress-bar" id="session-bar"></div></div>\n' +
'    </div>\n' +
'    <div style="margin-bottom:25px">\n' +
'      <div style="display:flex;justify-content:space-between;margin-bottom:10px">\n' +
'        <span style="font-size:13px;color:var(--text-secondary);font-weight:500">До следующей карточки</span>\n' +
'        <span style="font-size:13px;font-family:var(--font-mono);font-weight:600;color:var(--accent)" id="cards-timer">0м</span>\n' +
'      </div>\n' +
'      <div class="progress-bar-container"><div class="progress-bar" id="cards-bar"></div></div>\n' +
'    </div>\n' +
'    <div style="margin:25px 0">\n' +
'      <div style="font-size:13px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.1em;font-weight:600;margin-bottom:15px">Игры для фарминга</div>\n' +
'      <div id="games-list" style="min-height:60px"></div>\n' +
'    </div>\n' +
'    <div class="controls">\n' +
'      <button class="btn" id="add-btn">+ Добавить</button>\n' +
'      <button class="btn" id="check-btn">Игры</button>\n' +
'      <button class="btn primary" id="toggle-btn">Остановить</button>\n' +
'    </div>\n' +
'  </div>\n' +
'</div>\n' +
'<div class="modal" id="modal">\n' +
'  <div class="modal-content">\n' +
'    <div class="modal-title">Новый аккаунт</div>\n' +
'    <div style="margin-bottom:20px">\n' +
'      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">Логин Steam</div>\n' +
'      <input type="text" class="input-field" id="inp-login" placeholder="Введите логин">\n' +
'    </div>\n' +
'    <div style="margin-bottom:20px">\n' +
'      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">Пароль</div>\n' +
'      <input type="password" class="input-field" id="inp-pass" placeholder="Введите пароль">\n' +
'    </div>\n' +
'    <div style="margin-bottom:20px">\n' +
'      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">App ID игр (через запятую)</div>\n' +
'      <input type="text" class="input-field" id="inp-apps" placeholder="730, 322170, 4465480">\n' +
'    </div>\n' +
'    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">\n' +
'      <button class="btn" id="modal-cancel">Отмена</button>\n' +
'      <button class="btn primary" id="modal-add">Добавить</button>\n' +
'    </div>\n' +
'  </div>\n' +
'</div>\n' +
'<script>\n' +
'(function(){var cur=null,theme=localStorage.getItem("theme")||"dark";document.documentElement.setAttribute("data-theme",theme);var el=function(id){return document.getElementById(id)};el("theme-toggle").addEventListener("click",function(){theme=theme==="dark"?"light":"dark";document.documentElement.setAttribute("data-theme",theme);localStorage.setItem("theme",theme);var icon=el("theme-icon");if(theme==="dark"){icon.innerHTML="<path d=\\"M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z\\"/>";}else{icon.innerHTML="<circle cx=\\"12\\" cy=\\"12\\" r=\\"5\\"/><path d=\\"M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42\\"/>";}});var canvas=el("star-canvas"),ctx=canvas.getContext("2d"),width,height,stars=[];function resize(){width=canvas.width=window.innerWidth;height=canvas.height=window.innerHeight;initStars()}function initStars(){stars=[];var count=Math.min(80,Math.floor((width*height)/4000));for(var i=0;i<count;i++){stars.push({x:Math.random()*width,y:Math.random()*height,size:Math.random()*2+0.5,speed:Math.random()*1.2+0.3,brightness:Math.random()*0.7+0.3})}}function drawStar(x,y,size){ctx.beginPath();var angle=Math.PI/5;for(var i=0;i<10;i++){var r=i%2===0?size:size*0.4;var theta=i*angle;var px=x+Math.cos(theta)*r;var py=y+Math.sin(theta)*r;if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py)}ctx.closePath();ctx.fillStyle="rgba(255,255,255,"+(size*0.3)+")";ctx.fill()}function animateStars(){ctx.clearRect(0,0,width,height);for(var i=0;i<stars.length;i++){var star=stars[i];star.y+=star.speed;star.brightness+=0.005;if(star.brightness>1)star.brightness=0.3;drawStar(star.x,star.y,star.size*star.brightness);if(star.y>height+20){star.y=-20;star.x=Math.random()*width}}requestAnimationFrame(animateStars)}window.addEventListener("resize",resize);resize();animateStars();function notify(msg,isAch){var isl=el("dynamic-island");isl.textContent=msg;isl.className="dynamic-island"+(isAch?" achievement":"");isl.classList.add("show");setTimeout(function(){isl.classList.remove("show")},4000)}function animateNumber(elem,start,end,dur){var st=performance.now();function upd(now){var elp=now-st,prg=Math.min(elp/dur,1),ease=1-Math.pow(1-prg,4),cur=start+(end-start)*ease;if(elem.id.indexOf("hours")>-1){elem.textContent=cur.toFixed(2)}else{elem.textContent=Math.floor(cur)}if(prg<1)requestAnimationFrame(upd)}requestAnimationFrame(upd)}function loadAccounts(){fetch("/accounts").then(function(r){return r.json()}).then(function(data){var bar=el("accounts-bar");bar.innerHTML="";data.accounts.forEach(function(acc){var pill=document.createElement("div");pill.className="account-pill"+(acc.id===data.currentAccount?" active":"");pill.textContent=acc.login;pill.onclick=function(){switchAccount(acc.id)};bar.appendChild(pill)});if(data.currentAccount&&!cur){switchAccount(data.currentAccount)}})}function switchAccount(id){cur=id;loadStatus()}function loadStatus(){if(!cur)return;fetch("/status/"+cur).then(function(r){return r.json()}).then(function(d){var hEl=el("hours-value"),cEl=el("cards-value"),cH=parseFloat(hEl.textContent)||0,cC=parseInt(cEl.textContent)||0;if(Math.abs(parseFloat(d.totalHours)-cH)>0.01){animateNumber(hEl,cH,parseFloat(d.totalHours),1000)}else{hEl.textContent=d.totalHours}if(d.totalCards>cC){animateNumber(cEl,cC,d.totalCards,1000);if(d.totalCards-cC>0){notify("🎴 +"+(d.totalCards-cC)+" карточек!")}}else{cEl.textContent=d.totalCards}el("session-bar").style.width=d.cardProgress+"%";el("cards-bar").style.width=d.cardProgress+"%";var tm=Math.floor(parseFloat(d.totalHours)*60),hh=Math.floor(tm/60)%24,mm=tm%60;el("session-time").textContent=hh+"ч "+mm+"м";var st=el("status-text"),tb=el("toggle-btn");if(d.loggedIn){st.textContent="Фарм идёт";tb.textContent="Остановить"}else{st.textContent="Остановлен";tb.textContent="Запустить"}renderGames(d.appIds)}).catch(function(e){console.error(e)})}function renderGames(ids){var list=el("games-list");list.innerHTML="";if(!ids||ids.length===0){list.innerHTML="<div style=\\"padding:20px;text-align:center;color:var(--text-secondary)\\">Нет игр для фарминга</div>";return}var names={"730":"Counter-Strike 2","4465480":"CS:GO","322170":"Geometry Dash"};ids.forEach(function(id){var item=document.createElement("div");item.className="game-item";var nm=names[id.toString()]||"App "+id;item.innerHTML="<span class=\\"game-name\\">"+nm+"</span><span class=\\"game-id\\">"+id+"</span>";list.appendChild(item)})}var modal=el("modal");el("add-btn").onclick=function(){modal.classList.add("show")};el("modal-cancel").onclick=function(){modal.classList.remove("show")};modal.onclick=function(e){if(e.target===modal)modal.classList.remove("show")};el("modal-add").onclick=function(){var lg=el("inp-login").value.trim(),ps=el("inp-pass").value,ap=el("inp-apps").value,apps=ap?ap.split(",").map(function(s){return parseInt(s.trim())}).filter(function(n){return!isNaN(n)}):[730,322170];if(!lg||!ps){notify("⚠️ Введите логин и пароль");return}fetch("/accounts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({login:lg,password:ps,apps:apps})}).then(function(){modal.classList.remove("show");el("inp-login").value="";el("inp-pass").value="";el("inp-apps").value="";notify("✅ Аккаунт добавлен");loadAccounts()}).catch(function(e){notify("❌ Ошибка: "+e.message)})};el("toggle-btn").onclick=function(){var ac=el("toggle-btn").textContent==="Остановить"?"stop":"start";fetch("/control/"+cur,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:ac})})};el("check-btn").onclick=function(){fetch("/control/"+cur,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"check"})});notify("🔍 Поиск новых игр...")};loadAccounts();setInterval(loadStatus,300000)})();\n' +
'</script>\n' +
'</body>\n' +
'</html>';
