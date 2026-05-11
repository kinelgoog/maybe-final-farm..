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
      const newDrops = expected - acc.totalCards;
      updateAccountStatus(accountId, { totalCards: expected });
      checkAchievements(accountId, expected);
      // Здесь можно добавить уведомление о новых карточках
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
    appIds: acc.appIds, achievements: acc.achievements,
    lastUpdate: Date.now()
  });
});

app.get('/health', (req, res) => res.status(200).send('OK'));

initAccounts();
app.listen(PORT, () => console.log('Running on port ' + PORT));

const HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Steam Idler — Premium</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg-primary: #0a0a0f;
  --bg-secondary: #12121a;
  --card-bg: rgba(20, 20, 30, 0.6);
  --card-border: rgba(255, 255, 255, 0.08);
  --text-primary: #ffffff;
  --text-secondary: #a0a0b0;
  --accent: #00d4ff;
  --accent-glow: rgba(0, 212, 255, 0.3);
  --success: #00ff88;
  --success-glow: rgba(0, 255, 136, 0.3);
  --warning: #ffb800;
  --font-main: 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}

[data-theme="light"] {
  --bg-primary: #f0f2f5;
  --bg-secondary: #ffffff;
  --card-bg: rgba(255, 255, 255, 0.7);
  --card-border: rgba(0, 0, 0, 0.08);
  --text-primary: #1a1a2e;
  --text-secondary: #666677;
  --accent: #0066cc;
  --accent-glow: rgba(0, 102, 204, 0.2);
  --success: #00aa55;
  --success-glow: rgba(0, 170, 85, 0.2);
  --warning: #cc9900;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-main);
  min-height: 100vh;
  overflow-x: hidden;
  cursor: none;
  transition: background 0.5s ease, color 0.5s ease;
}

/* Custom Cursor */
.cursor {
  position: fixed;
  width: 8px;
  height: 8px;
  background: var(--accent);
  border-radius: 50%;
  pointer-events: none;
  z-index: 9999;
  transform: translate(-50%, -50%);
  transition: width 0.2s, height 0.2s, background 0.2s;
  box-shadow: 0 0 20px var(--accent-glow);
}

.cursor.hover {
  width: 40px;
  height: 40px;
  background: transparent;
  border: 2px solid var(--accent);
}

.cursor-trail {
  position: fixed;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
  pointer-events: none;
  z-index: 9998;
  transform: translate(-50%, -50%);
  transition: left 0.1s, top 0.1s;
}

/* Canvas Background */
#star-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}

/* Animated Gradient Background */
.gradient-bg {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, 
    var(--bg-primary) 0%, 
    rgba(0, 212, 255, 0.05) 50%, 
    var(--bg-primary) 100%);
  background-size: 400% 400%;
  animation: gradientShift 15s ease infinite;
  z-index: 1;
  pointer-events: none;
}

@keyframes gradientShift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* Main Container */
.container {
  position: relative;
  z-index: 10;
  max-width: 600px;
  margin: 0 auto;
  padding: 80px 20px 40px;
}

/* Accounts Bar */
.accounts-bar {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  padding: 10px 20px;
  background: var(--card-bg);
  backdrop-filter: blur(20px);
  border: 1px solid var(--card-border);
  border-radius: 50px;
  z-index: 100;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.account-pill {
  padding: 8px 20px;
  background: transparent;
  border: 1px solid var(--card-border);
  border-radius: 30px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.account-pill::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
  transition: left 0.5s;
}

.account-pill:hover::before {
  left: 100%;
}

.account-pill.active {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
  box-shadow: 0 0 20px var(--accent-glow);
}

.account-pill:hover:not(.active) {
  border-color: var(--accent);
  color: var(--accent);
}

/* Glass Card */
.glass-card {
  background: var(--card-bg);
  backdrop-filter: blur(30px);
  border: 1px solid var(--card-border);
  border-radius: 24px;
  padding: 30px;
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  position: relative;
  overflow: hidden;
  transform-style: preserve-3d;
  transition: transform 0.1s ease;
}

.glass-card::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}

