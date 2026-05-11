const SteamUser = require('steam-user');
const { saveAccount, getAccount } = require('./db');

const BASE_APPS = (process.env.APP_IDS || '730,322170,4465480').split(',').map(Number);
const CARD_CHECK_INTERVAL = 30 * 60 * 1000; // 30 минут

class Farmer {
  constructor(login, password) {
    this.login    = login;
    this.password = password;
    this.client   = new SteamUser({ promptSteamGuardCode: false, autoRelogin: true });

    this.state = {
      loggedIn:       false,
      status:         'connecting',
      username:       login,
      avatarUrl:      '',
      profileUrl:     '',
      startTime:      null,
      idling:         true,
      totalMs:        0,
      sessions:       [],
      lastOnline:     null,
      uptimeDays:     [],
      // карточки
      cardGame:       null,   // текущая игра для карточек
      cardQueue:      [],     // очередь игр с карточками
      cardsRemaining: 0,
      cardNotifs:     [],     // уведомления о карточках
      totalCards:     0,      // всего нафармлено карточек
    };

    this._setupEvents();
    this._loadFromDB();
  }

  async _loadFromDB() {
    const saved = await getAccount(this.login);
    if (saved) {
      this.state.totalMs    = saved.totalMs    || 0;
      this.state.sessions   = saved.sessions   || [];
      this.state.lastOnline = saved.lastOnline || null;
      this.state.uptimeDays = saved.uptimeDays || [];
      this.state.totalCards = saved.totalCards || 0;
      this.state.avatarUrl  = saved.avatarUrl  || '';
      this.state.profileUrl = saved.profileUrl || '';
      this.state.username   = saved.username   || this.login;
    }
  }

  async _saveToDB() {
    await saveAccount(this.login, {
      totalMs:    this.state.totalMs,
      sessions:   this.state.sessions.slice(-20),
      lastOnline: this.state.lastOnline,
      uptimeDays: this.state.uptimeDays,
      totalCards: this.state.totalCards,
      avatarUrl:  this.state.avatarUrl,
      profileUrl: this.state.profileUrl,
      username:   this.state.username,
    });
  }

  _saveSession() {
    if (!this.state.startTime) return;
    const ms = Date.now() - this.state.startTime;
    this.state.totalMs += ms;
    this.state.sessions.push({ start: this.state.startTime, end: Date.now(), ms });
    this.state.sessions = this.state.sessions.slice(-20);
    this.state.startTime = null;
    this._saveToDB();
  }

  _startUptimeTracking() {
    if (this._uptimeInterval) clearInterval(this._uptimeInterval);
    this._uptimeInterval = setInterval(() => {
      if (!this.state.loggedIn) return;
      const today = new Date().toISOString().slice(0, 10);
      const ex = this.state.uptimeDays.find(d => d.date === today);
      if (ex) ex.upMs += 60000;
      else this.state.uptimeDays.push({ date: today, upMs: 60000 });
      this.state.uptimeDays = this.state.uptimeDays.slice(-7);
      this._saveToDB();
    }, 60000);
  }

  getUptimePercent() {
    if (!this.state.uptimeDays.length) return 0;
    const last7 = this.state.uptimeDays.slice(-7);
    const possible = last7.length * 24 * 3600000;
    const up = last7.reduce((s, d) => s + d.upMs, 0);
    return Math.min(100, Math.round(up / possible * 100));
  }

  getTotalHours() {
    const cur = this.state.loggedIn && this.state.startTime ? (Date.now() - this.state.startTime) : 0;
    return (this.state.totalMs + cur) / 3600000;
  }

  _getApps() {
    const apps = [...BASE_APPS];
    if (this.state.cardGame && !apps.includes(this.state.cardGame)) {
      apps.push(this.state.cardGame);
    }
    return apps;
  }

  async _startCardFarming() {
    if (!this.state.loggedIn) return;
    try {
      // Получаем список игр
      const { games } = await this.client.getUserOwnedGames(this.client.steamID, {
        includeAppInfo: true,
        includePlayedFreeGames: true,
      });

      const queue = [];
      for (const g of games) {
        try {
          const remaining = await this.client.getCardsRemainingForGame(g.appid);
          if (remaining > 0) queue.push({ appid: g.appid, name: g.name, remaining });
        } catch {}
      }

      this.state.cardQueue = queue;
      console.log(`[${this.login}] Card queue: ${queue.length} games`);
      this._nextCardGame();
    } catch (e) {
      console.error(`[${this.login}] Card farming error:`, e.message);
    }
  }

