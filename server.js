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
app.use(express.static(path.join(__dirname, 'public')));

function defGame() {
  return { round: 1, secondsLeft: 10, mode: 'auto', fixedQueue: [], history: [{ round: 0, number: 7, result: 'BIG' }, { round: 0, number: 3, result: 'SMALL' }] };
}
function defDb() {
  return { game: defGame(), users: {}, withdrawals: [] };
}
function classify(n) {
  const x = Math.max(0, Math.min(9, Number(n) || 0));
  return x >= 5 ? 'BIG' : 'SMALL';
}
function readDb() {
  if (!fs.existsSync(DB_PATH)) {
    const d = defDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2));
    return d;
  }
  try {
    const d = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    const g = defGame();
    d.game = { ...g, ...(d.game || {}) };
    if (!Array.isArray(d.game.fixedQueue)) d.game.fixedQueue = [];
    if (!Array.isArray(d.game.history)) d.game.history = g.history;
    if (!d.users || typeof d.users !== 'object') d.users = {};
    if (!Array.isArray(d.withdrawals)) d.withdrawals = [];
    return d;
  } catch {
    const d = defDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2));
    return d;
  }
}
function writeDb(d) {
  fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2));
}
function settle(db, chosen) {
  const num = Math.max(0, Math.min(9, Number(chosen)));
  const outcome = classify(num);
  const r = db.game.round;
  for (const u of Object.values(db.users)) {
    if (!Array.isArray(u.positions)) u.positions = [];
    for (const p of u.positions) {
      if (p.status === 'open' && p.round === r) {
        if (p.side === outcome) {
          const pay = +(Number(p.amount) * 1.95).toFixed(2);
          p.status = 'won';
          p.pnl = +(pay - Number(p.amount)).toFixed(2);
          u.wallet = +(Number(u.wallet || 0) + pay).toFixed(2);
        } else {
          p.status = 'lost';
          p.pnl = +(-Number(p.amount)).toFixed(2);
        }
      }
    }
  }
  db.game.history.unshift({ round: r, number: num, result: outcome });
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
    if (db.game.fixedQueue.length === 0) db.game.mode = 'auto';
  }
  settle(db, nextNum);
  writeDb(db);
}, 1000);

app.get('/api/state', (req, res) => {
  const db = readDb();
  res.json({ game: db.game, adminEmail: ADMIN_EMAIL, userCount: Object.keys(db.users).length });
});

app.post('/api/login', (req, res) => {
  const u = String(req.body.username || '').trim().toLowerCase();
  const p = String(req.body.password || '').trim();
  if (!u || !p) return res.status(400).json({ error: 'ID aur password daalein' });
  const db = readDb();
  if (db.users[u]) {
    if (db.users[u].password !== p) return res.status(403).json({ error: 'Galat password ya ID booked hai' });
    return res.json({ user: db.users[u] });
  }
  if (Object.keys(db.users).length >= MAX_USERS) return res.status(400).json({ error: '100 IDs limit full' });
  db.users[u] = { username: u, password: p, wallet: BONUS_RUPEES, bonusGiven: BONUS_RUPEES, positions: [] };
  writeDb(db);
  res.json({ user: db.users[u] });
});

app.get('/api/me/:username', (req, res) => {
  const u = String(req.params.username || '').trim().toLowerCase();
  const db = readDb();
  if (!db.users[u]) return res.status(404).json({ error: 'User nahi mila' });
  const wd = db.withdrawals.filter((w) => w.username === u).slice(-10).reverse();
  res.json({ user: db.users[u], withdrawals: wd });
});

app.post('/api/bet', (req, res) => {
  const { username, password, side, amount } = req.body;
  const u = String(username || '').trim().toLowerCase();
  const s = String(side || '').toUpperCase();
  const amt = Number(amount);
  const db = readDb();
  const user = db.users[u];
  if (!user || user.password !== password) return res.status(401).json({ error: 'Pehle login karein' });
  if (s !== 'BIG' && s !== 'SMALL') return res.status(400).json({ error: 'BIG ya SMALL chunein' });
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Sahi amount daalein' });
  if (Number(user.wallet || 0) < amt) return res.status(400).json({ error: 'Balance kam hai' });
  if (!Array.isArray(user.positions)) user.positions = [];
  user.wallet = +(Number(user.wallet) - amt).toFixed(2);
  user.positions.unshift({ id: 'P_' + Date.now() + '_' + Math.floor(Math.random() * 999), round: db.game.round, side: s, amount: +amt.toFixed(2), status: 'open', pnl: 0, time: new Date().toLocaleTimeString('en-IN') });
  writeDb(db);
  res.json({ ok: true, user });
});