.glass-card:hover::before {
  opacity: 0.5;
}

/* Energy Aura */
.energy-aura {
  position: absolute;
  top: -2px;
  left: -2px;
  right: -2px;
  bottom: -2px;
  background: linear-gradient(45deg, var(--accent), transparent, var(--success));
  border-radius: 24px;
  opacity: 0;
  z-index: -1;
  animation: auraPulse 3s ease-in-out infinite;
  filter: blur(10px);
}

.glass-card.active .energy-aura {
  opacity: 0.3;
}

@keyframes auraPulse {
  0%, 100% { opacity: 0.1; }
  50% { opacity: 0.4; }
}

/* Header */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--card-border);
}

.card-title {
  font-size: 24px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--text-primary), var(--accent));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.card-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

/* Status Badge */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(0, 255, 136, 0.1);
  border: 1px solid var(--success);
  border-radius: 30px;
  font-size: 13px;
  font-weight: 600;
  color: var(--success);
  box-shadow: 0 0 20px rgba(0, 255, 136, 0.1);
}

.status-badge.offline {
  background: rgba(160, 160, 176, 0.1);
  border-color: var(--text-secondary);
  color: var(--text-secondary);
  box-shadow: none;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  animation: pulse 2s ease-in-out infinite;
  box-shadow: 0 0 10px var(--success);
}

.status-badge.offline .status-dot {
  background: var(--text-secondary);
  animation: none;
  box-shadow: none;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.2); }
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 30px;
}

.stat-box {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--card-border);
  border-radius: 16px;
  padding: 20px;
  text-align: center;
  position: relative;
  overflow: hidden;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.stat-box::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: 0;
  transition: opacity 0.3s;
}

.stat-box:hover::before {
  opacity: 1;
}

.stat-box:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.stat-value {
  font-size: 36px;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--text-primary);
  margin-bottom: 8px;
  background: linear-gradient(135deg, var(--text-primary), var(--accent));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

/* Progress Section */
.progress-section {
  margin-bottom: 25px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.progress-label {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.progress-value {
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--accent);
  font-weight: 600;
}

.progress-bar-container {
  height: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  overflow: hidden;
  position: relative;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--success));
  border-radius: 10px;
  width: 0%;
  transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
  box-shadow: 0 0 20px var(--accent-glow);
}

.progress-bar::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.3),
    transparent
  );
  animation: shimmer 2s infinite;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

/* Games List */
.games-section {
  margin: 25px 0;
}

.section-title {
  font-size: 13px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 15px;
  font-weight: 600;
}

.game-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  margin-bottom: 8px;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.game-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--accent);
  opacity: 0;
  transition: opacity 0.3s;
}

.game-item:hover::before {
  opacity: 1;
}

.game-item:hover {
  background: rgba(255, 255, 255, 0.06);
  transform: translateX(5px);
  border-color: var(--accent);
}

.game-name {
  font-weight: 600;
  font-size: 14px;
}

.game-id {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

/* Controls */
.controls {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  margin-top: 30px;
}

.btn {
  padding: 14px 20px;
  border: none;
  border-radius: 12px;
  font-family: var(--font-main);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
  border: 1px solid var(--card-border);
}

.btn::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  transform: translate(-50%, -50%);
  transition: width 0.6s, height 0.6s;
}

.btn:hover::before {
  width: 300px;
  height: 300px;
}

.btn:active {
  transform: scale(0.95);
}

.btn.primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
  box-shadow: 0 4px 20px var(--accent-glow);
}

.btn.primary:hover {
  box-shadow: 0 6px 30px var(--accent-glow);
  transform: translateY(-2px);
}

/* Theme Toggle */
.theme-toggle {
  position: fixed;
  top: 20px;
  right: 20px;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: var(--card-bg);
  backdrop-filter: blur(20px);
  border: 1px solid var(--card-border);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 100;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  transition: all 0.3s ease;
}

