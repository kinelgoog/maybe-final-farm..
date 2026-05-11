const SteamUser = require('steam-user');
const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 10000;
const app = express();
app.use(express.json());
app.use(express.static('public'));

// Путь к файлу данных
const DATA_FILE = path.join('/tmp', 'idler_data.json');

// Загрузка данных
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return {
      accounts: [],
      currentAccount: null
    };
  }
}

// Сохранение данных
function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save data:', e);
  }
}

// Инициализация данных
let persisted = loadData();
if (!persisted.accounts) persisted.accounts = [];
if (!persisted.currentAccount) persisted.currentAccount = null;

// Клиенты Steam
const clients = {};

// Инициализация существующих аккаунтов
function initAccounts() {
  persisted.accounts.forEach(account => {
    if (account.loggedIn) {
      startFarming(account.id);
    }
  });
}

// Запуск фарминга
function startFarming(accountId) {
  const account = persisted.accounts.find(a => a.id === accountId);
  if (!account || clients[accountId]) return;
  
  const client = new SteamUser({ autoRelogin: true });
  
  client.on('loggedOn', () => {
    console.log(`[${account.login}] Logged in!`);
    client.setPersona(SteamUser.EPersonaState.Offline);
    client.gamesPlayed(account.appIds);
    
    // Обновляем статус
    updateAccountStatus(accountId, {
      loggedIn: true,
      lastOnline: Date.now(),
      startTime: Date.now()
    });
    
    // Запускаем проверку карточек
    trackCardDrops(accountId);
    
    // Автоматически ищем новые игры для фарминга
    checkForNewGamesToFarm(accountId);
    
    // Проверяем новые игры каждые 24 часа
    setInterval(() => checkForNewGamesToFarm(accountId), 86400000); // 24 часа
  });

  client.on('error', (err) => {
    console.error(`[${account.login}] Steam error:`, err.message);
    updateAccountStatus(accountId, {
      loggedIn: false,
      status: `error: ${err.message}`
    });
    
    // Попытка переподключения через 5 минут
    setTimeout(() => startFarming(accountId), 300000);
  });

  client.on('disconnected', () => {
    console.log(`[${account.login}] Disconnected`);
    updateAccountStatus(accountId, {
      loggedIn: false,
      status: 'reconnecting'
    });
    
    // Попытка переподключения через 5 минут
    setTimeout(() => startFarming(accountId), 300000);
  });

  client.logOn({
    accountName: account.login,
    password: account.password
  });

  clients[accountId] = client;
}

