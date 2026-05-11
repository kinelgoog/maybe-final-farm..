const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Data file
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

// API
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
