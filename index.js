const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Путь к файлу данных
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

// Маршруты
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Steam Idler</title>
  <style>
    body {
      background: #0a0a0f;
      color: #fff;
      font-family: -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      text-align: center;
    }
    .card {
      background: rgba(20, 20, 30, 0.6);
      border-radius: 16px;
      padding: 30px;
      width: 90%;
      max-width: 400px;
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    }
    h1 { color: #a855f7; font-size: 28px; margin-bottom: 10px; }
    p { color: #a0a0b0; font-size: 16px; }
    .btn {
      margin-top: 20px;
      padding: 12px 24px;
      background: #a855f7;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Steam Idler</h1>
    <p>✅ Сервер запущен</p>
    <p>Добавьте аккаунт через API:</p>
    <pre style="background:#1a1a2a;padding:10px;border-radius:8px;font-size:12px;margin:10px 0;">curl -X POST https://ваш-сайт.onrender.com/accounts \\
-H "Content-Type: application/json" \\
-d '{"login":"ваш_логин","password":"ваш_пароль","apps":[730,4465480,322170]}'</pre>
    <button class="btn" onclick="window.location.href='/accounts'">Показать аккаунты</button>
  </div>
</body>
</html>
`);
});

app.get('/accounts', (req, res) => {
  res.json(persisted.accounts.map(a => ({
    id: a.id,
    login: a.login,
    loggedIn: a.loggedIn || false
  })));
});

app.post('/accounts', (req, res) => {
  const { login, password, apps = [730, 4465480, 322170] } = req.body;
  const newAccount = {
    id: `acc_${Date.now()}`,
    login,
    password,
    appIds: apps,
    loggedIn: false,
    totalCards: 0,
    achievements: []
  };
  persisted.accounts.push(newAccount);
  persisted.currentAccount = newAccount.id;
  saveData(persisted);
  res.status(201).json({ id: newAccount.id });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
