const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = 'rcdonhai5911';
const ADMIN_EMAIL = 'jatakasora@gmail.com';
const MAX_USERS = 100;
const BONUS_RUPEES = 50;
const DB_PATH = path.join(__dirname, 'data.json');

app.use(express.json());

function createDefaultGame() {
  return {
    round: 1,
    secondsLeft: 10,
    mode: 'auto', // 'auto' | 'manual' | 'fixed10'
    fixedQueue: [],
    history: [
      { round: 0, number: 7, result: 'BIG' },
      { round: 0, number: 3, result: 'SMALL' }
    ]
  };
}

function createDefaultDb() {
  return {
    game: createDefaultGame(),
    users: {},
    withdrawals: []
  };
}

function classifyOutcome(num) {
  const n = Math.max(0, Math.min(9, Number(num) || 0));
  return n >= 5 ? 'BIG' : 'SMALL';
}

function readDb() {
  if (!fs.existsSync(DB_PATH)) {
    const fresh = createDefaultDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    const defGame = createDefaultGame();
    if (!data || typeof data !== 'object') return createDefaultDb();
    data.game = { ...defGame, ...(data.game || {}) };
    if (!Array.isArray(data.game.fixedQueue)) data.game.fixedQueue = [];
    if (!Array.isArray(data.game.history)) data.game.history = defGame.history;
    if (!data.users || typeof data.users !== 'object') data.users = {};
    if (!Array.isArray(data.withdrawals)) data.withdrawals = [];
    return data;
  } catch {
    const fresh = createDefaultDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function settleCurrentRound(db, chosenNumber) {
  const num = Math.max(0, Math.min(9, Number(chosenNumber)));
  const outcome = classifyOutcome(num);
  const roundNum = db.game.round;

  for (const userObj of Object.values(db.users)) {
    if (!Array.isArray(userObj.positions)) userObj.positions = [];
    for (const pos of userObj.positions) {
      if (pos.status === 'open' && pos.round === roundNum) {
        if (pos.side === outcome) {
          const payout = +(Number(pos.amount) * 1.95).toFixed(2);
          pos.status = 'won';
          pos.pnl = +(payout - Number(pos.amount)).toFixed(2);
          userObj.wallet = +(Number(userObj.wallet || 0) + payout).toFixed(2);
        } else {
          pos.status = 'lost';
          pos.pnl = +(-Number(pos.amount)).toFixed(2);
        }
      }
    }
  }

  db.game.history.unshift({
    round: roundNum,
    number: num,
    result: outcome
  });
  if (db.game.history.length > 25) db.game.history.pop();

  db.game.round += 1;
  db.game.secondsLeft = 10;
}

setInterval(() => {
  const db = readDb();
  if (db.game.secondsLeft > 1) {
    db.game.secondsLeft -= 1;
    writeDb(db);
    return;
  }

  let nextNum = Math.floor(Math.random() * 10);
  if (db.game.mode === 'fixed10' && db.game.fixedQueue.length > 0) {
    nextNum = Number(db.game.fixedQueue.shift());
    if (db.game.fixedQueue.length === 0) {
      db.game.mode = 'auto';
    }
  }

  settleCurrentRound(db, nextNum);
  writeDb(db);
}, 1000);

app.get('/api/state', (req, res) => {
  const db = readDb();
  res.json({
    game: db.game,
    adminEmail: ADMIN_EMAIL,
    userCount: Object.keys(db.users).length
  });
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '').trim();
  if (!username || !password) {
    return res.status(400).json({ error: 'ID aur password daalein' });
  }

  const db = readDb();
  if (db.users[username]) {
    if (db.users[username].password !== password) {
      return res.status(403).json({ error: 'Ye ID pehle se registered hai ya password galat hai' });
    }
    return res.json({ user: db.users[username] });
  }

  if (Object.keys(db.users).length >= MAX_USERS) {
    return res.status(400).json({ error: '100 users ki limit poori ho chuki hai' });
  }

  db.users[username] = {
    username,
    password,
    wallet: BONUS_RUPEES,
    bonusGiven: BONUS_RUPEES,
    positions: []
  };
  writeDb(db);
  res.json({ user: db.users[username] });
});

app.get('/api/me/:username', (req, res) => {
  const username = String(req.params.username || '').trim().toLowerCase();
  const db = readDb();
  if (!db.users[username]) {
    return res.status(404).json({ error: 'User nahi mila' });
  }
  const myWithdrawals = db.withdrawals.filter((w) => w.username === username).slice(-10).reverse();
  res.json({ user: db.users[username], withdrawals: myWithdrawals });
});

app.post('/api/bet', (req, res) => {
  const { username, password, side, amount } = req.body;
  const u = String(username || '').trim().toLowerCase();
  const chosenSide = String(side || '').toUpperCase();
  const amt = Number(amount);

  const db = readDb();
  const user = db.users[u];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Pehle login karein' });
  }
  if (chosenSide !== 'BIG' && chosenSide !== 'SMALL') {
    return res.status(400).json({ error: 'BIG ya SMALL chunein' });
  }
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Sahi amount daalein' });
  }
  if (Number(user.wallet || 0) < amt) {
    return res.status(400).json({ error: 'Wallet balance kam hai' });
  }

  if (!Array.isArray(user.positions)) user.positions = [];
  user.wallet = +(Number(user.wallet) - amt).toFixed(2);
  user.positions.unshift({
    id: 'POS_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
    round: db.game.round,
    side: chosenSide,
    amount: +amt.toFixed(2),
    status: 'open',
    pnl: 0,
    time: new Date().toLocaleTimeString('en-IN')
  });

  writeDb(db);
  res.json({ ok: true, user });
});

