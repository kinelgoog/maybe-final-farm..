const SteamUser = require('steam-user');
const express = require('express');
const { Account, encrypt, decrypt } = require('./db');
const crypto = require('crypto');

const PORT = process.env.PORT || 10000;
const app = express();
app.use(express.json());

const farmingInstances = {};
const pendingUpdates = [];
let lastBatchTime = Date.now();

app.get('/', async (req, res) => {
  try {
    const accounts = await Account.find({}, 'steamId login');
    const activeAccount = accounts[0]?.steamId || null;
    res.send(HTML.replace('/*ACCOUNTS_JS*/', `
      window.INITIAL_ACCOUNT = ${JSON.stringify(activeAccount)};
      window.ACCOUNTS = ${JSON.stringify(accounts.map(a => ({ id: a.steamId, name: a.login })))};
    `));
  } catch (e) {
    res.status(500).send('Server error');
  }
});

app.post('/accounts', async (req, res) => {
  try {
    const { login, pass, apps = [] } = req.body;
    const validApps = apps
      .map(id => parseInt(id))
      .filter(id => !isNaN(id) && id > 0 && id < 10000000);
    
    if (validApps.length === 0) {
      return res.status(400).json({ error: 'Invalid App IDs' });
    }

    const newAcc = new Account({
      login,
      password: encrypt(pass),
      appIds: validApps
    });
    await newAcc.save();
    
    startFarming(newAcc);
    res.status(201).json({ id: newAcc.steamId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/status/:id', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const totalHours = account.totalMinutes / 60;
    const dropsPerHour = account.appIds.length * 2;
    const minutesSinceLastDrop = account.lastCardDrop ? 
      Math.floor((Date.now() - account.lastCardDrop) / 60000) : 0;
    
    res.json({
      id: account.steamId,
      loggedIn: !!farmingInstances[account.steamId],
      totalHours: totalHours.toFixed(2),
      totalCards: account.totalCards,
      cardProgress: Math.min(100, (minutesSinceLastDrop / (60 / dropsPerHour)) * 100),
      cardTimer: formatMinutes(60 / dropsPerHour - minutesSinceLastDrop),
      achievements: account.achievements
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/control/:id', async (req, res) => {
  const { action } = req.body;
  const account = await Account.findById(req.params.id);
  
  if (action === 'start' && account && !farmingInstances[account.steamId]) {
    startFarming(account);
  } else if (action === 'stop' && farmingInstances[account.steamId]) {
    farmingInstances[account.steamId].gamesPlayed([]);
    delete farmingInstances[account.steamId];
  }
  
  res.json({ ok: true });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

function startFarming(account) {
  const client = new SteamUser({ autoRelogin: true });
  const steamId = account.steamId;

  client.on('loggedOn', () => {
    client.setPersona(SteamUser.EPersonaState.Offline);
    client.gamesPlayed(account.appIds);
    
    // Запускаем трекинг карточек
    trackCards(steamId, account);
  });

  client.on('error', (err) => {
    if (err.eresult === 63) { // Invalid password
      sendNotification(steamId, '⚠️ Неверный пароль');
    }
    setTimeout(() => startFarming(account), 300000); // 5 минут
  });

  client.on('disconnected', () => {
    setTimeout(() => startFarming(account), 300000); // 5 минут
  });

  client.logOn({
    accountName: account.login,
    password: decrypt(account.password)
  });

  farmingInstances[steamId] = client;
}

function trackCards(steamId, account) {
  const dropsPerHour = account.appIds.length * 2;
  
  setInterval(() => {
    const minutesPlayed = Math.floor((Date.now() - account.lastActive) / 60000);
    const expectedDrops = Math.floor(minutesPlayed * (dropsPerHour / 60));
    
    if (expectedDrops > 0) {
      queueUpdate(steamId, {
        $inc: { totalCards: expectedDrops },
        lastCardDrop: new Date(),
        lastActive: new Date()
      });
      
      checkAchievements(steamId, account.totalCards + expectedDrops);
    }
  }, 300000); // 5 минут
}

function checkAchievements(steamId, totalCards) {
  const thresholds = [
    { id: 'c10', cards: 10 },
    { id: 'c50', cards: 50 },
    { id: 'c100', cards: 100 },
    { id: 'c500', cards: 500 }
  ];

  thresholds.forEach(t => {
    if (totalCards >= t.cards && !account.achievements.includes(t.id)) {
      queueUpdate(steamId, {
        $push: { achievements: t.id }
      });
      sendNotification(steamId, `🏆 Достижение: ${t.id}`);
    }
  });
}

function queueUpdate(steamId, update) {
  pendingUpdates.push({ steamId, update });
  processUpdates();
}

function processUpdates() {
  if (Date.now() - lastBatchTime < 3600000) return; // 1 час
  
  if (pendingUpdates.length > 0) {
    const updates = {};
    
    pendingUpdates.forEach(({ steamId, update }) => {
      if (!updates[steamId]) updates[steamId] = { $set: {}, $inc: {} };
      Object.keys(update).forEach(key => {
        const op = key.startsWith('$') ? key : '$set';
        updates[steamId][op][key] = update[key];
      });
    });
    
    Object.entries(updates).forEach(([steamId, update]) => {
      Account.updateOne({ steamId }, update).exec();
    });
    
    pendingUpdates.length = 0;
    lastBatchTime = Date.now();
  }
}

setInterval(processUpdates, 3600000); // 1 час

// Запуск существующих аккаунтов
Account.find().then(accounts => {
  accounts.forEach(startFarming);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

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
    }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, sans-serif; }
    .accounts { display: flex; gap: 8px; padding: 12px; border-bottom: 1px solid var(--border); }
    .account { padding: 6px 16px; background: var(--card); border-radius: 30px; cursor: pointer; }
    .account.active { background: var(--accent); }
    .card { background: var(--card); border-radius: 16px; overflow: hidden; margin: 16px; }
    .stat { padding: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .value { font-size: 24px; font-weight: 600; }
    .label { color: #8a8a8a; font-size: 12px; text-transform: uppercase; }
    .progress { padding: 0 16px 16px; }
    .bar { height: 6px; background: #2a2a2a; border-radius: 3px; overflow: hidden; }
    .fill { height: 100%; background: var(--accent); border-radius: 3px; width: 0%; }
    .controls { padding: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .btn { padding: 14px; border-radius: 12px; border: none; font-weight: 500; }
    .btn-primary { background: var(--accent); color: white; }
    .modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: none; }
    .modal-content { background: var(--card); margin: 40px auto; padding: 24px; border-radius: 16px; width: 90%; max-width: 400px; }
    input { width: 100%; padding: 12px; margin: 8px 0; background: #2a2a2a; border: none; border-radius: 8px; color: white; }
  </style>
</head>
<body>
  <div class="accounts" id="accounts"></div>
  
  <div class="card">
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
      <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
        <span>Сессия</span>
        <span id="session-timer">0ч 0м</span>
      </div>
      <div class="bar"><div class="fill" id="session-progress" style="width: 0%"></div></div>
      
      <div style="display: flex; justify-content: space-between; margin: 16px 0 8px;">
        <span>До карточки</span>
        <span id="cards-timer">0м</span>
      </div>
      <div class="bar"><div class="fill" id="cards-progress" style="width: 0%"></div></div>
    </div>
    
    <div class="controls">
      <button class="btn" id="add-btn">+ Добавить</button>
      <button class="btn btn-primary" id="toggle-btn">Остановить</button>
    </div>
  </div>

  <div class="modal" id="add-modal">
    <div class="modal-content">
      <h3>Новый аккаунт</h3>
      <input type="text" id="login" placeholder="Логин">
      <input type="password" id="password" placeholder="Пароль">
      <input type="text" id="apps" placeholder="App ID (через запятую)">
      <button class="btn btn-primary" onclick="addAccount()">Добавить</button>
    </div>
  </div>

  <script>
    let currentAccount = INITIAL_ACCOUNT;
    
    document.getElementById('add-btn').onclick = () => {
      document.getElementById('add-modal').style.display = 'block';
    };
    
    document.getElementById('toggle-btn').onclick = () => {
      const isRunning = document.getElementById('toggle-btn').textContent === 'Остановить';
      fetch('/control/' + currentAccount, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: isRunning ? 'stop' : 'start' })
      });
      document.getElementById('toggle-btn').textContent = isRunning ? 'Запустить' : 'Остановить';
    };
    
    function addAccount() {
      const login = document.getElementById('login').value;
      const pass = document.getElementById('password').value;
      const apps = document.getElementById('apps').value
        .split(',')
        .map(id => id.trim())
        .filter(id => id);
      
      fetch('/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, pass, apps })
      }).then(() => {
        document.getElementById('add-modal').style.display = 'none';
        location.reload();
      });
    }
    
    function renderAccounts() {
      const el = document.getElementById('accounts');
      el.innerHTML = ACCOUNTS.map(a => 
        `<div class="account ${a.id === currentAccount ? 'active' : ''}" 
         onclick="switchAccount('${a.id}')">${a.name}</div>`
      ).join('');
    }
    
    function switchAccount(id) {
      currentAccount = id;
      loadStatus();
    }
    
    function loadStatus() {
      fetch('/status/' + currentAccount)
        .then(r => r.json())
        .then(data => {
          document.getElementById('hours').textContent = data.totalHours;
          document.getElementById('cards').textContent = data.totalCards;
          document.getElementById('session-progress').style.width = data.cardProgress + '%';
          document.getElementById('cards-progress').style.width = data.cardProgress + '%';
          document.getElementById('cards-timer').textContent = data.cardTimer;
        });
    }
    
    setInterval(loadStatus, 300000); // 5 минут
    renderAccounts();
    if (currentAccount) loadStatus();
  </script>
</body>
</html>`;
