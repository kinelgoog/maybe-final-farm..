const SteamUser = require('steam-user');
const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 10000;
const app = express();
app.use(express.json());

const DATA_FILE = path.join('/tmp', 'idler_data.json');
let persisted = loadData();

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return { accounts: [], currentAccount: null }; }
}

function saveData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('Save error:', e); }
}

const clients = {};

function initAccounts() {
  persisted.accounts.forEach(acc => { if (acc.loggedIn) startFarming(acc.id); });
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

  client.on('error', (err) => {
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
  https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (!json.response || !json.response.games) return;
        const existing = new Set(acc.appIds);
        const newGames = json.response.games.filter(g =>
          g.has_community_visible_stats && g.playtime_forever > 30 && !existing.has(g.appid)
        ).map(g => g.appid);

        if (newGames.length > 0) {
          const updatedIds = acc.appIds.concat(newGames);
          updateAccountStatus(accountId, { appIds: updatedIds });
          if (clients[accountId]) clients[accountId].gamesPlayed(updatedIds);
          console.log('[' + acc.login + '] Added games:', newGames);
        }
      } catch(e) {}
    });
  });
}

function checkAchievements(accountId, total) {
  const acc = persisted.accounts.find(a => a.id === accountId);
  if (!acc) return;
  const thresholds = [10, 50, 100, 500];
  thresholds.forEach(t => {
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
    appIds: acc.appIds, achievements: acc.achievements
  });
});

app.get('/health', (req, res) => res.status(200).send('OK'));

initAccounts();
app.listen(PORT, () => console.log('Running on port ' + PORT));

const HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Steam Idler</title>
<style>
:root{--bg:#0f0f0f;--card:#1a1a1a;--border:#2a2a2a;--text:#e6e6e6;--accent:#2081e2;--success:#22c55e;--warn:#eab308}
*{margin:0;padding:0;box-sizing:border-box}body{background:var(--bg);color:var(--text);font-family:system-ui,sans-serif;min-height:100vh}
.accounts{display:flex;gap:8px;padding:12px;border-bottom:1px solid var(--border);overflow-x:auto}
.acc-pill{padding:6px 16px;background:var(--card);border-radius:30px;cursor:pointer;white-space:nowrap}
.acc-pill.active{background:var(--accent)}
.card{background:var(--card);border-radius:16px;margin:16px;overflow:hidden}
.header{padding:16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.badge{padding:4px 12px;border-radius:20px;font-size:13px;font-weight:500;background:rgba(32,129,226,0.1);color:var(--accent)}
.badge.online{background:rgba(34,197,94,0.1);color:var(--success)}
.stat{padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:16px}
.val{font-size:24px;font-weight:600}.lbl{color:#888;font-size:12px;text-transform:uppercase}
.prog{padding:0 16px 16px}
.p-bar{height:6px;background:#2a2a2a;border-radius:3px;overflow:hidden;margin-bottom:12px}
.p-fill{height:100%;background:var(--accent);width:0%;transition:width 1s}.p-fill.cards{background:var(--warn)}
.ctrl{padding:16px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.btn{padding:14px;border-radius:12px;border:none;font-weight:500;cursor:pointer;background:transparent;color:var(--text);border:1px solid var(--border)}
.btn.primary{background:var(--accent);color:#fff;border:none}
.modal{position:fixed;inset:0;background:rgba(0,0,0,0.7);display:none;align-items:center;justify-content:center}
.modal.show{display:flex}.modal-box{background:var(--card);padding:24px;border-radius:16px;width:90%;max-width:400px}
input{width:100%;padding:12px;margin:8px 0;background:#2a2a2a;border:none;border-radius:8px;color:#fff}
.island{position:fixed;top:20px;left:50%;transform:translateX(-50%) translateY(-100px);background:rgba(30,30,30,0.95);border-radius:30px;padding:8px 20px;color:#fff;font-size:14px;transition:transform .3s;z-index:1000;border:1px solid rgba(255,255,255,0.1)}
.island.show{transform:translateX(-50%) translateY(0)}
.game-list{padding:0 16px 16px}
.game-item{padding:10px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between}
</style>
</head>
<body>
<div class="island" id="island"></div>
<div class="accounts" id="accounts"></div>
<div class="card">
  <div class="header"><div><b style="font-size:16px">Steam Idler</b><div style="font-size:12px;color:#888">Фарм часов и карточек</div></div><div class="badge" id="badge">Оффлайн</div></div>
  <div class="stat"><div><div class="val" id="hours">0.00</div><div class="lbl">Часов</div></div><div><div class="val" id="cards">0</div><div class="lbl">Карточек</div></div></div>
  <div class="prog"><div style="display:flex;justify-content:space-between;font-size:13px;color:#888;margin-bottom:6px"><span>Сессия</span><span id="s-time">0ч 0м</span></div><div class="p-bar"><div class="p-fill" id="s-bar"></div></div></div>
  <div class="prog"><div style="display:flex;justify-content:space-between;font-size:13px;color:#888;margin-bottom:6px"><span>До карточки</span><span id="c-time">0м</span></div><div class="p-bar"><div class="p-fill cards" id="c-bar"></div></div></div>
  <div class="game-list" id="games"><div style="padding:10px;color:#888">Загрузка...</div></div>
  <div class="ctrl"><button class="btn" id="add-btn">+ Добавить</button><button class="btn" id="check-btn">Игры</button><button class="btn primary" id="tog-btn">Старт</button></div>
</div>
<div class="modal" id="modal"><div class="modal-box"><h3 style="margin-bottom:16px">Новый аккаунт</h3><input id="inp-login" placeholder="Логин"><input id="inp-pass" type="password" placeholder="Пароль"><input id="inp-apps" placeholder="App ID (через запятую)"><button class="btn primary" style="margin-top:16px;width:100%" id="modal-add">Добавить</button></div></div>

<script>
(function(){
  var cur = null;
  var el = function(id){ return document.getElementById(id); };

  function notify(msg){
    var isl = el('island'); isl.textContent = msg; isl.className = 'island show';
    setTimeout(function(){ isl.className = 'island'; }, 3000);
  }

  function renderAccs(accs, curId){
    var cont = el('accounts'); cont.innerHTML = '';
    accs.forEach(function(a){
      var d = document.createElement('div');
      d.className = 'acc-pill' + (a.id === curId ? ' active' : '');
      d.textContent = a.login;
      d.onclick = function(){ switchAcc(a.id); };
      cont.appendChild(d);
    });
  }

  function renderGames(ids){
    var cont = el('games'); cont.innerHTML = '';
    if(!ids || ids.length === 0){ cont.innerHTML = '<div style="padding:10px;color:#888">Нет игр</div>'; return; }
    ids.forEach(function(id){
      var name = 'App ' + id;
      if(id == 730) name = 'CS2';
      if(id == 740) name = 'CS:GO';
      if(id == 327920) name = 'Geometry Dash';
      var d = document.createElement('div'); d.className = 'game-item';
      d.innerHTML = '<span>' + name + '</span><span style="color:#888;font-size:12px">' + id + '</span>';
      cont.appendChild(d);
    });
  }

  function switchAcc(id){
    cur = id; loadStatus();
  }

  function loadStatus(){
    if(!cur) return;
    fetch('/status/' + cur).then(function(r){ return r.json(); }).then(function(d){
      el('hours').textContent = d.totalHours;
      el('cards').textContent = d.totalCards;
      el('s-bar').style.width = d.cardProgress + '%';
      el('c-bar').style.width = d.cardProgress + '%';
      el('c-time').textContent = d.cardTimer;
      el('s-time').textContent = Math.floor(d.totalHours % 24) + 'ч ' + Math.floor((d.totalHours*60)%60) + 'м';
      el('badge').textContent = d.loggedIn ? 'Фарм идёт' : 'Остановлен';
      el('badge').className = d.loggedIn ? 'badge online' : 'badge';
      el('tog-btn').textContent = d.loggedIn ? 'Стоп' : 'Старт';
      renderGames(d.appIds);
    }).catch(function(e){ console.error(e); });
  }

  fetch('/accounts').then(function(r){ return r.json(); }).then(function(d){
    renderAccs(d.accounts, d.currentAccount);
    if(d.currentAccount) switchAcc(d.currentAccount);
    setInterval(loadStatus, 300000);
  });

  el('add-btn').onclick = function(){ el('modal').className = 'modal show'; };
  el('modal').onclick = function(e){ if(e.target === this) this.className = 'modal'; };
  el('modal-add').onclick = function(){
    var l = el('inp-login').value, p = el('inp-pass').value, a = el('inp-apps').value;
    fetch('/accounts', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({login:l,password:p,apps:a.split(',').map(Number).filter(Boolean)})})
    .then(function(){ el('modal').className = 'modal'; location.reload(); });
  };

  el('tog-btn').onclick = function(){
    var act = el('tog-btn').textContent === 'Стоп' ? 'stop' : 'start';
    fetch('/control/' + cur, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:act})});
  };

  el('check-btn').onclick = function(){
    fetch('/control/' + cur, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'check'})});
    notify('🔍 Поиск новых игр...');
  };
})();
</script>
</body>
</html>`;