.theme-toggle:hover {
  transform: rotate(180deg) scale(1.1);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}

.theme-icon {
  width: 24px;
  height: 24px;
  fill: var(--text-primary);
}

/* Dynamic Island */
.dynamic-island {
  position: fixed;
  top: 90px;
  left: 50%;
  transform: translateX(-50%) translateY(-100px) scale(0.8);
  background: var(--card-bg);
  backdrop-filter: blur(30px);
  border: 1px solid var(--card-border);
  border-radius: 20px;
  padding: 16px 28px;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 600;
  z-index: 1000;
  opacity: 0;
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  min-width: 300px;
  text-align: center;
}

.dynamic-island.show {
  transform: translateX(-50%) translateY(0) scale(1);
  opacity: 1;
}

.dynamic-island.achievement {
  border-color: var(--warning);
  background: linear-gradient(135deg, rgba(255, 184, 0, 0.1), var(--card-bg));
}

/* Modal */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(10px);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.modal.show {
  display: flex;
  opacity: 1;
}

.modal-content {
  background: var(--card-bg);
  backdrop-filter: blur(30px);
  border: 1px solid var(--card-border);
  border-radius: 24px;
  padding: 30px;
  width: 90%;
  max-width: 450px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
  transform: scale(0.9);
  transition: transform 0.3s ease;
}

.modal.show .modal-content {
  transform: scale(1);
}

.modal-title {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 24px;
  background: linear-gradient(135deg, var(--text-primary), var(--accent));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.input-group {
  margin-bottom: 20px;
}

.input-label {
  display: block;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  font-weight: 500;
}

.input-field {
  width: 100%;
  padding: 14px 18px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  color: var(--text-primary);
  font-family: var(--font-main);
  font-size: 15px;
  transition: all 0.3s ease;
}

.input-field:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
  background: rgba(255, 255, 255, 0.08);
}

.modal-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 24px;
}

/* Scanner Effect */
.scanner-line {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  box-shadow: 0 0 20px var(--accent);
  opacity: 0;
  pointer-events: none;
  z-index: 100;
}

.scanner-line.active {
  animation: scan 1.5s ease-in-out;
}

@keyframes scan {
  0% { top: 0; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}

/* Confetti Canvas */
#confetti-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 999;
}

