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
    mode: 'auto',
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
while (db.game.history.length > 20) db.game.history.pop();

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
    db.game.history = (db.game.history || []).slice(0, 20);
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
  const DEPOSIT_UPI_ID = 'Jaatvipippb@axl';

function calcDepositBonus(amount) {
  const amt = Number(amount);
  if (amt === 100) return { bonusPct: 5, bonusAmt: 5, totalCredit: 105 };
  if (amt === 300) return { bonusPct: 12, bonusAmt: 36, totalCredit: 336 };
  if (amt === 500) return { bonusPct: 25, bonusAmt: 125, totalCredit: 625 };
  return { bonusPct: 0, bonusAmt: 0, totalCredit: amt };
}

app.get('/api/deposit-info', (req, res) => {
  res.json({
    upiId: DEPOSIT_UPI_ID,
    minAmount: 100,
    maxAmount: 500,
    plans: [
      { amount: 100, bonusPct: 5, bonusAmt: 5, totalCredit: 105 },
      { amount: 300, bonusPct: 12, bonusAmt: 36, totalCredit: 336 },
      { amount: 500, bonusPct: 25, bonusAmt: 125, totalCredit: 625 }
    ]
  });
});

app.post('/api/deposit', (req, res) => {
  const { username, password, amount, utrId } = req.body;
  const u = String(username || '').trim().toLowerCase();
  const amt = Number(amount);
  const utr = String(utrId || '').trim();

  const db = readDb();
  const user = db.users[u];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Pehle login karein' });
  }
  if (!Number.isFinite(amt) || amt < 100 || amt > 500) {
    return res.status(400).json({ error: 'Deposit ₹100 se ₹500 ke beech hona chahiye' });
  }
  if (!utr || utr.length < 6) {
    return res.status(400).json({ error: 'Sahi UTR ID daalein' });
  }

  const plan = calcDepositBonus(amt);
  if (!Array.isArray(db.deposits)) db.deposits = [];

  db.deposits.push({
    id: 'DEP_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
    username: u,
    amount: amt,
    bonusPct: plan.bonusPct,
    bonusAmt: plan.bonusAmt,
    totalCredit: plan.totalCredit,
    utrId: utr,
    upiId: DEPOSIT_UPI_ID,
    status: 'pending',
    createdAt: new Date().toLocaleString('en-IN')
  });

  writeDb(db);
  const myDeposits = db.deposits.filter((d) => d.username === u).slice(-10).reverse();
  res.json({ ok: true, deposits: myDeposits });
});
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
  <title>Big &amp; Small Arena</title>
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
    }
    .help-mail-btn {
    .right-header-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.aviator-teaser {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  background: rgba(15, 23, 42, 0.9);
  border: 1px dashed rgba(250, 204, 21, 0.75);
  border-radius: 10px;
  padding: 3px 8px;
}
.aviator-teaser-tag {
  font-size: 8px;
  font-weight: 900;
  color: #fde047;
}
.aviator-plane-sticker {
  font-size: 16px;
  transform: rotate(-18deg);
  display: inline-block;
}
      background: linear-gradient(135deg, #f97316, #ec4899);
      color: #fff;
      text-decoration: none;
      font-weight: 700;
      padding: 7px 13px;
      border-radius: 999px;
      font-size: 13px;
    }
    .wrap { max-width: 780px; margin: 0 auto; padding: 14px; }
    .card {
      background: rgba(23, 32, 56, 0.92);
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 16px;
      padding: 14px;
      margin-bottom: 12px;
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
    .timer { font-size: 28px; font-weight: 900; color: #fde047; }
    .choice-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
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
    .choice-btn.active { border-color: #fde047; }
    input, select, button {
      padding: 9px 11px;
      border-radius: 10px;
      border: 1px solid #475569;
      background: #0b1120;
      color: #fff;
      margin: 4px 0;
      font-size: 14px;
    }
    button { background: linear-gradient(135deg, #6366f1, #a855f7); border: none; font-weight: 700; cursor: pointer; }
    button.ok { background: linear-gradient(135deg, #10b981, #059669); }
    button.danger { background: linear-gradient(135deg, #ef4444, #dc2626); }
    button.ghost { background: #334155; }
    .pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .pill { padding: 5px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; }
    .pill.BIG { background: #db2777; color: #fff; }
    .pill.SMALL { background: #0284c7; color: #fff; }
    .item-box { background: rgba(11, 17, 32, 0.9); border: 1px solid #334155; border-radius: 12px; padding: 10px; margin: 8px 0; font-size: 13px; }
    .bottom-bar {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 25;
      display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;
      padding: 7px 8px; background: rgba(10, 15, 30, 0.96); border-top: 1px solid #334155;
    }
    .tab-btn {
      background: #162038; color: #94a3b8; padding: 8px 6px; border-radius: 12px;
      font-size: 12px; font-weight: 800; display: flex; flex-direction: column; align-items: center; gap: 2px;
    }
    .tab-btn.active { background: linear-gradient(135deg, #4f46e5, #9333ea); color: #fff; }
    .view { display: none; }
    .view.active { display: block; }
    .muted { color: #94a3b8; font-size: 12px; }
    .pos { color: #4ade80; font-weight: 800; }
    .neg { color: #f87171; font-weight: 800; }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="currency-badge" id="topCurrency">₹0.00</div>
    <div class="right-header-stack">
  <a class="help-mail-btn" href="mailto:jatakasora@gmail.com?subject=Game%20Help%20-%20Big%20%26%20Small">Help Email</a>
  <div class="aviator-teaser">
    <span class="aviator-teaser-tag">COMING SOON</span>
    <span class="aviator-plane-sticker">✈️</span>
  </div>
</div>
  </div>

  <div class="wrap">
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
        <div class="muted">UPI ID aur amount daalein—Admin ko balance, amount aur UPI ID dikh jayegi.</div>
        <input id="wdUpi" placeholder="UPI ID (e.g. name@upi)" style="width:220px"><br>
        <input id="wdAmt" type="number" step="0.01" placeholder="Amount ₹" style="width:140px">
        <button class="ok" onclick="submitWithdraw()">Withdraw</button>
        <div id="wdStatus" style="margin-top:6px;font-size:13px"></div>
        <div id="userWithdrawals"></div>
      </div>
            <div class="card" id="depositSection">
        <div style="font-size:16px;font-weight:900">Deposit &amp; Bonus Plans</div>
        <div class="muted">Min ₹100 — Max ₹500 | Plans: ₹100 (+5%), ₹300 (+12%), ₹500 (+25%)</div>

        <div class="item-box">
          <b>Admin UPI ID:</b> <span id="depUpiText">Jaatvipippb@axl</span><br>
          <button type="button" class="ghost" style="margin-top:6px" onclick="copyDepositUpi()">Copy UPI ID</button>
          <span id="copyUpiMsg" class="pos" style="margin-left:8px;font-size:12px"></span>
        </div>

        <div class="item-box">
          <b>Bonus Plans:</b><br>
          <button type="button" class="ghost" onclick="setDepositPlan(100)">₹100 (+5% = ₹105)</button>
          <button type="button" class="ghost" onclick="setDepositPlan(300)">₹300 (+12% = ₹336)</button>
          <button type="button" class="ghost" onclick="setDepositPlan(500)">₹500 (+25% = ₹625)</button>
        </div>

        <input id="depAmt" type="number" min="100" max="500" step="1" placeholder="Amount (₹100 - ₹500)" style="width:180px"><br>
        <input id="depUtr" placeholder="UTR ID daalein" style="width:220px"><br>
        <button type="button" class="ok" onclick="submitDeposit()">Submit Deposit</button>
        <div id="depStatus" style="margin-top:6px;font-size:13px"></div>
        <div id="userDeposits"></div>
      </div>

      <div class="card">
        <div style="font-size:16px;font-weight:900">Help Center</div>
        <div class="muted">Kisi bhi madad ke liye Admin Email: <b>jatakasora@gmail.com</b></div>
        <a class="help-mail-btn" style="display:inline-block;margin-top:8px" href="mailto:jatakasora@gmail.com?subject=Support%20-%20Big%20%26%20Small">Email jatakasora@gmail.com</a>
      </div>

      <div class="card" style="border-color:#c084fc">
        <div style="font-size:17px;font-weight:900;color:#e9d5ff">Admin Panel</div>
        <div class="muted">Admin PIN daalkar unlock karein (PIN hidden rahega).</div>
        <input id="adminPinInput" type="password" placeholder="Admin PIN" style="width:150px">
        <button type="button" class="ghost" onclick="togglePin()">Show/Hide</button>
        <button onclick="loginAdmin()">Admin Login</button>

        <div id="adminControls" style="display:none;margin-top:12px">
          <div class="item-box">
            <b>1. Big / Small Number Control (Auto / Manual / Next 10 Fix)</b><br>
            <div class="muted">Mode: <span id="admMode">auto</span> | Next 10 Queue: <span id="admQueue">[]</span></div>
            <div style="margin-top:6px">
              <button class="ghost" onclick="changeMode('auto')">Auto</button>
              <button class="ghost" onclick="changeMode('manual')">Manual</button>
            </div>
            <div style="margin-top:8px">
              <span class="muted">Turant Number (0–9) set &amp; round settle:</span><br>
              <input id="manNumber" type="number" min="0" max="9" placeholder="0-9" style="width:85px">
              <button onclick="settleManual()">Settle Now</button>
            </div>
            <div style="margin-top:8px">
              <span class="muted">Agle 10 Rounds Fix (0–9, comma/space se):</span><br>
              <input id="fix10Nums" placeholder="e.g. 2, 7, 4, 9, 0" style="width:220px">
              <button class="ok" onclick="setNext10()">Fix 10 Rounds</button>
            </div>
          </div>

          <div class="item-box">
            <b>2. Send Virtual Money to User ID</b><br>
            <input id="creditUser" placeholder="User ID" style="width:140px">
            <input id="creditAmt" type="number" placeholder="Amount ₹" style="width:105px">
            <button class="ok" onclick="sendVirtualMoney()">Send ₹</button>
          </div>

          <div class="item-box">
            <b>3. Help Email:</b> jatakasora@gmail.com
          </div>

          <div class="item-box">
            <b>4. Users List, Balance &amp; Delete User</b><br>
            <input id="removeUserId" placeholder="Delete User ID" style="width:145px">
            <button class="danger" onclick="removeUser()">Delete User</button>
            <div id="adminUsersList" style="margin-top:8px"></div>
          </div>

          <div class="item-box">
            <b>5. Withdrawal Requests (Balance, Amount &amp; UPI)</b>
            <div id="adminWithdrawalsList" style="margin-top:6px"></div>
          </div>

          <div id="adminMsg" class="pos" style="margin-top:6px"></div>
        </div>
      </div>
    </div>
  </div>

  <div class="bottom-bar">
    <button id="tab-home" class="tab-btn active" onclick="openTab('home')">
      <span>🎲</span><span>Home</span>
    </button>
    <button id="tab-holdings" class="tab-btn" onclick="openTab('holdings')">
      <span>💼</span><span>Holdings</span>
    </button>
    <button id="tab-profile" class="tab-btn" onclick="openTab('profile')">
      <span>👤</span><span>ID / Profile</span>
    </button>
  </div>

  <script>
    let gameState = { round: 1, secondsLeft: 10, mode: 'auto', fixedQueue: [], history: [] };
    let chosenSide = 'BIG';
    let currentUser = null;
    let currentPass = '';
    let adminPin = '';
    let userWd = [];

    function openTab(name) {
      ['home', 'holdings', 'profile'].forEach((t) => {
        document.getElementById('view-' + t).classList.toggle('active', t === name);
        document.getElementById('tab-' + t).classList.toggle('active', t === name);
      });
    }

    function selectSide(side) {
      chosenSide = side;
      document.getElementById('pickBig').classList.toggle('active', side === 'BIG');
      document.getElementById('pickSmall').classList.toggle('active', side === 'SMALL');
      document.getElementById('buySide').value = side;
    }
let shownWinIds = JSON.parse(localStorage.getItem('bs_shown_wins') || '[]');

function showWinNotification(amount) {
  const box = document.createElement('div');
  box.innerText = '🎉 Congratulations! आपने ₹' + Number(amount).toFixed(2) + ' विन किया है!';
  box.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:999;background:linear-gradient(135deg,#16a34a,#06b6d4);color:#041f24;font-weight:900;padding:12px 18px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,0.45);font-size:14px;max-width:92%;text-align:center;';
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4500);
}
    function togglePin() {
      const inp = document.getElementById('adminPinInput');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    }

    async function pollAll() {
      const r = await fetch('/api/state');
      if (r.ok) {
        const d = await r.json();
        gameState = d.game || gameState;
        renderGame();
      }
      if (currentUser) {
        const ur = await fetch('/api/me/' + encodeURIComponent(currentUser.username));
        if (ur.ok) {
          const ud = await ur.json();
          currentUser = ud.user;
          userWd = ud.withdrawals || [];
          renderUser();
        }
      }
      if (adminPin) {
        await refreshAdmin();
      }
    }

    function renderGame() {
      document.getElementById('roundNum').innerText = gameState.round || 1;
      document.getElementById('timerSec').innerText = gameState.secondsLeft || 10;
      document.getElementById('badgeMode').innerText = (gameState.mode || 'auto').toUpperCase();

      const hBox = document.getElementById('historyBox');
      hBox.innerHTML = (gameState.history || []).map((item) =>
        '<span class="pill ' + item.result + '">#' + item.round + ' : ' + item.number + ' (' + item.result + ')</span>'
      ).join('');
    }

    function renderUser() {
      if (!currentUser) {
        document.getElementById('topCurrency').innerText = '₹0.00';
        document.getElementById('accName').innerText = 'Not logged in';
        document.getElementById('accWallet').innerText = '₹0.00';
        document.getElementById('pnlBox').innerText = 'Login karein apni holding aur profit/loss dekhne ke liye.';
        document.getElementById('holdingsList').innerHTML = '';
        document.getElementById('userWithdrawals').innerHTML = '';
        return;
      }

      const wallet = Number(currentUser.wallet || 0);
      const bonus = Number(currentUser.bonusGiven ?? 50);
      const posArr = currentUser.positions || [];
      const openHold = posArr.filter((p) => p.status === 'open').reduce((s, x) => s + Number(x.amount || 0), 0);
      const freshWins = posArr.filter((p) => p.status === 'won' && !shownWinIds.includes(p.id));
if (freshWins.length) {
  const totalWon = freshWins.reduce((s, item) => s + (Number(item.amount || 0) + Number(item.pnl || 0)), 0);
  freshWins.forEach((w) => shownWinIds.push(w.id));
  localStorage.setItem('bs_shown_wins', JSON.stringify(shownWinIds.slice(-100)));
  showWinNotification(totalWon);
}
      const netPnl = +((wallet + openHold) - bonus).toFixed(2);
      const sign = netPnl >= 0 ? '+' : '';
      const cls = netPnl >= 0 ? 'pos' : 'neg';

      document.getElementById('topCurrency').innerText = '₹' + wallet.toFixed(2);
      document.getElementById('accName').innerText = '@' + currentUser.username;
      document.getElementById('accWallet').innerText = '₹' + wallet.toFixed(2);
      document.getElementById('pnlBox').innerHTML =
        'Wallet: <b>₹' + wallet.toFixed(2) + '</b> | Open Holding: <b>₹' + openHold.toFixed(2) + '</b> | ' +
        'Profit/Loss: <span class="' + cls + '">' + sign + '₹' + netPnl.toFixed(2) + '</span>';

      document.getElementById('holdingsList').innerHTML = posArr.length
        ? posArr.map((p) => {
            const actionHtml = p.status === 'open'
              ? '<button class="ghost" style="padding:5px 9px;font-size:12px" onclick="sellHolding(\\'' + p.id + '\\')">Sell (90%)</button>'
              : '<b>' + p.status.toUpperCase() + '</b> (' + (p.pnl >= 0 ? '+' : '') + '₹' + p.pnl + ')';
            return '<div class="item-box" style="display:flex;justify-content:space-between;align-items:center">' +
              '<div><b>Round #' + p.round + '</b> • <span class="pill ' + p.side + '">' + p.side + '</span> • Holding: <b>₹' + p.amount + '</b><br><span class="muted">' + p.time + '</span></div>' +
              '<div>' + actionHtml + '</div></div>';
          }).join('')
        : '<div class="muted">Abhi koi holding nahi hai.</div>';

      document.getElementById('userWithdrawals').innerHTML = userWd.length
        ? '<div class="muted" style="margin-top:8px">Aapki Withdrawal Requests:</div>' + userWd.map((w) =>
            '<div class="item-box">₹<b>' + w.amount + '</b> → ' + w.upiId + ' | <b>' + w.status.toUpperCase() + '</b><br><span class="muted">' + w.createdAt + '</span></div>'
          ).join('')
        : '';
    }

    async function loginUser() {
      const username = document.getElementById('loginId').value;
      const password = document.getElementById('loginPass').value;
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const d = await r.json();
      if (!r.ok) return alert(d.error);
      currentUser = d.user;
      currentPass = password;
      localStorage.setItem('bs_proj_u', JSON.stringify({ username: currentUser.username, password }));
      await pollAll();
    }

    function logoutUser() {
      currentUser = null;
      currentPass = '';
      localStorage.removeItem('bs_proj_u');
      renderUser();
    }

    async function betFromHome() {
      if (!currentUser) return alert('Pehle ID/Profile tab se login karein');
      const amount = Number(document.getElementById('homeAmt').value);
      const r = await fetch('/api/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, password: currentPass, side: chosenSide, amount })
      });
      const d = await r.json();
      const el = document.getElementById('homeStatus');
      if (!r.ok) { el.className = 'neg'; el.innerText = d.error; return; }
      el.className = 'pos';
      el.innerText = chosenSide + ' par ₹' + amount + ' lag gaya!';
      currentUser = d.user;
      renderUser();
    }

    async function buyHolding() {
      if (!currentUser) return alert('Pehle login karein');
      const side = document.getElementById('buySide').value;
      const amount = Number(document.getElementById('buyAmt').value);
      const r = await fetch('/api/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, password: currentPass, side, amount })
      });
      const d = await r.json();
      if (!r.ok) return alert(d.error);
      currentUser = d.user;
      renderUser();
    }

    async function sellHolding(positionId) {
      const r = await fetch('/api/sell-position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, password: currentPass, positionId })
      });
      const d = await r.json();
      if (!r.ok) return alert(d.error);
      currentUser = d.user;
      renderUser();
    }

    async function submitWithdraw() {
      if (!currentUser) return alert('Pehle login karein');
      const upiId = document.getElementById('wdUpi').value;
      const amount = Number(document.getElementById('wdAmt').value);
      const r = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, password: currentPass, upiId, amount })
      });
      const d = await r.json();
      const el = document.getElementById('wdStatus');
      if (!r.ok) { el.className = 'neg'; el.innerText = d.error; return; }
      el.className = 'pos';
      el.innerText = 'Withdrawal request bhej di gayi hai!';
      document.getElementById('wdAmt').value = '';
      currentUser = d.user;
      userWd = d.withdrawals || [];
      renderUser();
    }
        let depositUpi = 'Jaatvipippb@axl';
    let userDep = [];

    function setDepositPlan(amt) {
      document.getElementById('depAmt').value = amt;
    }

    function copyDepositUpi() {
      const text = document.getElementById('depUpiText').innerText;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      const temp = document.createElement('textarea');
      temp.value = text;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      temp.remove();
      document.getElementById('copyUpiMsg').innerText = 'Copied!';
      setTimeout(() => { document.getElementById('copyUpiMsg').innerText = ''; }, 2000);
    }

    async function loadDepositInfo() {
      const r = await fetch('/api/deposit-info');
      if (r.ok) {
        const d = await r.json();
        depositUpi = d.upiId || depositUpi;
        document.getElementById('depUpiText').innerText = depositUpi;
      }
    }

    function renderUserDeposits() {
      const box = document.getElementById('userDeposits');
      if (!box) return;
      box.innerHTML = userDep.length
        ? '<div class="muted" style="margin-top:8px">Aapki Deposit Requests:</div>' + userDep.map((d) =>
            '<div class="item-box">₹<b>' + d.amount + '</b> (+' + d.bonusPct + '% = <b>₹' + d.totalCredit + '</b>) | UTR: <b>' + d.utrId + '</b> | <b>' + d.status.toUpperCase() + '</b><br><span class="muted">' + d.createdAt + '</span></div>'
          ).join('')
        : '';
    }

    async function submitDeposit() {
      if (!currentUser) return alert('Pehle login karein');
      const amount = Number(document.getElementById('depAmt').value);
      const utrId = document.getElementById('depUtr').value;
      const r = await fetch('/api/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, password: currentPass, amount, utrId })
      });
      const d = await r.json();
      const el = document.getElementById('depStatus');
      if (!r.ok) { el.className = 'neg'; el.innerText = d.error; return; }
      el.className = 'pos';
      el.innerText = 'Deposit request aur UTR submit ho gayi!';
      document.getElementById('depUtr').value = '';
      userDep = d.deposits || [];
      renderUserDeposits();
    }

    loadDepositInfo();

    async function loginAdmin() {
      const pinVal = document.getElementById('adminPinInput').value;
      if (pinVal !== 'rcdonhai5911') return alert('Galat Admin PIN');
      adminPin = pinVal;
      document.getElementById('adminControls').style.display = 'block';
      await refreshAdmin();
    }

    async function adminAction(payload) {
      const r = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: adminPin, ...payload })
      });
      const d = await r.json();
      if (!r.ok) {
        document.getElementById('adminMsg').className = 'neg';
        document.getElementById('adminMsg').innerText = d.error;
        return null;
      }
      document.getElementById('adminMsg').className = 'pos';
      renderAdminPanel(d);
      await pollAll();
      return d;
    }

    async function refreshAdmin() {
      await adminAction({ type: 'sync' });
    }

    function renderAdminPanel(d) {
      document.getElementById('admMode').innerText = d.game.mode;
      document.getElementById('admQueue').innerText = JSON.stringify(d.game.fixedQueue || []);

      document.getElementById('adminUsersList').innerHTML = (d.usersList || []).length
        ? d.usersList.map((u) =>
            '<div class="item-box"><b>@' + u.username + '</b> — Balance: <b>₹' + u.wallet + '</b> | Open Holding: ₹' + u.openHoldings + '</div>'
          ).join('')
        : '<div class="muted">Koi user nahi hai.</div>';

      document.getElementById('adminWithdrawalsList').innerHTML = (d.withdrawals || []).length
        ? d.withdrawals.map((w) => {
            const btns = w.status === 'pending'
              ? '<button class="ok" style="padding:5px 9px" onclick="decideWd(\\'' + w.id + '\\', \\'approve\\')">Approve</button> ' +
                '<button class="danger" style="padding:5px 9px" onclick="decideWd(\\'' + w.id + '\\', \\'reject\\')">Reject</button>'
              : '<b>' + w.status.toUpperCase() + '</b>';
            return '<div class="item-box">' +
              '<b>User:</b> @' + w.username + ' | <b>User Balance:</b> ₹' + w.currentBalance + '<br>' +
              '<b>Withdraw Amount:</b> ₹<b>' + w.amount + '</b> | <b>UPI ID:</b> <b>' + w.upiId + '</b><br>' +
              '<span class="muted">' + w.createdAt + '</span><br>' +
              '<div style="margin-top:6px">' + btns + '</div></div>';
          }).join('')
        : '<div class="muted">Koi withdrawal request nahi hai.</div>';
    }

    async function changeMode(mode) {
      const d = await adminAction({ type: 'setMode', mode });
      if (d) document.getElementById('adminMsg').innerText = 'Mode set: ' + mode;
    }

    async function settleManual() {
      const manualNumber = Number(document.getElementById('manNumber').value);
      const d = await adminAction({ type: 'settleManual', manualNumber });
      if (d) document.getElementById('adminMsg').innerText = 'Settled with number ' + manualNumber;
    }

    async function setNext10() {
      const next10Text = document.getElementById('fix10Nums').value;
      const d = await adminAction({ type: 'setFixed10', next10Text });
      if (d) document.getElementById('adminMsg').innerText = 'Next 10 rounds queue updated!';
    }

    async function sendVirtualMoney() {
      const username = document.getElementById('creditUser').value;
      const amount = Number(document.getElementById('creditAmt').value);
      const d = await adminAction({ type: 'sendMoney', username, amount });
      if (d) document.getElementById('adminMsg').innerText = '₹' + amount + ' sent to ' + username;
    }

    async function removeUser() {
      const username = document.getElementById('removeUserId').value;
      const d = await adminAction({ type: 'deleteUser', username });
      if (d) document.getElementById('adminMsg').innerText = 'Deleted user ' + username;
    }

    async function decideWd(withdrawalId, action) {
      const d = await adminAction({ type: 'reviewWithdrawal', withdrawalId, action });
      if (d) document.getElementById('adminMsg').innerText = 'Withdrawal ' + action + 'd';
    }

    const savedSession = JSON.parse(localStorage.getItem('bs_proj_u') || 'null');
    if (savedSession) {
      document.getElementById('loginId').value = savedSession.username;
      document.getElementById('loginPass').value = savedSession.password;
      loginUser();
    }
    pollAll();
    setInterval(pollAll, 1000);
  </script>
</body>
</html>`);
});

app.listen(PORT, () => console.log('Big & Small server running on port ' + PORT));
