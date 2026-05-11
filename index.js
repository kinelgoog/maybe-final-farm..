const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Путь к данным
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

// === API ===
app.get('/', (req, res) => {
  res.send(HTML);
});

app.get('/accounts', (req, res) => {
  const accounts = persisted.accounts.map(a => ({
    id: a.id,
    login: a.login,
    loggedIn: a.loggedIn || false,
    totalHours: a.startTime ? ((Date.now() - a.startTime) / 3600000).toFixed(2) : '0.00',
    totalCards: a.totalCards || 0
  }));
  res.json({ accounts, currentAccount: persisted.currentAccount });
});

app.post('/accounts', (req, res) => {
  const { login, password, apps = [730, 4465480, 322170] } = req.body;
  const newAccount = {
    id: `acc_${Date.now()}`,
    login,
    password,
    appIds: apps,
    loggedIn: false,
    status: 'connecting',
    totalMinutes: 0,
    totalCards: 0,
    achievements: [],
    startTime: null
  };
  persisted.accounts.push(newAccount);
  persisted.currentAccount = newAccount.id;
  saveData(persisted);
  res.status(201).json({ id: newAccount.id });
});

app.post('/control/:id', (req, res) => {
  const { action } = req.body;
  const acc = persisted.accounts.find(a => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });

  if (action === 'start') {
    acc.loggedIn = true;
    acc.startTime = Date.now();
  } else if (action === 'stop') {
    acc.loggedIn = false;
    if (acc.startTime) {
      acc.totalMinutes += Math.floor((Date.now() - acc.startTime) / 60000);
      acc.startTime = null;
    }
  }

  saveData(persisted);
  res.json({ ok: true });
});

app.get('/status/:id', (req, res) => {
  const acc = persisted.accounts.find(a => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });

  const totalHours = acc.totalMinutes / 60;
  const dropsPerHour = acc.appIds.length * 2;
  const minutesSinceStart = acc.startTime ? Math.floor((Date.now() - acc.startTime) / 60000) : 0;
  const progress = Math.min(100, (minutesSinceStart / (60 / dropsPerHour)) * 100);

  res.json({
    id: acc.id,
    loggedIn: acc.loggedIn,
    login: acc.login,
    totalHours: totalHours.toFixed(2),
    totalCards: acc.totalCards,
    cardProgress: progress.toFixed(0),
    cardTimer: formatMinutes(60 / dropsPerHour - minutesSinceStart),
    achievements: acc.achievements,
    appIds: acc.appIds
  });
});

app.get('/health', (req, res) => res.status(200).send('OK'));

function formatMinutes(minutes) {
  if (minutes <= 0) return '0м';
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${h ? h + 'ч ' : ''}${m}м`;
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// === HTML + CSS + JS (без шаблонных строк, безопасно для Render) ===
const HTML = `
<!DOCTYPE html>
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
  --accent: #a855f7;
  --accent-glow: rgba(168, 85, 247, 0.3);
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
  --accent: #7e3af2;
  --accent-glow: rgba(126, 58, 242, 0.2);
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
  transition: background 0.5s ease, color 0.5s ease;
}

/* Star Canvas */
#star-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}

/* Liquid Glass Card */
.glass-card {
  background: var(--card-bg);
  backdrop-filter: blur(24px);
  border: 1px solid var(--card-border);
  border-radius: 24px;
  padding: 30px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  position: relative;
  overflow: hidden;
  contain: strict;
}

.glass-card::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
  opacity: 0.3;
  z-index: -1;
}

/* Dynamic Island */
.dynamic-island {
  position: fixed;
  top: 90px;
  left: 50%;
  transform: translateX(-50%) translateY(-100px) scale(0.8);
  background: var(--card-bg);
  backdrop-filter: blur(24px);
  border: 1px solid var(--card-border);
  border-radius:20px;
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
  contain: strict;
}

.dynamic-island.show {
  transform: translateX(-50%) translateY(0) scale(1);
  opacity: 1;
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
}

.account-pill.active {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
  box-shadow: 0 0 20px var(--accent-glow);
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

.theme-icon {
  width: 22px;
  height: 22px;
  fill: var(--text-primary);
}

/* Stats */
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
  transition: transform 0.2s ease;
}

.stat-box:hover {
  transform: translateY(-2px);
}

.stat-value {
  font-size: 36px;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--text-primary);
  margin-bottom: 8px;
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

/* Progress Bars */
.progress-bar-container {
  height: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  overflow: hidden;
  position: relative;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--success));
  border-radius: 10px;
  width: 0%;
  transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.progress-bar::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
  animation: shimmer 2s infinite;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

