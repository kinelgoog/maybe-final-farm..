const express = require('express');
const fs = require('fs');
const path = require('path');

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
    id: 'acc_' + Date.now(),
    login,
    password,
    appIds: apps,
    loggedIn: false,
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
  return (h ? h + 'ч ' : '') + m + 'м';
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('✅ Server running on port ' + PORT);
});

// === FULL HTML (NO TEMPLATE STRINGS, NO ${}, ONLY STRING CONCATENATION) ===
const HTML = '<!DOCTYPE html>\n' +
'<html lang="ru">\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
'<title>Steam Idler — Premium</title>\n' +
'<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">\n' +
'<style>\n' +
':root{--bg-primary:#0a0a0f;--bg-secondary:#12121a;--card-bg:rgba(20,20,30,0.6);--card-border:rgba(255,255,255,0.08);--text-primary:#fff;--text-secondary:#a0a0b0;--accent:#a855f7;--accent-glow:rgba(168,85,247,0.3);--success:#00ff88;--success-glow:rgba(0,255,136,0.3);--warning:#ffb800;--font-main:"Inter",sans-serif;--font-mono:"JetBrains Mono",monospace}\n' +
'[data-theme="light"]{--bg-primary:#f0f2f5;--bg-secondary:#fff;--card-bg:rgba(255,255,255,0.7);--card-border:rgba(0,0,0,0.08);--text-primary:#1a1a2e;--text-secondary:#666677;--accent:#7e3af2;--accent-glow:rgba(126,58,242,0.2);--success:#00aa55;--success-glow:rgba(0,170,85,0.2);--warning:#cc9900}\n' +
'*{margin:0;padding:0;box-sizing:border-box}\n' +
'body{background:var(--bg-primary);color:var(--text-primary);font-family:var(--font-main);min-height:100vh;overflow-x:hidden;transition:background 0.5s,color 0.5s}\n' +
'#star-canvas{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}\n' +
'.glass-card{background:var(--card-bg);backdrop-filter:blur(24px);border:1px solid var(--card-border);border-radius:24px;padding:30px;box-shadow:0 8px 32px rgba(0,0,0,0.3),inset 0 1px 0 rgba(255,255,255,0.05);position:relative;overflow:hidden;contain:strict}\n' +
'.glass-card::before{content:"";position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle,var(--accent-glow) 0%,transparent 70%);opacity:0.3;z-index:-1}\n' +
'.dynamic-island{position:fixed;top:90px;left:50%;transform:translateX(-50%) translateY(-100px) scale(0.8);background:var(--card-bg);backdrop-filter:blur(24px);border:1px solid var(--card-border);border-radius:20px;padding:16px 28px;color:var(--text-primary);font-size:15px;font-weight:600;z-index:1000;opacity:0;transition:all 0.4s cubic-bezier(0.175,0.885,0.32,1.275);box-shadow:0 12px 40px rgba(0,0,0,0.3);min-width:300px;text-align:center;contain:strict}\n' +
'.dynamic-island.show{transform:translateX(-50%) translateY(0) scale(1);opacity:1}\n' +
'.accounts-bar{position:fixed;top:20px;left:50%;transform:translateX(-50%);display:flex;gap:10px;padding:10px 20px;background:var(--card-bg);backdrop-filter:blur(20px);border:1px solid var(--card-border);border-radius:50px;z-index:100;box-shadow:0 8px 32px rgba(0,0,0,0.2)}\n' +
'.account-pill{padding:8px 20px;background:transparent;border:1px solid var(--card-border);border-radius:30px;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-secondary);transition:all 0.3s ease}\n' +
'.account-pill.active{background:var(--accent);color:white;border-color:var(--accent);box-shadow:0 0 20px var(--accent-glow)}\n' +
'.theme-toggle{position:fixed;top:20px;right:20px;width:50px;height:50px;border-radius:50%;background:var(--card-bg);backdrop-filter:blur(20px);border:1px solid var(--card-border);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:100;box-shadow:0 8px 32px rgba(0,0,0,0.2);transition:all 0.3s ease}\n' +
'.theme-icon{width:22px;height:22px;fill:var(--text-primary)}\n' +
'.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:30px}\n' +
'.stat-box{background:rgba(255,255,255,0.03);border:1px solid var(--card-border);border-radius:16px;padding:20px;text-align:center;transition:transform 0.2s ease}\n' +
'.stat-box:hover{transform:translateY(-2px)}\n' +
'.stat-value{font-size:36px;font-weight:700;font-family:var(--font-mono);color:var(--text-primary);margin-bottom:8px}\n' +
'.stat-label{font-size:12px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.1em}\n' +
'.progress-bar-container{height:8px;background:rgba(255,255,255,0.05);border-radius:10px;overflow:hidden;position:relative}\n' +
'.progress-bar{height:100%;background:linear-gradient(90deg,var(--accent),var(--success));border-radius:10px;width:0%;transition:width 1s cubic-bezier(0.4,0,0.2,1);position:relative}\n' +
'.progress-bar::after{content:"";position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.3),transparent);animation:shimmer 2s infinite}\n' +
'@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}\n' +
'.game-item{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(255,255,255,0.03);border:1px solid var(--card-border);border-radius:12px;margin-bottom:8px;transition:all 0.3s ease}\n' +
'.game-item:hover{background:rgba(255,255,255,0.06);border-color:var(--accent)}\n' +
'.game-name{font-weight:600;font-size:14px}\n' +
'.game-id{font-size:12px;color:var(--text-secondary);font-family:var(--font-mono)}\n' +
'.controls{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:30px}\n' +
'.btn{padding:14px 20px;border:none;border-radius:12px;font-family:var(--font-main);font-weight:600;font-size:14px;cursor:pointer;background:rgba(255,255,255,0.05);color:var(--text-primary);border:1px solid var(--card-border);transition:all 0.3s ease}\n' +
'.btn.primary{background:var(--accent);color:white;border-color:var(--accent);box-shadow:0 4px 20px var(--accent-glow)}\n' +
'.modal{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(10px);display:none;align-items:center;justify-content:center;z-index:1000;opacity:0;transition:opacity 0.3s}\n' +
'.modal.show{display:flex;opacity:1}\n' +
'.modal-content{background:var(--card-bg);backdrop-filter:blur(24px);border:1px solid var(--card-border);border-radius:24px;padding:30px;width:90%;max-width:450px;box-shadow:0 24px 64px rgba(0,0,0,0.4);contain:strict}\n' +
'.modal-title{font-size:24px;font-weight:700;margin-bottom:24px}\n' +
'.input-field{width:100%;padding:14px 18px;background:rgba(255,255,255,0.05);border:1px solid var(--card-border);border-radius:12px;color:var(--text-primary);font-family:var(--font-main);font-size:15px;transition:all 0.3s ease}\n' +
'.input-field:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow)}\n' +
'@media(max-width:640px){.stats-grid{grid-template-columns:1fr}.controls{grid-template-columns:1fr}}\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<canvas id="star-canvas"></canvas>\n' +
'<div class="theme-toggle" id="theme-toggle"><svg class="theme-icon" viewBox="0 0 24 24"><path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg></div>\n' +
'<div class="accounts-bar" id="accounts-bar"></div>\n' +
'<div class="dynamic-island" id="dynamic-island"></div>\n' +
'<div style="max-width:600px;margin:0 auto;padding:80px 20px 40px;">\n' +
'  <div class="glass-card" id="main-card">\n' +
'    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:30px;padding-bottom:20px;border-bottom:1px solid var(--card-border);">\n' +
'      <div>\n' +
'        <div style="font-size:24px;font-weight:700;background:linear-gradient(135deg,var(--text-primary),var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Steam Idler</div>\n' +
'        <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;">Premium Farming System</div>\n' +
'      </div>\n' +
'      <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;background:rgba(0,255,136,0.1);border:1px solid var(--success);border-radius:30px;font-size:13px;font-weight:600;color:var(--success);">\n' +
'        <span style="width:8px;height:8px;border-radius:50%;background:var(--success);animation:pulse 2s ease-in-out infinite;"></span>\n' +
'        <span id="status-text">Фарм идёт</span>\n' +
'      </div>\n' +
'    </div>\n' +
'    <div class="stats-grid">\n' +
'      <div class="stat-box"><div class="stat-value" id="hours-value">0.00</div><div class="stat-label">Всего часов</div></div>\n' +
'      <div class="stat-box"><div class="stat-value" id="cards-value">0</div><div class="stat-label">Карточек</div></div>\n' +
'    </div>\n' +
'    <div style="margin-bottom:25px;">\n' +
'      <div style="display:flex;justify-content:space-between;margin-bottom:10px;">\n' +
'        <span style="font-size:13px;color:var(--text-secondary);font-weight:500;">Прогресс сессии</span>\n' +
'        <span style="font-size:13px;font-family:var(--font-mono);font-weight:600;color:var(--accent);" id="session-time">0ч 0м</span>\n' +
'      </div>\n' +
'      <div class="progress-bar-container"><div class="progress-bar" id="session-bar"></div></div>\n' +
'    </div>\n' +
'    <div style="margin-bottom:25px;">\n' +
'      <div style="display:flex;justify-content:space-between;margin-bottom:10px;">\n' +
'        <span style="font-size:13px;color:var(--text-secondary);font-weight:500;">До следующей карточки</span>\n' +
'        <span style="font-size:13px;font-family:var(--font-mono);font-weight:600;color:var(--accent);" id="cards-timer">0м</span>\n' +
'      </div>\n' +
'      <div class="progress-bar-container"><div class="progress-bar" id="cards-bar"></div></div>\n' +
'    </div>\n' +
'    <div style="margin:25px 0;">\n' +
'      <div style="font-size:13px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.1em;font-weight:600;margin-bottom:15px;">Игры для фарминга</div>\n' +
'      <div id="games-list" style="min-height:60px;"></div>\n' +
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
'    <div style="margin-bottom:20px;">\n' +
'      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">Логин Steam</div>\n' +
'      <input type="text" class="input-field" id="inp-login" placeholder="Введите логин">\n' +
'    </div>\n' +
'    <div style="margin-bottom:20px;">\n' +
'      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">Пароль</div>\n' +
'      <input type="password" class="input-field" id="inp-pass" placeholder="Введите пароль">\n' +
'    </div>\n' +
'    <div style="margin-bottom:20px;">\n' +
'      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">App ID игр (через запятую)</div>\n' +
'      <input type="text" class="input-field" id="inp-apps" placeholder="730, 4465480, 322170">\n' +
'    </div>\n' +
'    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">\n' +
'      <button class="btn" id="modal-cancel">Отмена</button>\n' +
'      <button class="btn primary" id="modal-add">Добавить</button>\n' +
'    </div>\n' +
'  </div>\n' +
'</div>\n' +
'<script>\n' +
'(function(){\n' +
'  let currentAccount = null;\n' +
'  let theme = localStorage.getItem("theme") || "dark";\n' +
'  document.documentElement.setAttribute("data-theme", theme);\n' +
'  \n' +
'  const el = function(id){return document.getElementById(id)};\n' +
'  \n' +
'  // Theme toggle\n' +
'  el("theme-toggle").addEventListener("click", function(){\n' +
'    theme = theme === "dark" ? "light" : "dark";\n' +
'    document.documentElement.setAttribute("data-theme", theme);\n' +
'    localStorage.setItem("theme", theme);\n' +
'    const icon = el("theme-icon");\n' +
'    if(theme === "dark"){icon.innerHTML = \'<path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>\';}\n' +
'    else{icon.innerHTML = \'<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>\';}\n' +
'  });\n' +
'  \n' +
'  // Star Canvas\n' +
'  const canvas = el("star-canvas");\n' +
'  const ctx = canvas.getContext("2d");\n' +
'  let width, height;\n' +
'  let stars = [];\n' +
'  \n' +
'  function resize(){\n' +
'    width = canvas.width = window.innerWidth;\n' +
'    height = canvas.height = window.innerHeight;\n' +
'    initStars();\n' +
'  }\n' +
'  \n' +
'  function initStars(){\n' +
'    stars = [];\n' +
'    const count = Math.min(80, Math.floor((width * height) / 4000));\n' +
'    for(let i = 0; i < count; i++){\n' +
'      stars.push({\n' +
'        x: Math.random() * width,\n' +
'        y: Math.random() * height,\n' +
'        size: Math.random() * 2 + 0.5,\n' +
'        speed: Math.random() * 1.2 + 0.3,\n' +
'        brightness: Math.random() * 0.7 + 0.3\n' +
'      });\n' +
'    }\n' +
'  }\n' +
'  \n' +
'  function drawStar(x, y, size){\n' +
'    ctx.beginPath();\n' +
'    const angle = Math.PI / 5;\n' +
'    for(let i = 0; i < 10; i++){\n' +
'      const r = i % 2 === 0 ? size : size * 0.4;\n' +
'      const theta = i * angle;\n' +
'      const px = x + Math.cos(theta) * r;\n' +
'      const py = y + Math.sin(theta) * r;\n' +
'      if(i === 0) ctx.moveTo(px, py);\n' +
'      else ctx.lineTo(px, py);\n' +
'    }\n' +
'    ctx.closePath();\n' +
'    ctx.fillStyle = "rgba(255, 255, 255, " + (size * 0.3);\n' +
'    ctx.fill();\n' +
'  }\n' +
'  \n' +
'  function animateStars(){\n' +
'    ctx.clearRect(0, 0, width, height);\n' +
'    for(let i = 0; i < stars.length; i++){\n' +
'      const star = stars[i];\n' +
'      star.y += star.speed;\n' +
'      star.brightness += 0.005;\n' +
'      if(star.brightness > 1) star.brightness = 0.3;\n' +
'      drawStar(star.x, star.y, star.size * star.brightness);\n' +
'      if(star.y > height + 20){\n' +
'        star.y = -20;\n' +
'        star.x = Math.random() * width;\n' +
'      }\n' +
'    }\n' +
'    requestAnimationFrame(animateStars);\n' +
'  }\n' +
'  \n' +
'  window.addEventListener("resize", resize);\n' +
'  resize();\n' +
'  animateStars();\n' +
'  \n' +
'  // Notify\n' +
'  function notify(msg, isAch){\n' +
'    const island = el("dynamic-island");\n' +
'    island.textContent = msg;\n' +
'    island.className = "dynamic-island" + (isAch ? " achievement" : "");\n' +
'    island.classList.add("show");\n' +
'    setTimeout(function(){island.classList.remove("show")}, 4000);\n' +
'  }\n' +
'  \n' +
'  // Number animation\n' +
'  function animateNumber(el, start, end, dur){\n' +
'    const st = performance.now();\n' +
'    function update(now){\n' +
'      const elapsed = now - st;\n' +
'      const progress = Math.min(elapsed / dur, 1);\n' +
'      const ease = 1 - Math.pow(1 - progress, 4);\n' +
'      const cur = start + (end - start) * ease;\n' +
'      if(el.id.indexOf("hours") > -1){\n' +
'        el.textContent = cur.toFixed(2);\n' +
'      }else{\n' +
'        el.textContent = Math.floor(cur);\n' +
'      }\n' +
'      if(progress < 1) requestAnimationFrame(update);\n' +
'    }\n' +
'    requestAnimationFrame(update);\n' +
'  }\n' +
'  \n' +
'  // Load accounts\n' +
'  function loadAccounts(){\n' +
'    fetch("/accounts").then(function(r){return r.json()}).then(function(data){\n' +
'      const bar = el("accounts-bar");\n' +
'      bar.innerHTML = "";\n' +
'      data.accounts.forEach(function(acc){\n' +
'        const pill = document.createElement("div");\n' +
'        pill.className = "account-pill" + (acc.id === data.currentAccount ? " active" : "");\n' +
'        pill.textContent = acc.login;\n' +
'        pill.onclick = function(){switchAccount(acc.id)};\n' +
'        bar.appendChild(pill);\n' +
'      });\n' +
'      if(data.currentAccount && !currentAccount){\n' +
'        switchAccount(data.currentAccount);\n' +
'      }\n' +
'    });\n' +
'  }\n' +
'  \n' +
'  function switchAccount(id){\n' +
'    currentAccount = id;\n' +
'    loadStatus();\n' +
'  }\n' +
'  \n' +
'  function loadStatus(){\n' +
'    if(!currentAccount) return;\n' +
'    fetch("/status/" + currentAccount).then(function(r){return r.json()}).then(function(d){\n' +
'      const hEl = el("hours-value");\n' +
'      const cEl = el("cards-value");\n' +
'      const curH = parseFloat(hEl.textContent) || 0;\n' +
'      const curC = parseInt(cEl.textContent) || 0;\n' +
'      \n' +
'      if(Math.abs(parseFloat(d.totalHours) - curH) > 0.01){\n' +
'        animateNumber(hEl, curH, parseFloat(d.totalHours), 1000);\n' +
'      }else{\n' +
'        hEl.textContent = d.totalHours;\n' +
'      }\n' +
'      \n' +
'      if(d.totalCards > curC){\n' +
'        animateNumber(cEl, curC, d.totalCards, 1000);\n' +
'        if(d.totalCards - curC > 0){\n' +
'          notify("🎴 +" + (d.totalCards - curC) + " карточек!");\n' +
'        }\n' +
'      }else{\n' +
'        cEl.textContent = d.totalCards;\n' +
'      }\n' +
'      \n' +
'      el("session-bar").style.width = d.cardProgress + "%";\n' +
'      el("cards-bar").style.width = d.cardProgress + "%";\n' +
'      \n' +
'      const tm = Math.floor(parseFloat(d.totalHours) * 60);\n' +
'      const hh = Math.floor(tm / 60) % 24;\n' +
'      const mm = tm % 60;\n' +
'      el("session-time").textContent = hh + "ч " + mm + "м";\n' +
'      \n' +
'      const st = el("status-text");\n' +
'      const tb = el("toggle-btn");\n' +
'      if(d.loggedIn){\n' +
'        st.textContent = "Фарм идёт";\n' +
'        tb.textContent = "Остановить";\n' +
'      }else{\n' +
'        st.textContent = "Остановлен";\n' +
'        tb.textContent = "Запустить";\n' +
'      }\n' +
'      \n' +
'      // Render games\n' +
'      const list = el("games-list");\n' +
'      list.innerHTML = "";\n' +
'      if(!d.appIds || d.appIds.length === 0){\n' +
'        list.innerHTML = "<div style=\\"padding:20px;text-align:center;color:var(--text-secondary)\\">Нет игр для фарминга</div>";\n' +
'        return;\n' +
'      }\n' +
'      const names = {"730":"Counter-Strike 2","4465480":"CS:GO","322170":"Geometry Dash"};\n' +
'      d.appIds.forEach(function(id){\n' +
'        const item = document.createElement("div");\n' +
'        item.className = "game-item";\n' +
'        const name = names[id.toString()] || "App " + id;\n' +
'        item.innerHTML = "<span class=\\"game-name\\">" + name + "</span><span class=\\"game-id\\">" + id + "</span>";\n' +
'        list.appendChild(item);\n' +
'      });\n' +
'    }).catch(function(e){console.error(e)});\n' +
'  }\n' +
'  \n' +
'  // Modal\n' +
'  const modal = el("modal");\n' +
'  el("add-btn").onclick = function(){modal.classList.add("show")};\n' +
'  el("modal-cancel").onclick = function(){modal.classList.remove("show")};\n' +
'  modal.onclick = function(e){if(e.target === modal) modal.classList.remove("show")};\n' +
'  \n' +
'  el("modal-add").onclick = function(){\n' +
'    const lg = el("inp-login").value.trim();\n' +
'    const ps = el("inp-pass").value;\n' +
'    const ap = el("inp-apps").value;\n' +
'    const apps = ap ? ap.split(",").map(function(s){return parseInt(s.trim())}).filter(function(n){return !isNaN(n)}) : [730, 4465480, 322170];\n' +
'    if(!lg || !ps){\n' +
'      notify("⚠️ Введите логин и пароль");\n' +
'      return;\n' +
'    }\n' +
'    fetch("/accounts", {\n' +
'      method: "POST",\n' +
'      headers: {"Content-Type": "application/json"},\n' +
'      body: JSON.stringify({login: lg, password: ps, apps: apps})\n' +
'    }).then(function(){\n' +
'      modal.classList.remove("show");\n' +
'      el("inp-login").value = "";\n' +
'      el("inp-pass").value = "";\n' +
'      el("inp-apps").value = "";\n' +
'      notify("✅ Аккаунт добавлен");\n' +
'      loadAccounts();\n' +
'    }).catch(function(e){notify("❌ Ошибка: " + e.message)});\n' +
'  };\n' +
'  \n' +
'  el("toggle-btn").onclick = function(){\n' +
'    const act = el("toggle-btn").textContent === "Остановить" ? "stop" : "start";\n' +
'    fetch("/control/" + currentAccount, {\n' +
'      method: "POST",\n' +
'      headers: {"Content-Type": "application/json"},\n' +
'      body: JSON.stringify({action: act})\n' +
'    });\n' +
'  };\n' +
'  \n' +
'  el("check-btn").onclick = function(){\n' +
'    fetch("/control/" + currentAccount, {\n' +
'      method: "POST",\n' +
'      headers: {"Content-Type": "application/json"},\n' +
'      body: JSON.stringify({action: "check"})\n' +
'    });\n' +
'    notify("🔍 Поиск новых игр...");\n' +
'  };\n' +
'  \n' +
'  loadAccounts();\n' +
'  setInterval(loadStatus, 300000);\n' +
'})();\n' +
'</script>\n' +
'</body>\n' +
'</html>';