app.post('/api/sell-position', (req, res) => {
  const { username, password, positionId } = req.body;
  const u = String(username || '').trim().toLowerCase();
  const db = readDb();
  const user = db.users[u];
  if (!user || user.password !== password) return res.status(401).json({ error: 'Pehle login karein' });
  const pos = (user.positions || []).find((p) => p.id === positionId && p.status === 'open');
  if (!pos) return res.status(404).json({ error: 'Open holding nahi mili' });
  const back = +(Number(pos.amount) * 0.9).toFixed(2);
  pos.status = 'sold';
  pos.pnl = +(back - Number(pos.amount)).toFixed(2);
  user.wallet = +(Number(user.wallet || 0) + back).toFixed(2);
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
  if (!user || user.password !== password) return res.status(401).json({ error: 'Pehle login karein' });
  if (!upi || !upi.includes('@') || upi.length < 4) return res.status(400).json({ error: 'Sahi UPI ID daalein' });
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Sahi amount daalein' });
  if (Number(user.wallet || 0) < amt) return res.status(400).json({ error: 'Balance kam hai' });
  user.wallet = +(Number(user.wallet) - amt).toFixed(2);
  db.withdrawals.push({ id: 'W_' + Date.now() + '_' + Math.floor(Math.random() * 999), username: u, upiId: upi, amount: +amt.toFixed(2), status: 'pending', createdAt: new Date().toLocaleString('en-IN') });
  writeDb(db);
  const wd = db.withdrawals.filter((w) => w.username === u).slice(-10).reverse();
  res.json({ ok: true, user, withdrawals: wd });
});

function adminPayload(db) {
  const usersList = Object.values(db.users).map((u) => {
    const openHoldings = (u.positions || []).filter((p) => p.status === 'open').reduce((s, x) => s + Number(x.amount || 0), 0);
    return { username: u.username, wallet: +Number(u.wallet || 0).toFixed(2), openHoldings: +openHoldings.toFixed(2) };
  });
  const withdrawals = db.withdrawals.slice().reverse().map((w) => ({
    ...w,
    currentBalance: db.users[w.username] ? +Number(db.users[w.username].wallet || 0).toFixed(2) : 0
  }));
  return { ok: true, game: db.game, adminEmail: ADMIN_EMAIL, usersList, withdrawals };
}

app.post('/api/admin', (req, res) => {
  const { pin, type, mode, manualNumber, next10Text, username, amount, withdrawalId, action } = req.body;
  if (pin !== ADMIN_PIN) return res.status(401).json({ error: 'Galat Admin PIN' });
  const db = readDb();
  if (type === 'setMode' && (mode === 'auto' || mode === 'manual' || mode === 'fixed10')) {
    db.game.mode = mode;
  } else if (type === 'settleManual') {
    const num = Number(manualNumber);
    if (!Number.isInteger(num) || num < 0 || num > 9) return res.status(400).json({ error: '0-9 number daalein' });
    db.game.mode = 'manual';
    settle(db, num);
  } else if (type === 'setFixed10') {
    const nums = String(next10Text || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).map(Number);
    if (!nums.length || nums.length > 10 || nums.some((n) => !Number.isInteger(n) || n < 0 || n > 9)) {
      return res.status(400).json({ error: '1-10 numbers (0-9) comma/space se daalein' });
    }
    db.game.fixedQueue = nums;
    db.game.mode = 'fixed10';
  } else if (type === 'sendMoney') {
    const u = String(username || '').trim().toLowerCase();
    const amt = Number(amount);
    if (!u || !Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'ID aur amount sahi daalein' });
    if (!db.users[u]) {
      if (Object.keys(db.users).length >= MAX_USERS) return res.status(400).json({ error: '100 IDs limit full' });
      db.users[u] = { username: u, password: 'user123', wallet: 0, bonusGiven: 0, positions: [] };
    }
    db.users[u].wallet = +(Number(db.users[u].wallet || 0) + amt).toFixed(2);
  } else if (type === 'deleteUser') {
    const u = String(username || '').trim().toLowerCase();
    if (!u || !db.users[u]) return res.status(404).json({ error: 'User nahi mila' });
    delete db.users[u];
  } else if (type === 'reviewWithdrawal') {
    const wd = db.withdrawals.find((w) => w.id === withdrawalId);
    if (!wd) return res.status(404).json({ error: 'Request nahi mili' });
    if (wd.status !== 'pending') return res.status(400).json({ error: 'Pehle hi process ho chuki hai' });
    if (action === 'approve') wd.status = 'approved';
    else if (action === 'reject') {
      wd.status = 'rejected';
      if (db.users[wd.username]) db.users[wd.username].wallet = +(Number(db.users[wd.username].wallet || 0) + Number(wd.amount)).toFixed(2);
    } else return res.status(400).json({ error: 'Galat action' });
  }
  writeDb(db);
  res.json(adminPayload(db));
});

app.listen(PORT, () => console.log('Big & Small server running on port ' + PORT));
