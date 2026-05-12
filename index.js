const SteamUser = require('steam-user');
const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 10000;
const app = express();

app.use(express.json());

// Отдаем статичный HTML-интерфейс
app.use(express.static(path.join(__dirname)));

const DATA_FILE = path.join('/tmp', 'idler_data.json');
let persisted = loadData();

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
    console.log(`[${acc.login}] Logged in successfully`);
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
    console.error(`[${acc.login}] Error:`, err.message);
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

  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${acc.steamId}&include_appinfo=1`;
  
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
          console.log(`[${acc.login}] Added new games:`, newGames);
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

// Эндпоинты API
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

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
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