/* Games List */
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
}

.game-item:hover {
  background: rgba(255, 255, 255, 0.06);
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
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
  border: 1px solid var(--card-border);
  transition: all 0.3s ease;
}

.btn.primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
  box-shadow: 0 4px 20px var(--accent-glow);
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
  backdrop-filter: blur(24px);
  border: 1px solid var(--card-border);
  border-radius: 24px;
  padding: 30px;
  width: 90%;
  max-width: 450px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
  contain: strict;
}

.modal-title {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 24px;
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
}

/* Responsive */
@media (max-width: 640px) {
  .stats-grid { grid-template-columns: 1fr; }
  .controls { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
  <canvas id="star-canvas"></canvas>
  <div class="theme-toggle" id="theme-toggle">
    <svg class="theme-icon" viewBox="0 0 24 24">
      <path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>
    </svg>
  </div>
  <div class="accounts-bar" id="accounts-bar"></div>
  <div class="dynamic-island" id="dynamic-island"></div>

  <div style="max-width:600px;margin:0 auto;padding:80px 20px 40px;">
    <div class="glass-card" id="main-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:30px;padding-bottom:20px;border-bottom:1px solid var(--card-border);">
        <div>
          <div style="font-size:24px;font-weight:700;background:linear-gradient(135deg,var(--text-primary),var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Steam Idler</div>
          <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;">Premium Farming System</div>
        </div>
        <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;background:rgba(0,255,136,0.1);border:1px solid var(--success);border-radius:30px;font-size:13px;font-weight:600;color:var(--success);">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--success);animation:pulse 2s ease-in-out infinite;"></span>
          <span id="status-text">Фарм идёт</span>
        </div>
      </div>

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

      <div style="margin-bottom:25px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
          <span style="font-size:13px;color:var(--text-secondary);font-weight:500;">Прогресс сессии</span>
          <span style="font-size:13px;font-family:var(--font-mono);font-weight:600;color:var(--accent);" id="session-time">0ч 0м</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" id="session-bar"></div>
        </div>
      </div>

      <div style="margin-bottom:25px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
          <span style="font-size:13px;color:var(--text-secondary);font-weight:500;">До следующей карточки</span>
          <span style="font-size:13px;font-family:var(--font-mono);font-weight:600;color:var(--accent);" id="cards-timer">0м</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" id="cards-bar"></div>
        </div>
      </div>

      <div style="margin:25px 0;">
        <div style="font-size:13px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.1em;font-weight:600;margin-bottom:15px;">Игры для фарминга</div>
        <div id="games-list" style="min-height:60px;"></div>
      </div>

      <div class="controls">
        <button class="btn" id="add-btn">+ Добавить</button>
        <button class="btn" id="check-btn">Игры</button>
        <button class="btn primary" id="toggle-btn">Остановить</button>
      </div>
    </div>
  </div>

  <div class="modal" id="modal">
    <div class="modal-content">
      <div class="modal-title">Новый аккаунт</div>
      <div style="margin-bottom:20px;">
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">Логин Steam</div>
        <input type="text" class="input-field" id="inp-login" placeholder="Введите логин">
      </div>
      <div style="margin-bottom:20px;">
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">Пароль</div>
        <input type="password" class="input-field" id="inp-pass" placeholder="Введите пароль">
      </div>
      <div style="margin-bottom:20px;">
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">App ID игр (через запятую)</div>
        <input type="text" class="input-field" id="inp-apps" placeholder="730, 4465480, 322170">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <button class="btn" id="modal-cancel">Отмена</button>
        <button class="btn primary" id="modal-add">Добавить</button>
      </div>
    </div>
  </div>

<script>
(function(){
  let currentAccount = null;
  let theme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', theme);

  const el = id => document.getElementById(id);

  // Theme toggle
  el('theme-toggle').addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    const icon = el('theme-icon');
    if (theme === 'dark') {
      icon.innerHTML = '<path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>';
    } else {
      icon.innerHTML = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
    }
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
    const count = Math.min(80, Math.floor((width * height) / 4000));
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 2 + 0.5,
        speed: Math.random() * 1.2 + 0.3,
        brightness: Math.random() * 0.7 + 0.3
      });
    }
  }

  function drawStar(x, y, size) {
    ctx.beginPath();
    const angle = Math.PI / 5;
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? size : size * 0.4;
      const theta = i * angle;
      const px = x + Math.cos(theta) * r;
      const py = y + Math.sin(theta) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, ' + (size * 0.3) + ')';
    ctx.fill();
  }

  function animateStars() {
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      star.y += star.speed;
      star.brightness += 0.005;
      if (star.brightness > 1) star.brightness = 0.3;
      drawStar(star.x, star.y, star.size * star.brightness);
      if (star.y > height + 20) {
        star.y = -20;
        star.x = Math.random() * width;
      }
    }
    requestAnimationFrame(animateStars);
  }

  window.addEventListener('resize', resize);
  resize();
  animateStars();

  // Notify
  function notify(msg, isAchievement = false) {
    const island = el('dynamic-island');
    island.textContent = msg;
    island.className = 'dynamic-island' + (isAchievement ? ' achievement' : '');
    island.classList.add('show');
    setTimeout(() => island.classList.remove('show'), 4000);
  }

  // Number animation
  function animateNumber(el, start, end, dur = 1000) {
    const st = performance.now();
    const update = (now) => {
      const elapsed = now - st;
      const progress = Math.min(elapsed / dur, 1);
      const ease = 1 - Math.pow(1 - progress, 4);
      const cur = start + (end - start) * ease;
      if (el.id.includes('hours')) {
        el.textContent = cur.toFixed(2);
      } else {
        el.textContent = Math.floor(cur);
      }
      if (progress < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }

  // Load accounts
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
      .then(d => {
        const hEl = el('hours-value');
        const cEl = el('cards-value');
        const curH = parseFloat(hEl.textContent) || 0;
        const curC = parseInt(cEl.textContent) || 0;

        if (Math.abs(parseFloat(d.totalHours) - curH) > 0.01) {
          animateNumber(hEl, curH, parseFloat(d.totalHours), 1000);
        } else {
          hEl.textContent = d.totalHours;
        }

        if (d.totalCards > curC) {
          animateNumber(cEl, curC, d.totalCards, 1000);
          if (d.totalCards - curC > 0) {
            notify('🎴 +' + (d.totalCards - curC) + ' карточек!');
          }
        } else {
          cEl.textContent = d.totalCards;
        }

        el('session-bar').style.width = d.cardProgress + '%';
        el('cards-bar').style.width = d.cardProgress + '%';

        const tm = Math.floor(parseFloat(d.totalHours) * 60);
        const hh = Math.floor(tm / 60) % 24;
        const mm = tm % 60;
        el('session-time').textContent = hh + 'ч ' + mm + 'м';

        const st = el('status-text');
        const tb = el('toggle-btn');
        if (d.loggedIn) {
          st.textContent = 'Фарм идёт';
          tb.textContent = 'Остановить';
        } else {
          st.textContent = 'Остановлен';
          tb.textContent = 'Запустить';
        }

        // Render games
        const list = el('games-list');
        list.innerHTML = '';
        if (!d.appIds || d.appIds.length === 0) {
          list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Нет игр для фарминга</div>';
          return;
        }
        const names = {
          '730': 'Counter-Strike 2',
          '4465480': 'CS:GO',
          '322170': 'Geometry Dash'
        };
        d.appIds.forEach(id => {
          const item = document.createElement('div');
          item.className = 'game-item';
          const name = names[id] || 'App ' + id;
          item.innerHTML = `<span class="game-name">${name}</span><span class="game-id">${id}</span>`;
          list.appendChild(item);
        });
      })
      .catch(e => console.error(e));
  }

  // Modal
  const modal = el('modal');
  el('add-btn').onclick = () => modal.classList.add('show');
  el('modal-cancel').onclick = () => modal.classList.remove('show');
  modal.onclick = e => { if (e.target === modal) modal.classList.remove('show'); };

  el('modal-add').onclick = () => {
    const lg = el('inp-login').value.trim();
    const ps = el('inp-pass').value;
    const ap = el('inp-apps').value;
    const apps = ap ? ap.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : [730, 4465480, 322170];
    if (!lg || !ps) {
      notify('⚠️ Введите логин и пароль');
      return;
    }
    fetch('/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: lg, password: ps, apps })
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

  el('toggle-btn').onclick = () => {
    const act = el('toggle-btn').textContent === 'Остановить' ? 'stop' : 'start';
    fetch('/control/' + currentAccount, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: act })
    });
  };

  el('check-btn').onclick = () => {
    fetch('/control/' + currentAccount, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check' })
    });
    notify('🔍 Поиск новых игр...');
  };

  loadAccounts();
  setInterval(loadStatus, 300000);
})();
</script>
</body>
</html>
`;