app.post('/api/sell-position', (req, res) => {
  const { username, password, positionId } = req.body;
  const u = String(username || '').trim().toLowerCase();
  const db = readDb();
  const user = db.users[u];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Pehle login karein' });
  }

  const pos = (user.positions || []).find((p) => p.id === positionId && p.status === 'open');
  if (!pos) {
    return res.status(404).json({ error: 'Open holding nahi mili' });
  }

  const cashBack = +(Number(pos.amount) * 0.9).toFixed(2);
  pos.status = 'sold';
  pos.pnl = +(cashBack - Number(pos.amount)).toFixed(2);
  user.wallet = +(Number(user.wallet || 0) + cashBack).toFixed(2);

  writeDb(db);
  res.json({ ok: true, user });
});

app.post('/api/withdraw', (req, res) => {
  const { username, password, upiId, amount } = req.body;
  const u = String(username || '').trim().toLowerCase();
  const upi = String(upiId || '').trim();
  const amt = Number(amount);

  const db = readDb();
  const user = db.users[u];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Pehle login karein' });
  }
  if (!upi || !upi.includes('@') || upi.length < 4) {
    return res.status(400).json({ error: 'Sahi UPI ID daalein (jaise name@upi)' });
  }
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Sahi withdrawal amount daalein' });
  }
  if (Number(user.wallet || 0) < amt) {
    return res.status(400).json({ error: 'Wallet balance kam hai' });
  }

  user.wallet = +(Number(user.wallet) - amt).toFixed(2);
  db.withdrawals.push({
    id: 'WD_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
    username: u,
    upiId: upi,
    amount: +amt.toFixed(2),
    status: 'pending',
    createdAt: new Date().toLocaleString('en-IN')
  });

  writeDb(db);
  const myWithdrawals = db.withdrawals.filter((w) => w.username === u).slice(-10).reverse();
  res.json({ ok: true, user, withdrawals: myWithdrawals });
});

function getAdminData(db) {
  const usersList = Object.values(db.users).map((u) => {
    const openAmt = (u.positions || [])
      .filter((p) => p.status === 'open')
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return {
      username: u.username,
      wallet: +Number(u.wallet || 0).toFixed(2),
      openHoldings: +openAmt.toFixed(2)
    };
  });

  const withdrawals = db.withdrawals.slice().reverse().map((w) => ({
    ...w,
    currentBalance: db.users[w.username] ? +Number(db.users[w.username].wallet || 0).toFixed(2) : 0
  }));

  return {
    ok: true,
    game: db.game,
    adminEmail: ADMIN_EMAIL,
    usersList,
    withdrawals
  };
}