  async _nextCardGame() {
    if (!this.state.loggedIn || !this.state.idling) return;

    if (!this.state.cardQueue.length) {
      this.state.cardGame = null;
      this.state.cardsRemaining = 0;
      if (this.state.loggedIn) this.client.gamesPlayed(BASE_APPS);
      // Проверяем снова через 8 часов
      setTimeout(() => this._startCardFarming(), 8 * 60 * 60 * 1000);
      return;
    }

    const game = this.state.cardQueue[0];
    this.state.cardGame = game.appid;
    this.state.cardsRemaining = game.remaining;
    this.client.gamesPlayed(this._getApps());
    console.log(`[${this.login}] Farming cards: ${game.name} (${game.remaining} left)`);

    // Проверяем каждые 30 минут
    if (this._cardInterval) clearInterval(this._cardInterval);
    this._cardInterval = setInterval(async () => {
      if (!this.state.loggedIn) return;
      try {
        const left = await this.client.getCardsRemainingForGame(game.appid);
        const dropped = this.state.cardsRemaining - left;
        if (dropped > 0) {
          this.state.totalCards += dropped;
          this.state.cardNotifs.push({
            time: Date.now(),
            text: `+${dropped} карточек из "${game.name}"`,
          });
          this.state.cardNotifs = this.state.cardNotifs.slice(-20);
          this._saveToDB();
        }
        this.state.cardsRemaining = left;

        if (left === 0) {
          clearInterval(this._cardInterval);
          this.state.cardQueue.shift();
          this._nextCardGame();
        }
      } catch {}
    }, CARD_CHECK_INTERVAL);
  }

  _setupEvents() {
    this.client.on('loggedOn', async () => {
      console.log(`[${this.login}] Logged in!`);
      this.state.loggedIn   = true;
      this.state.status     = 'idling';
      this.state.startTime  = Date.now();
      this.state.lastOnline = Date.now();
      this.client.setPersona(SteamUser.EPersonaState.Offline);
      if (this.state.idling) this.client.gamesPlayed(BASE_APPS);
      this._startUptimeTracking();
      this._saveToDB();
      // Запускаем фарм карточек через 1 минуту после логина
      setTimeout(() => this._startCardFarming(), 60000);
    });

    this.client.on('steamGuard', (domain, cb) => cb(''));

    this.client.on('error', err => {
      console.error(`[${this.login}] Error:`, err.message);
      this._saveSession();
      this.state.loggedIn = false;
      this.state.status   = 'error';
    });

    this.client.on('disconnected', () => {
      console.log(`[${this.login}] Disconnected`);
      this._saveSession();
      this.state.loggedIn = false;
      this.state.status   = 'reconnecting';
    });
  }

  start() {
    this.client.logOn({ accountName: this.login, password: this.password });
  }

  stop() {
    this.state.idling = false;
    this.client.gamesPlayed([]);
    if (this._cardInterval) clearInterval(this._cardInterval);
  }

  resume() {
    this.state.idling = true;
    if (this.state.loggedIn) this.client.gamesPlayed(this._getApps());
  }

  getStatus() {
    const totalHours = this.getTotalHours();
    const ACHS_HOURS = [1, 10, 50, 100, 500];
    const ACHS_CARDS = [1, 10, 50, 100, 500];
    return {
      login:          this.login,
      loggedIn:       this.state.loggedIn,
      status:         this.state.status,
      username:       this.state.username,
      avatarUrl:      this.state.avatarUrl,
      profileUrl:     this.state.profileUrl,
      startTime:      this.state.startTime,
      idling:         this.state.idling,
      totalHours,
      uptimePercent:  this.getUptimePercent(),
      lastOnline:     this.state.lastOnline,
      sessions:       this.state.sessions.slice(-10).reverse(),
      cardGame:       this.state.cardGame,
      cardsRemaining: this.state.cardsRemaining,
      cardQueue:      this.state.cardQueue.length,
      totalCards:     this.state.totalCards,
      cardNotifs:     this.state.cardNotifs.slice(-5),
      achievedHours:  ACHS_HOURS.filter(h => totalHours >= h),
      achievedCards:  ACHS_CARDS.filter(c => this.state.totalCards >= c),
    };
  }
}

module.exports = Farmer;