// Проверка новых игр для фарминга
function checkForNewGamesToFarm(accountId) {
  const account = persisted.accounts.find(a => a.id === accountId);
  if (!account || !account.steamId) return;
  
  console.log(`[${account.login}] Checking for new games to farm...`);
  
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) {
    console.log('STEAM_API_KEY not set. Cannot check for new games.');
    return;
  }
  
  // Получаем список игр пользователя
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${account.steamId}&include_appinfo=1&include_played_free_games=1`;
  
  https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      try {
        const gamesData = JSON.parse(data);
        if (gamesData.response && gamesData.response.games) {
          processGamesList(accountId, gamesData.response.games);
        }
      } catch (e) {
        console.error('Error parsing games data:', e);
      }
    });
  }).on('error', (err) => {
    console.error('Error fetching games:', err);
  });
}

// Обработка списка игр
function processGamesList(accountId, games) {
  const account = persisted.accounts.find(a => a.id === accountId);
  if (!account) return;
  
  // Известные игры, которые уже фармятся
  const alreadyFarming = new Set(account.appIds);
  
  // Игры, в которых можно фармить карточки (не завершенные наборы)
  const gamesToFarm = [];
  
  games.forEach(game => {
    // Проверяем, есть ли незавершенные наборы карточек
    if (game.has_community_visible_stats && 
        game.playtime_forever > 0 && 
        !alreadyFarming.has(game.appid)) {
      
      // Дополнительная проверка: игра должна иметь карточки
      // Для этого проверяем, что количество карточек нечетное (обычно 5 или 7)
      // или есть другие признаки наличия карточек
      // Упрощенная проверка - игнорируем игры с малым количеством часов
      if (game.playtime_forever > 30) { // минимум 30 минут в игре
        gamesToFarm.push(game.appid);
      }
    }
  });
  
  // Добавляем новые игры к фармингу
  if (gamesToFarm.length > 0) {
    const newAppIds = [...account.appIds, ...gamesToFarm];
    
    updateAccountStatus(accountId, {
      appIds: newAppIds
    });
    
    console.log(`[${account.login}] Added ${gamesToFarm.length} new games to farm:`, gamesToFarm);
    
    // Если клиент активен, обновляем список игр
    if (clients[accountId]) {
      clients[accountId].gamesPlayed(newAppIds);
    }
    
    // Уведомляем через веб-интерфейс
    sendNotification(accountId, `🎮 Добавлено ${gamesToFarm.length} новых игр для фарминга!`);
  }
}

// Трекинг карточек
function trackCardDrops(accountId) {
  const account = persisted.accounts.find(a => a.id === accountId);
  if (!account) return;
  
  const dropsPerHour = account.appIds.length * 2;
  
  // Проверяем каждые 5 минут
  setInterval(() => {
    if (!account.loggedIn || !account.startTime) return;
    
    const minutesPlayed = Math.floor((Date.now() - account.startTime) / 60000);
    const expectedDrops = Math.floor(minutesPlayed * (dropsPerHour / 60));
    
    if (expectedDrops > account.totalCards) {
      const newDrops = expectedDrops - account.totalCards;
      
      updateAccountStatus(accountId, {
        totalCards: expectedDrops
      });
      
      checkAchievements(accountId, expectedDrops);
      
      // Отправляем уведомление о новых карточках
      if (newDrops > 0) {
        sendNotification(accountId, `🎴 Получено ${newDrops} новых карточек!`);
      }
    }
  }, 300000); // 5 минут
}

// Отправка уведомлений в веб-интерфейс
function sendNotification(accountId, message) {
  // Здесь будет реализация отправки уведомления через WebSocket или другим способом
  console.log(`[Notification] ${accountId}: ${message}`);
  // В реальной реализации можно использовать SSE или WebSocket
}

// Проверка достижений
function checkAchievements(accountId, totalCards) {
  const account = persisted.accounts.find(a => a.id === accountId);
  if (!account) return;
  
  const thresholds = [
    { id: 'c10', cards: 10, name: 'Начинающий коллекционер' },
    { id: 'c50', cards: 50, name: 'Опытный коллекционер' },
    { id: 'c100', cards: 100, name: 'Мастер коллекций' },
    { id: 'c500', cards: 500, name: 'Легендарный коллекционер' }
  ];

  thresholds.forEach(t => {
    if (totalCards >= t.cards && !account.achievements.includes(t.id)) {
      updateAccountStatus(accountId, {
        achievements: [...account.achievements, t.id]
      });
      console.log(`[${account.login}] Achievement unlocked: ${t.name}`);
      sendNotification(accountId, `🏆 Достижение: ${t.name}`);
    }
  });
}

// Обновление статуса аккаунта
function updateAccountStatus(accountId, updates) {
  const accountIndex = persisted.accounts.findIndex(a => a.id === accountId);
  if (accountIndex === -1) return;
  
  persisted.accounts[accountIndex] = {
    ...persisted.accounts[accountIndex],
    ...updates
  };
  
  saveData(persisted);
}

// Эндпоинты API
app.get('/', (req, res) => {
  res.send(HTML);
});

app.get('/accounts', (req, res) => {
  const accounts = persisted.accounts.map(a => ({
    id: a.id,
    login: a.login,
    loggedIn: a.loggedIn,
    totalHours: a.startTime ? ((Date.now() - a.startTime) / 3600000).toFixed(2) : '0.00',
    totalCards: a.totalCards
  }));
  
  res.json({
    accounts,
    currentAccount: persisted.currentAccount
  });
});

app.post('/accounts', (req, res) => {
  const { login, password, apps = [] } = req.body;
  const validApps = apps
    .map(id => parseInt(id))
    .filter(id => !isNaN(id) && id > 0 && id < 10000000);
  
  if (validApps.length === 0) {
    return res.status(400).json({ error: 'Invalid App IDs' });
  }

  const newAccount = {
    id: `acc_${Date.now()}`,
    login,
    password,
    steamId: '', // будет заполнен позже
    appIds: validApps,
    loggedIn: false,
    status: 'connecting',
    totalMinutes: 0,
    totalCards: 0,
    achievements: []
  };
  
  persisted.accounts.push(newAccount);
  persisted.currentAccount = newAccount.id;
  saveData(persisted);
  
  // Запускаем фарминг после небольшой задержки, чтобы дать время инициализации
  setTimeout(() => startFarming(newAccount.id), 2000);
  
  res.status(201).json({ id: newAccount.id });
});

app.post('/control/:id', (req, res) => {
  const { action } = req.body;
  const account = persisted.accounts.find(a => a.id === req.params.id);
  
  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }
  
  if (action === 'start') {
    if (!clients[account.id]) {
      startFarming(account.id);
    }
    persisted.currentAccount = account.id;
  } else if (action === 'stop') {
    if (clients[account.id]) {
      clients[account.id].gamesPlayed([]);
      clients[account.id].logOff();
      delete clients[account.id];
      
      // Сохраняем время
      const accountIndex = persisted.accounts.findIndex(a => a.id === account.id);
      if (accountIndex !== -1 && persisted.accounts[accountIndex].startTime) {
        const sessionTime = Date.now() - persisted.accounts[accountIndex].startTime;
        persisted.accounts[accountIndex].totalMinutes += Math.floor(sessionTime / 60000);
        persisted.accounts[accountIndex].startTime = null;
      }
    }
  } else if (action === 'check-games') {
    checkForNewGamesToFarm(account.id);
  }
  
  saveData(persisted);
  res.json({ ok: true });
});

app.get('/status/:id', (req, res) => {
  const account = persisted.accounts.find(a => a.id === req.params.id);
  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }
  
  const totalHours = account.totalMinutes / 60;
  const dropsPerHour = account.appIds.length * 2;
  const minutesSinceStart = account.startTime ? 
    Math.floor((Date.now() - account.startTime) / 60000) : 0;
  
  res.json({
    id: account.id,
    loggedIn: account.loggedIn,
    login: account.login,
    totalHours: totalHours.toFixed(2),
    totalCards: account.totalCards,
    cardProgress: Math.min(100, (minutesSinceStart / (60 / dropsPerHour)) * 100),
    cardTimer: formatMinutes(60 / dropsPerHour - minutesSinceStart),
    achievements: account.achievements,
    appIds: account.appIds
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Вспомогательные функции
function formatMinutes(minutes) {
  if (minutes <= 0) return '0м';
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${h ? h + 'ч ' : ''}${m}м`;
}