/* Responsive */
@media (max-width: 640px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
  .controls {
    grid-template-columns: 1fr;
  }
  .accounts-bar {
    max-width: calc(100% - 40px);
    overflow-x: auto;
  }
}
</style>
</head>
<body>
  <!-- Custom Cursor -->
  <div class="cursor" id="cursor"></div>
  <div class="cursor-trail" id="cursor-trail"></div>

  <!-- Background -->
  <canvas id="star-canvas"></canvas>
  <div class="gradient-bg"></div>
  <canvas id="confetti-canvas"></canvas>

  <!-- Theme Toggle -->
  <div class="theme-toggle" id="theme-toggle" title="Сменить тему">
    <svg class="theme-icon" id="theme-icon" viewBox="0 0 24 24">
      <path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>
    </svg>
  </div>

  <!-- Accounts Bar -->
  <div class="accounts-bar" id="accounts-bar"></div>

  <!-- Dynamic Island -->
  <div class="dynamic-island" id="dynamic-island"></div>

  <!-- Main Container -->
  <div class="container">
    <div class="glass-card" id="main-card">
      <div class="energy-aura"></div>
      <div class="scanner-line" id="scanner"></div>

      <!-- Header -->
      <div class="card-header">
        <div>
          <div class="card-title">Steam Idler</div>
          <div class="card-subtitle">Premium Farming System</div>
        </div>
        <div class="status-badge" id="status-badge">
          <span class="status-dot"></span>
          <span id="status-text">Фарм идёт</span>
        </div>
      </div>

      <!-- Stats -->
      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-value" id="hours-value">0.00</div>
          <div class="stat-label">Всего часов</div>
        </div>
        <div class="stat-box">
          <div class="stat-value" id="cards-value">0</div>
          <div class="stat-label">Карточек</div>
        </div>
      </div>

      <!-- Session Progress -->
      <div class="progress-section">
        <div class="progress-header">
          <span class="progress-label">Прогресс сессии</span>
          <span class="progress-value" id="session-time">0ч 0м</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" id="session-bar"></div>
        </div>
      </div>

      <!-- Cards Progress -->
      <div class="progress-section">
        <div class="progress-header">
          <span class="progress-label">До следующей карточки</span>
          <span class="progress-value" id="cards-timer">0м</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" id="cards-bar"></div>
        </div>
      </div>

      <!-- Games List -->
      <div class="games-section">
        <div class="section-title">Игры для фарминга</div>
        <div id="games-list"></div>
      </div>

      <!-- Controls -->
      <div class="controls">
        <button class="btn" id="add-btn">+ Добавить</button>
        <button class="btn" id="check-btn">Игры</button>
        <button class="btn primary" id="toggle-btn">Остановить</button>
      </div>
    </div>
  </div>

  <!-- Modal -->
  <div class="modal" id="modal">
    <div class="modal-content">
      <div class="modal-title">Новый аккаунт</div>
      <div class="input-group">
        <label class="input-label">Логин Steam</label>
        <input type="text" class="input-field" id="inp-login" placeholder="Введите логин">
      </div>
      <div class="input-group">
        <label class="input-label">Пароль</label>
        <input type="password" class="input-field" id="inp-pass" placeholder="Введите пароль">
      </div>
      <div class="input-group">
        <label class="input-label">App ID игр (через запятую)</label>
        <input type="text" class="input-field" id="inp-apps" placeholder="730, 327920, 740">
      </div>
      <div class="modal-actions">
        <button class="btn" id="modal-cancel">Отмена</button>
        <button class="btn primary" id="modal-add">Добавить</button>
      </div>
    </div>
  </div>