app.post('/api/admin', (req, res) => {
  const { pin, type, mode, manualNumber, next10Text, username, amount, withdrawalId, action } = req.body;
  if (pin !== ADMIN_PIN) {
    return res.status(401).json({ error: 'Galat Admin PIN' });
  }

  const db = readDb();

  if (type === 'setMode') {
    if (mode === 'auto' || mode === 'manual' || mode === 'fixed10') {
      db.game.mode = mode;
    }
  } else if (type === 'settleManual') {
    const num = Number(manualNumber);
    if (!Number.isInteger(num) || num < 0 || num > 9) {
      return res.status(400).json({ error: '0 se 9 ke beech number daalein' });
    }
    db.game.mode = 'manual';
    settleCurrentRound(db, num);
  } else if (type === 'setFixed10') {
    const parts = String(next10Text || '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const nums = parts.map((x) => Number(x));
    if (!nums.length || nums.length > 10 || nums.some((n) => !Number.isInteger(n) || n < 0 || n > 9)) {
      return res.status(400).json({ error: '1 se 10 numbers (0-9) comma ya space se daalein, jaise: 3, 8, 1, 6' });
    }
    db.game.fixedQueue = nums;
    db.game.mode = 'fixed10';
  } else if (type === 'sendMoney') {
    const u = String(username || '').trim().toLowerCase();
    const amt = Number(amount);
    if (!u || !Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'User ID aur amount sahi daalein' });
    }
    if (!db.users[u]) {
      if (Object.keys(db.users).length >= MAX_USERS) {
        return res.status(400).json({ error: '100 IDs limit full' });
      }
      db.users[u] = { username: u, password: 'user123', wallet: 0, bonusGiven: 0, positions: [] };
    }
    db.users[u].wallet = +(Number(db.users[u].wallet || 0) + amt).toFixed(2);
  } else if (type === 'deleteUser') {
    const u = String(username || '').trim().toLowerCase();
    if (!u || !db.users[u]) {
      return res.status(404).json({ error: 'User nahi mila' });
    }
    delete db.users[u];
  } else if (type === 'reviewWithdrawal') {
    const wd = db.withdrawals.find((w) => w.id === withdrawalId);
    if (!wd) return res.status(404).json({ error: 'Request nahi mili' });
    if (wd.status !== 'pending') return res.status(400).json({ error: 'Request pehle hi process ho chuki hai' });

    if (action === 'approve') {
      wd.status = 'approved';
    } else if (action === 'reject') {
      wd.status = 'rejected';
      if (db.users[wd.username]) {
        db.users[wd.username].wallet = +(Number(db.users[wd.username].wallet || 0) + Number(wd.amount)).toFixed(2);
      }
    } else {
      return res.status(400).json({ error: 'Galat action' });
    }
  }

  writeDb(db);
  res.json(getAdminData(db));
});

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Big & Small Arena</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0 0 80px 0;
      font-family: system-ui, -apple-system, sans-serif;
      background: radial-gradient(circle at top left, #31105f, #090d16 55%, #06283d 100%);
      color: #f8fafc;
      min-height: 100vh;
    }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 14px;
      background: rgba(10, 15, 30, 0.92);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid rgba(168, 85, 247, 0.35);
    }
    .currency-badge {
      background: linear-gradient(135deg, #22c55e, #06b6d4);
      color: #041f24;
      font-weight: 800;
      padding: 7px 13px;
      border-radius: 999px;
      font-size: 13px;
      box-shadow: 0 4px 14px rgba(34, 197, 94, 0.3);
    }
    .help-mail-btn {
      background: linear-gradient(135deg, #f97316, #ec4899);
      color: #fff;
      text-decoration: none;
      font-weight: 700;
      padding: 7px 13px;
      border-radius: 999px;
      font-size: 13px;
      box-shadow: 0 4px 14px rgba(236, 72, 153, 0.3);
    }
    .wrap {
      max-width: 780px;
      margin: 0 auto;
      padding: 14px;
    }
    .card {
      background: rgba(23, 32, 56, 0.92);
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 16px;
      padding: 14px;
      margin-bottom: 12px;
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
    }
    .arena-card {
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.28), rgba(236, 72, 153, 0.2), rgba(6, 182, 212, 0.2));
      border-color: rgba(192, 132, 252, 0.5);
    }
    .round-box {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(9, 13, 22, 0.85);
      border: 1px solid rgba(139, 92, 246, 0.4);
      border-radius: 12px;
      padding: 12px 14px;
    }
    .timer {
      font-size: 28px;
      font-weight: 900;
      color: #fde047;
    }
    .choice-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 12px;
    }
    .choice-btn {
      padding: 15px;
      border-radius: 14px;
      border: 2px solid transparent;
      font-size: 16px;
      font-weight: 800;
      color: #fff;
      cursor: pointer;
    }
    .btn-big { background: linear-gradient(135deg, #ef4444, #db2777); }
    .btn-small { background: linear-gradient(135deg, #0ea5e9, #6366f1); }
    .choice-btn.active { border-color: #fde047; box-shadow: 0 0 0 2px rgba(253, 224, 71, 0.35); }
    input, select, button {
      padding: 9px 11px;
      border-radius: 10px;
      border: 1px solid #475569;
      background: #0b1120;
      color: #fff;
      margin: 4px 0;
      font-size: 14px;
    }
    button {
      background: linear-gradient(135deg, #6366f1, #a855f7);
      border: none;
      font-weight: 700;
      cursor: pointer;
    }
    button.ok { background: linear-gradient(135deg, #10b981, #059669); }
    button.danger { background: linear-gradient(135deg, #ef4444, #dc2626); }
    button.ghost { background: #334155; }
    .pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .pill { padding: 5px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; }
    .pill.BIG { background: #db2777; color: #fff; }
    .pill.SMALL { background: #0284c7; color: #fff; }
    .item-box {
      background: rgba(11, 17, 32, 0.9);
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 10px;
      margin: 8px 0;
      font-size: 13px;
    }
    .bottom-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 25;
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 6px;
      padding: 7px 8px;
      background: rgba(10, 15, 30, 0.96);
      border-top: 1px solid #334155;
    }
    .tab-btn {
      background: #162038;
      color: #94a3b8;
      padding: 8px 6px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 800;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }
    .tab-btn.active {
      background: linear-gradient(135deg, #4f46e5, #9333ea);
      color: #fff;
    }
    .view { display: none; }
    .view.active { display: block; }
    .muted { color: #94a3b8; font-size: 12px; }
    .pos { color: #4ade80; font-weight: 800; }
    .neg { color: #f87171; font-weight: 800; }
  </style>
</head>
<body>

  <!-- TOP BAR: LEFT = VIRTUAL CURRENCY, RIGHT = HELP EMAIL -->
  <div class="topbar">
    <div class="currency-badge" id="topCurrency">₹0.00</div>
    <a class="help-mail-btn" href="mailto:jatakasora@gmail.com?subject=Game%20Help%20-%20Big%20%26%20Small">Help Email</a>
  </div>

  <div class="wrap">
    <!-- DEFAULT HOME (BOTTOM LEFT): BIG & SMALL GAME -->
    <div id="view-home" class="view active">
      <div class="card arena-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div>
            <div style="font-size:18px;font-weight:900">BIG &amp; SMALL GAME</div>
            <div class="muted">0–4 = SMALL | 5–9 = BIG | Win = 1.95x</div>
          </div>
          <span class="pill BIG" style="background:#7c3aed" id="badgeMode">AUTO</span>
        </div>

        <div class="round-box">
          <div>
            <div class="muted">ROUND #<span id="roundNum">1</span></div>
            <div style="font-size:13px;color:#e9d5ff">Next Result In</div>
          </div>
          <div class="timer"><span id="timerSec">10</span>s</div>
        </div>

        <div class="choice-grid">
          <button id="pickBig" class="choice-btn btn-big active" onclick="selectSide('BIG')">BIG (5–9)</button>
          <button id="pickSmall" class="choice-btn btn-small" onclick="selectSide('SMALL')">SMALL (0–4)</button>
        </div>

        <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap">
          <input id="homeAmt" type="number" min="1" step="1" value="10" placeholder="Amount ₹" style="flex:1;min-width:110px">
          <button class="ok" style="padding:10px 18px" onclick="betFromHome()">Play Bet</button>
        </div>
        <div id="homeStatus" style="margin-top:8px;font-size:13px"></div>
      </div>

      <div class="card">
        <b>Recent Rounds History</b>
        <div id="historyBox" class="pills"></div>
      </div>
    </div>

    <!-- BOTTOM CENTER: HOLDINGS, PROFIT/LOSS & BUY / SELL -->
    <div id="view-holdings" class="view">
      <div class="card">
        <div style="font-size:17px;font-weight:900;margin-bottom:6px">Holdings, Loss / Profit &amp; Buy / Sell</div>
        <div id="pnlBox" style="font-size:14px;margin-bottom:10px">Login karein apni holding aur profit/loss dekhne ke liye.</div>

        <div class="item-box">
          <b>Buy Position</b><br>
          <select id="buySide" style="width:130px">
            <option value="BIG">BIG (5–9)</option>
            <option value="SMALL">SMALL (0–4)</option>
          </select>
          <input id="buyAmt" type="number" min="1" step="1" value="10" placeholder="Amount ₹" style="width:120px">
          <button class="ok" onclick="buyHolding()">Buy</button>
          <div class="muted">Open holding ko round settle hone se pehle Sell (90% return) bhi kar sakte hain.</div>
        </div>

        <div id="holdingsList"></div>
      </div>
    </div>

    <!-- BOTTOM RIGHT: ID / PROFILE + WALLET + WITHDRAW + ADMIN -->
    <div id="view-profile" class="view">
      <div class="card">
        <div style="font-size:17px;font-weight:900">Account ID &amp; Wallet</div>
        <div class="muted">Har naye user ko ₹50 virtual bonus milta hai.</div>
        <div style="margin-top:8px">
          <input id="loginId" placeholder="Apni ID (Username)"><br>
          <input id="loginPass" type="password" placeholder="Password"><br>
          <button onclick="loginUser()">Login / Create ID</button>
          <button class="ghost" onclick="logoutUser()">Logout</button>
        </div>
        <div class="item-box">
          <b>ID Name:</b> <span id="accName">Not logged in</span><br>
          <b>Wallet Balance:</b> <span id="accWallet">₹0.00</span>
        </div>
      </div>

      <div class="card">
        <div style="font-size:16px;font-weight:900">Withdraw Request</div>
        <div class="muted">UPI ID aur amount daalein—Adm