// Запуск
initAccounts();
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Current accounts:', persisted.accounts.map(a => a.login));
});

const HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Steam Idler</title>
  <style>
    :root {
      --bg: #0f0f0f;
      --card: #1a1a1a;
      --border: #2a2a2a;
      --text: #e6e6e6;
      --accent: #2081e2;
      --success: #22c55e;
      --warning: #eab308;
      --danger: #ef4444;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
    }
    .accounts {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      overflow-x: auto;
    }
    .account {
      padding: 6px 16px;
      background: var(--card);
      border-radius: 30px;
      cursor: pointer;
      white-space: nowrap;
    }
    .account.active {
      background: var(--accent);
    }
    .card {
      background: var(--card);
      border-radius: 16px;
      overflow: hidden;
      margin: 16px;
    }
    .header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      background: rgba(32, 129, 226, 0.1);
      border-radius: 20px;
      color: var(--accent);
      font-size: 13px;
      font-weight: 500;
    }
    .status.online {
      background: rgba(34, 197, 94, 0.1);
      color: var(--success);
    }
    .status.offline {
      background: rgba(239, 68, 68, 0.1);
      color: var(--danger);
    }
    .stat {
      padding: 16px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .value {
      font-size: 24px;
      font-weight: 600;
    }
    .label {
      color: #8a8a8a;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .progress {
      padding: 0 16px 16px;
    }
    .progress-label {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 13px;
      color: #8a8a8a;
    }
    .bar {
      height: 6px;
      background: #2a2a2a;
      border-radius: 3px;
      overflow: hidden;
    }
    .fill {
      height: 100%;
      background: var(--accent);
      border-radius: 3px;
      width: 0%;
      transition: width 1s ease;
    }
    .fill.session {
      background: var(--success);
    }
    .fill.cards {
      background: var(--warning);
    }
    .controls {
      padding: 16px;
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 12px;
    }
    .btn {
      padding: 14px;
      border-radius: 12px;
      border: none;
      font-family: inherit;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .btn:active {
      transform: scale(0.97);
    }
    .btn-primary {
      background: var(--accent);
      color: white;
    }
    .btn-outline {
      background: transparent;
      color: var(--text);
      border: 1px solid var(--border);
    }
    .modal {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.7);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .modal.active {
      display: flex;
    }
    .modal-content {
      background: var(--card);
      border-radius: 16px;
      padding: 24px;
      width: 90%;
      max-width: 400px;
      border: 1px solid var(--border);
    }
    input {
      width: 100%;
      padding: 12px;
      margin: 8px 0;
      background: #2a2a2a;
      border: none;
      border-radius: 8px;
      color: white;
    }
    .dynamic-island {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(-100px);
      background: rgba(30, 30, 30, 0.9);
      backdrop-filter: blur(20px);
      border-radius: 30px;
      padding: 8px 20px;
      color: white;
      font-size: 14px;
      font-weight: 500;
      transition: transform 0.3s ease;
      z-index: 1000;
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      white-space: nowrap;
    }
    .dynamic-island.show {
      transform: translateX(-50%) translateY(0);
    }
    .game-list {
      padding: 0 16px 16px;
    }
    .game-item {
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .game-name {
      font-size: 14px;
    }
    .game-id {
      font-size: 12px;
      color: #8a8a8a;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="dynamic-island" id="dynamic-island"></div>
  
  <div class="accounts" id="accounts"></div>
  
  <div class="card">
    <div class="header">
      <div>
        <div style="font-weight: 600; font-size: 16px;">Steam Idler</div>
        <div style="font-size: 12px; color: #8a8a8a;">Фарм часов и карточек</div>
      </div>
      <div class="status" id="status-badge">Фарм идёт</div>
    </div>
    
    <div class="stat">
      <div>
        <div class="value" id="hours">0.00</div>
        <div class="label">Часов</div>
      </div>
      <div>
        <div class="value" id="cards">0</div>
        <div class="label">Карточек</div>
      </div>
    </div>
    
    <div class="progress">
      <div class="progress-label">
        <span>Сессия</span>
        <span id="session-timer">0ч 0м</span>
      </div>
      <div class="bar"><div class="fill session" id="session-progress" style="width: 0%"></div></div>
      
      <div class="progress-label" style="margin-top: 16px;">
        <span>До карточки</span>
        <span id="cards-timer">0м</span>
      </div>
      <div class="bar"><div class="fill cards" id="cards-progress" style="width: 0%"></div></div>
    </div>
    
    <div class="game-list" id="games-list">
      <div class="section-title" style="margin-bottom: 8px;">Игры для фарминга</div>
      <!-- Список игр будет здесь -->
    </div>
    
    <div class="controls">
      <button class="btn btn-outline" id="add-btn">+ Добавить</button>
      <button class="btn btn-outline" id="check-games">Проверить игры</button>
      <button class="btn btn-primary" id="toggle-btn">Остановить</button>
    </div>
  </div>
  
  <div class="modal" id="add-modal">
    <div class="modal-content">
      <h3 style="margin-bottom: 16px;">Новый аккаунт</h3>
      <input type="text" id="login" placeholder="Логин">
      <input type="password" id="password" placeholder="Пароль">
      <input type="text" id="apps" placeholder="App ID (через запятую)">
      <button class="btn btn-primary" style="margin-top: 20px;" onclick="addAccount()">Добавить</button>
    </div>
  </div>

  <script>
    let currentAccount = null;
    
    document.getElementById('add-btn').onclick = () => {
      document.getElementById('add-modal').classList.add('active');
    };
    
    document.getElementById('toggle-btn').onclick = () => {
      const isRunning = document.getElementById('toggle-btn').textContent === 'Остановить';
      fetch('/control/' + currentAccount, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: isRunning ? 'stop' : 'start' })
      });
      document.getElementById('toggle-btn').textContent = isRunning ? 'Запустить' : 'Остановить';
      document.getElementById('status-badge').textContent = isRunning ? 'Остановлен' : 'Фарм идёт';
      document.getElementById('status-badge').className = isRunning ? 
        'status' : 'status online';
    };
    
    document.getElementById('check-games').onclick = () => {
      fetch('/control/' + currentAccount, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check-games' })
      });
      sendNotification('🔍 Проверка новых игр для фарминга...');
    };
    
    function addAccount() {
      const login = document.getElementById('login').value;
      const pass = document.getElementById('password').value;
      let apps = document.getElementById('apps').value
        .split(',')
        .map(id => id.trim())
        .filter(id => id);
      
      // Добавляем CS2 и Geometry Dash по умолчанию
      if (apps.length === 0) {
        apps = ['730', '327920'];
      }
      
      fetch('/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password: pass, apps })
      }).then(() => {
        document.getElementById('add-modal').classList.remove('active');
        loadAccounts();
      });
    }
    
    function sendNotification(message) {
      const island = document.getElementById('dynamic-island');
      island.textContent = message;
      island.classList.add('show');
      
      setTimeout(() => {
        island.classList.remove('show');
      }, 3000);
    }
    
    function renderAccounts(accounts, currentId) {
  const el = document.getElementById('accounts');
  if (!el) return;
  
  // Создаем элементы через DOM API вместо innerHTML
  el.innerHTML = '';
  
  accounts.forEach(a => {
    const accountEl = document.createElement('div');
    accountEl.className = 'account ' + (a.id === currentId ? 'active' : '');
    accountEl.textContent = a.login;
    accountEl.onclick = () => switchAccount(a.id);
    el.appendChild(accountEl);
  });
}
    
    function renderGames(appIds) {
      const el = document.getElementById('games-list');
      let html = '';
      
      appIds.forEach(id => {
        let name = 'Неизвестная игра';
        
        // Названия популярных игр
        if (id == 730) name = 'CS2';
        if (id == 740) name = 'CS:GO';
        if (id == 327920) name = 'Geometry Dash';
        
        html += `
          <div class="game-item">
            <div>
              <div class="game-name">${name}</div>
              <div class="game-id">App ID: ${id}</div>
            </div>
          </div>
        `;
      });
      
      if (html === '') {
        html = '<div class="no-data" style="padding: 12px; color: #8a8a8a;">Нет игр для фарминга</div>';
      }
      
      el.innerHTML = html;
    }
    
    function switchAccount(id) {
      currentAccount = id;
      loadStatus();
    }
    
    function loadAccounts() {
      fetch('/accounts')
        .then(r => r.json())
        .then(data => {
          renderAccounts(data.accounts, data.currentAccount);
          if (data.currentAccount && !currentAccount) {
            currentAccount = data.currentAccount;
            loadStatus();
          }
        });
    }
    
    function loadStatus() {
      fetch('/status/' + currentAccount)
        .then(r => r.json())
        .then(data => {
          document.getElementById('hours').textContent = data.totalHours;
          document.getElementById('cards').textContent = data.totalCards;
          
          const dropsPerHour = data.appIds.length * 2;
          const progress = Math.min(100, (data.totalHours % 24 / 24) * 100);
          document.getElementById('session-progress').style.width = progress + '%';
          
          document.getElementById('session-timer').textContent = 
            Math.floor(data.totalHours % 24) + 'ч ' + Math.floor((data.totalHours * 60) % 60) + 'м';
          
          document.getElementById('cards-progress').style.width = data.cardProgress + '%';
          document.getElementById('cards-timer').textContent = data.cardTimer;
          
          // Рендерим игры
          renderGames(data.appIds);
        })
        .catch(console.error);
    }
    
    // Инициализация
    document.addEventListener('DOMContentLoaded', () => {
      loadAccounts();
      setInterval(loadStatus, 300000); // 5 минут
      
      // Закрытие модального окна при клике вне его
      document.addEventListener('click', (e) => {
        const modal = document.getElementById('add-modal');
        if (e.target === modal) {
          modal.classList.remove('active');
        }
      });
    });
  </script>
</body>
</html>`;