<script>
(function() {
  // State
  let currentAccount = null;
  let theme = localStorage.getItem('theme') || 'dark';
  let cursorX = 0, cursorY = 0;
  let trailX = 0, trailY = 0;
  
  // Elements
  const el = id => document.getElementById(id);
  const cursor = el('cursor');
  const trail = el('cursor-trail');
  
  // Initialize Theme
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon();
  
  // Theme Toggle
  el('theme-toggle').addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    updateThemeIcon();
    notify('Тема: ' + (theme === 'dark' ? 'Тёмная' : 'Светлая'));
  });
  
  function updateThemeIcon() {
    const icon = el('theme-icon');
    if (theme === 'dark') {
      icon.innerHTML = '<path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>';
    } else {
      icon.innerHTML = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
    }
  }
  
  // Custom Cursor
  document.addEventListener('mousemove', (e) => {
    cursorX = e.clientX;
    cursorY = e.clientY;
    cursor.style.left = cursorX + 'px';
    cursor.style.top = cursorY + 'px';
  });
  
  // Smooth trail
  function animateTrail() {
    trailX += (cursorX - trailX) * 0.1;
    trailY += (cursorY - trailY) * 0.1;
    trail.style.left = trailX + 'px';
    trail.style.top = trailY + 'px';
    requestAnimationFrame(animateTrail);
  }
  animateTrail();
  
  // Cursor hover effect
  document.addEventListener('mouseover', (e) => {
    if (e.target.matches('.btn, .account-pill, .theme-toggle, input')) {
      cursor.classList.add('hover');
    }
  });
  
  document.addEventListener('mouseout', (e) => {
    if (e.target.matches('.btn, .account-pill, .theme-toggle, input')) {
      cursor.classList.remove('hover');
    }
  });
  
  // Click particles
  document.addEventListener('click', (e) => {
    createParticles(e.clientX, e.clientY);
  });
  
  function createParticles(x, y) {
    const colors = theme === 'dark' ? ['#00d4ff', '#00ff88', '#ffb800'] : ['#0066cc', '#00aa55', '#cc9900'];
    for (let i = 0; i < 8; i++) {
      const particle = document.createElement('div');
      particle.style.position = 'fixed';
      particle.style.left = x + 'px';
      particle.style.top = y + 'px';
      particle.style.width = '6px';
      particle.style.height = '6px';
      particle.style.background = colors[Math.floor(Math.random() * colors.length)];
      particle.style.borderRadius = '50%';
      particle.style.pointerEvents = 'none';
      particle.style.zIndex = '9999';
      particle.style.boxShadow = '0 0 10px ' + particle.style.background;
      document.body.appendChild(particle);
      
      const angle = (Math.PI * 2 * i) / 8;
      const velocity = 100;
      const tx = Math.cos(angle) * velocity;
      const ty = Math.sin(angle) * velocity;
      
      particle.animate([
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: 'translate(' + tx + 'px, ' + ty + 'px) scale(0)', opacity: 0 }
      ], {
        duration: 600,
        easing: 'cubic-bezier(0, .9, .57, 1)'
      }).onfinish = () => particle.remove();
    }
  }
  
  // 3D Card Tilt
  const card = el('main-card');
  document.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = (y - centerY) / 20;
    const rotateY = (centerX - x) / 20;
    
    card.style.transform = 'perspective(1000px) rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg)';
  });
  
  document.addEventListener('mouseleave', () => {
    card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0)';
  });
  
  // Star Canvas
  const canvas = el('star-canvas');
  const ctx = canvas.getContext('2d');
  let width, height;
  let stars = [];
  
  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    initStars();
  }
  
  function initStars() {
    stars = [];
    const count = Math.floor((width * height) / 3000);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 2 + 0.5,
        speed: Math.random() * 1.5 + 0.5,
        brightness: Math.random(),
        trail: []
      });
    }
  }
  
  function animateStars() {
    ctx.clearRect(0, 0, width, height);
    
    stars.forEach(star => {
      // Update position
      star.y += star.speed;
      star.brightness += 0.02;
      if (star.brightness > 1) star.brightness = 0.3;
      
      // Trail
      star.trail.push({ x: star.x, y: star.y });
      if (star.trail.length > 10) star.trail.shift();
      
      // Draw trail
      star.trail.forEach((point, i) => {
        const alpha = (i / star.trail.length) * star.brightness * 0.5;
        const size = star.size * (i / star.trail.length);
        ctx.beginPath();
        ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, ' + alpha + ')';
        ctx.fill();
      });
      
      // Draw star with glow
      const gradient = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.size * 3);
      gradient.addColorStop(0, 'rgba(255, 255, 255, ' + star.brightness + ')');
      gradient.addColorStop(0.5, 'rgba(255, 255, 255, ' + (star.brightness * 0.3) + ')');
      gradient.addColorStop(1, 'transparent');
      
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size * 3, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      
      // Reset if out of bounds
      if (star.y > height + 20) {
        star.y = -20;
        star.x = Math.random() * width;
        star.trail = [];
      }
    });
    
    requestAnimationFrame(animateStars);
  }
  
  window.addEventListener('resize', resize);
  resize();
  animateStars();
  
  // Confetti System
  const confettiCanvas = el('confetti-canvas');
  const confettiCtx = confettiCanvas.getContext('2d');
  let confettiParticles = [];
  
  function resizeConfetti() {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
  
  window.addEventListener('resize', resizeConfetti);
  resizeConfetti();
  
  function launchConfetti() {
    confettiParticles = [];
    const colors = ['#00d4ff', '#00ff88', '#ffb800', '#ff6b6b', '#a855f7'];
    
    for (let i = 0; i < 100; i++) {
      confettiParticles.push({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        vx: (Math.random() - 0.5) * 20,
        vy: (Math.random() - 0.5) * 20 - 5,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 10,
        gravity: 0.3,
        drag: 0.96
      });
    }
    
    animateConfetti();
  }
  
  function animateConfetti() {
    if (confettiParticles.length === 0) return;
    
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    
    confettiParticles = confettiParticles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.rotation += p.rotationSpeed;
      
      confettiCtx.save();
      confettiCtx.translate(p.x, p.y);
      confettiCtx.rotate((p.rotation * Math.PI) / 180);
      confettiCtx.fillStyle = p.color;
      confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      confettiCtx.restore();
      
      return p.y < window.innerHeight + 50;
    });
    
    if (confettiParticles.length > 0) {
      requestAnimationFrame(animateConfetti);
    } else {
      confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }
  }
  
  // Dynamic Island with Typewriter Effect
  function notify(message, isAchievement = false) {
    const island = el('dynamic-island');
    island.textContent = '';
    island.className = 'dynamic-island' + (isAchievement ? ' achievement' : '');
    
    // Typewriter effect
    let i = 0;
    const type = () => {
      if (i < message.length) {
        island.textContent += message.charAt(i);
        i++;
        setTimeout(type, 30);
      }
    };
    
    island.classList.add('show');
    type();
    
    setTimeout(() => {
      island.classList.remove('show');
    }, 4000);
  }
  
  // Number Counting Animation
  function animateNumber(element, start, end, duration = 1000) {
    const startTime = performance.now();
    const update = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const current = start + (end - start) * easeOutQuart;
      
      if (element.id.includes('hours')) {
        element.textContent = current.toFixed(2);
      } else {
        element.textContent = Math.floor(current);
      }
      
      if (progress < 1) {
        requestAnimationFrame(update);
      }
    };
    
    requestAnimationFrame(update);
  }
  
  // Scanner Effect
  function triggerScanner() {
    const scanner = el('scanner');
    scanner.classList.remove('active');
    void scanner.offsetWidth; // Trigger reflow
    scanner.classList.add('active');
  }
  
  // Load Accounts
  function loadAccounts() {
    fetch('/accounts')
      .then(r => r.json())
      .then(data => {
        const bar = el('accounts-bar');
        bar.innerHTML = '';
        data.accounts.forEach(acc => {
          const pill = document.createElement('div');
          pill.className = 'account-pill' + (acc.id === data.currentAccount ? ' active' : '');
          pill.textContent = acc.login;
          pill.onclick = () => switchAccount(acc.id);
          bar.appendChild(pill);
        });
        
        if (data.currentAccount && !currentAccount) {
          switchAccount(data.currentAccount);
        }
      });
  }
  
  function switchAccount(id) {
    currentAccount = id;
    loadStatus();
  }
  
  function loadStatus() {
    if (!currentAccount) return;
    
    fetch('/status/' + currentAccount)
      .then(r => r.json())
      .then(data => {
        triggerScanner();
        
        // Animate numbers
        const hoursEl = el('hours-value');
        const cardsEl = el('cards-value');
        const currentHours = parseFloat(hoursEl.textContent) || 0;
        const currentCards = parseInt(cardsEl.textContent) || 0;
        
        if (Math.abs(parseFloat(data.totalHours) - currentHours) > 0.01) {
          animateNumber(hoursEl, currentHours, parseFloat(data.totalHours), 1000);
        } else {
          hoursEl.textContent = data.totalHours;
        }
        
        if (data.totalCards > currentCards) {
          animateNumber(cardsEl, currentCards, data.totalCards, 1000);
          if (data.totalCards - currentCards > 0) {
            notify('🎴 +' + (data.totalCards - currentCards) + ' карточек!');
          }
        } else {
          cardsEl.textContent = data.totalCards;
        }
        
        // Update progress bars
        el('session-bar').style.width = data.cardProgress + '%';
        el('cards-bar').style.width = data.cardProgress + '%';
        el('cards-timer').textContent = data.cardTimer;
        
        // Update session time
        const totalMins = Math.floor(parseFloat(data.totalHours) * 60);
        const hours = Math.floor(totalMins / 60) % 24;
        const mins = totalMins % 60;
        el('session-time').textContent = hours + 'ч ' + mins + 'м';
        
        // Update status
        const badge = el('status-badge');
        const statusText = el('status-text');
        const toggleBtn = el('toggle-btn');
        const card = el('main-card');
        
        if (data.loggedIn) {
          badge.className = 'status-badge';
          statusText.textContent = 'Фарм идёт';
          toggleBtn.textContent = 'Остановить';
          card.classList.add('active');
        } else {
          badge.className = 'status-badge offline';
          statusText.textContent = 'Остановлен';
          toggleBtn.textContent = 'Запустить';
          card.classList.remove('active');
        }
        
        // Render games
        renderGames(data.appIds);
      })
      .catch(e => console.error(e));
  }
  
  function renderGames(appIds) {
    const list = el('games-list');
    list.innerHTML = '';
    
    if (!appIds || appIds.length === 0) {
      list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">Нет игр для фарминга</div>';
      return;
    }
    
    const gameNames = {
      '730': 'Counter-Strike 2',
      '740': 'Counter-Strike: Global Offensive',
      '327920': 'Geometry Dash'
    };
    
    appIds.forEach(id => {
      const item = document.createElement('div');
      item.className = 'game-item';
      const name = gameNames[id.toString()] || 'App ' + id;
      item.innerHTML = '<span class="game-name">' + name + '</span><span class="game-id">' + id + '</span>';
      list.appendChild(item);
    });
  }
  
  // Modal Controls
  const modal = el('modal');
  el('add-btn').onclick = () => modal.classList.add('show');
  el('modal-cancel').onclick = () => modal.classList.remove('show');
  modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('show'); };
  
  el('modal-add').onclick = () => {
    const login = el('inp-login').value.trim();
    const pass = el('inp-pass').value;
    const appsStr = el('inp-apps').value;
    const apps = appsStr ? appsStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : [730, 327920];
    
    if (!login || !pass) {
      notify('⚠️ Введите логин и пароль');
      return;
    }
    
    fetch('/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password: pass, apps })
    })
    .then(() => {
      modal.classList.remove('show');
      el('inp-login').value = '';
      el('inp-pass').value = '';
      el('inp-apps').value = '';
      notify('✅ Аккаунт добавлен');
      loadAccounts();
    })
    .catch(e => notify('❌ Ошибка: ' + e.message));
  };
  
  // Toggle Button
  el('toggle-btn').onclick = () => {
    const action = el('toggle-btn').textContent === 'Остановить' ? 'stop' : 'start';
    fetch('/control/' + currentAccount, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
  };
  
  // Check Games Button
  el('check-btn').onclick = () => {
    fetch('/control/' + currentAccount, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check' })
    });
    notify('🔍 Поиск новых игр...');
  };
  
  // Initialize
  loadAccounts();
  setInterval(loadStatus, 300000); // 5 minutes
  
  // Interactive stars on click
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Find nearest star and explode it
    stars.forEach(star => {
      const dist = Math.sqrt(Math.pow(star.x - x, 2) + Math.pow(star.y - y, 2));
      if (dist < 50) {
        // Create explosion particles
        for (let i = 0; i < 12; i++) {
          const particle = {
            x: star.x,
            y: star.y,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 1,
            size: Math.random() * 3 + 1
          };
          
          animateExplosion(particle);
        }
        
        star.x = Math.random() * width;
        star.y = -20;
        star.trail = [];
      }
    });
  });
  
  function animateExplosion(p) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    
    function draw() {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.2;
      p.life -= 0.02;
      
      if (p.life <= 0) return;
      
      tempCtx.beginPath();
      tempCtx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      tempCtx.fillStyle = 'rgba(255, 255, 255, ' + p.life + ')';
      tempCtx.fill();
      
      ctx.drawImage(tempCanvas, 0, 0);
      requestAnimationFrame(draw);
    }
    
    draw();
  }
  
})();
</script>
</body>
</html>`;
