const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'db.json');
const TEMP_DATA_FILE = DATA_FILE + '.tmp';

const ADMIN_PASS = process.env.ADMIN_PASS || 'rcdonhai5911';
const UPI_ID = 'jaatvipippb@axl';
const SUPPORT_EMAIL = 'jatakasora@gmail.com';
const MAX_USERS = 100;
const ROUND_DURATION = 30; // seconds

const DEPOSIT_PLANS = {
  100: { base: 100, bonusPct: 15, total: 115 },
  200: { base: 200, bonusPct: 20, total: 240 },
  500: { base: 500, bonusPct: 25, total: 625 }
};

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function roundMoney(val) {
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

function defaultState() {
  return {
    users: {},
    roundNumber: 1,
    secondsLeft: ROUND_DURATION,
    roundHistory: [],
    mode: 'AUTO',
    manualQueue: [],
    currentBets: [],
    depositRequests: [],
    withdrawRequests: [],
    lastOutcomeBanner: null
  };
}

function sanitizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  const users = {};
  if (raw.users && typeof raw.users === 'object') {
    for (const [k, u] of Object.entries(raw.users)) {
      if (!u || typeof u !== 'object') continue;
      const uname = String(u.username || k).trim();
      if (!uname || uname === '__proto__' || uname === 'constructor' || uname === 'prototype') continue;
      users[uname] = {
        username: uname,
        password: String(u.password || ''),
        balance: Number.isFinite(Number(u.balance)) ? Math.max(0, roundMoney(u.balance)) : 0,
        myHistory: Array.isArray(u.myHistory) ? u.myHistory.slice(0, 10) : [],
        lastWithdrawDate: u.lastWithdrawDate ? String(u.lastWithdrawDate) : null,
        createdAt: Number(u.createdAt) || Date.now()
      };
    }
  }

  const roundHistory = Array.isArray(raw.roundHistory)
    ? raw.roundHistory
        .filter((x) => x && (x.outcome === 'SMALL' || x.outcome === 'BIG'))
        .slice(0, 10)
        .map((x) => ({ round: Number(x.round) || 1, outcome: x.outcome }))
    : [];

  const manualQueue = Array.isArray(raw.manualQueue)
    ? raw.manualQueue.slice(0, 10).map((m) => (m === 'BIG' ? 'BIG' : 'SMALL'))
    : [];

  const mode = raw.mode === 'MANUAL' && manualQueue.length > 0 ? 'MANUAL' : 'AUTO';

  return {
    users,
    roundNumber: Number.isInteger(Number(raw.roundNumber)) && Number(raw.roundNumber) >= 1 ? Number(raw.roundNumber) : 1,
    secondsLeft:
      Number.isInteger(Number(raw.secondsLeft)) && Number(raw.secondsLeft) >= 1 && Number(raw.secondsLeft) <= ROUND_DURATION
        ? Number(raw.secondsLeft)
        : ROUND_DURATION,
    roundHistory,
    mode,
    manualQueue,
    currentBets: Array.isArray(raw.currentBets) ? raw.currentBets : [],
    depositRequests: Array.isArray(raw.depositRequests) ? raw.depositRequests : [],
    withdrawRequests: Array.isArray(raw.withdrawRequests) ? raw.withdrawRequests : [],
    lastOutcomeBanner: raw.lastOutcomeBanner && typeof raw.lastOutcomeBanner === 'object' ? raw.lastOutcomeBanner : null
  };
}

function loadState() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      const init = defaultState();
      fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2), 'utf8');
      return init;
    }
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return sanitizeState(raw);
  } catch (e) {
    console.error('Load error, using clean state:', e.message);
    return defaultState();
  }
}

let state = loadState();
let isSaving = false;
let needsAnotherSave = false;

function saveState() {
  if (isSaving) {
    needsAnotherSave = true;
    return;
  }
  isSaving = true;
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TEMP_DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(TEMP_DATA_FILE, DATA_FILE);
  } catch (e) {
    console.error('Save error:', e.message);
  } finally {
    isSaving = false;
    if (needsAnotherSave) {
      needsAnotherSave = false;
      saveState();
    }
  }
}

function todayKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === 'year')?.value || '1970';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

function pickOutcome() {
  // 1. MANUAL मोड: जब एडमिन ने अगले राउंड फिक्स किए हों
  if (state.mode === 'MANUAL' && Array.isArray(state.manualQueue) && state.manualQueue.length > 0) {
    const next = state.manualQueue.shift();
    if (state.manualQueue.length === 0) {
      state.mode = 'AUTO';
    }
    return next === 'BIG' ? 'BIG' : 'SMALL';
  }

  // 2. AUTO मोड: 1% जीत और 99% हार की संभावना
  state.mode = 'AUTO';
  let totalSmall = 0;
  let totalBig = 0;

  for (const bet of state.currentBets) {
    if (bet.round !== state.roundNumber) continue;
    if (bet.choice === 'SMALL') {
      totalSmall = roundMoney(totalSmall + Number(bet.amount || 0));
    } else if (bet.choice === 'BIG') {
      totalBig = roundMoney(totalBig + Number(bet.amount || 0));
    }
  }

  // यदि किसी खिलाड़ी ने दांव लगाया है (एक तरफ ज़्यादा या एक ही तरफ दांव है)
  if (totalBig !== totalSmall) {
    const majorityChoice = totalBig > totalSmall ? 'BIG' : 'SMALL';
    const minorityChoice = majorityChoice === 'BIG' ? 'SMALL' : 'BIG';

    // केवल 1% (0.01) स्थिति में दांव वाली साइड जीतेगी, 99% स्थिति में उल्टा नतीजा आएगा
    return Math.random() < 0.01 ? majorityChoice : minorityChoice;
  }

  // यदि दोनों तरफ बराबर दांव है या किसी ने दांव नहीं लगाया है, तो 50-50 रैंडम
  return Math.random() < 0.5 ? 'SMALL' : 'BIG';
}


function settleRound() {
  const outcome = pickOutcome();
  const completedRound = state.roundNumber;

  state.roundHistory.unshift({ round: completedRound, outcome });
  if (state.roundHistory.length > 10) {
    state.roundHistory = state.roundHistory.slice(0, 10);
  }

  const settledTime = new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit'
  });

  for (const bet of state.currentBets) {
    if (bet.round !== completedRound) continue;
    const user = Object.prototype.hasOwnProperty.call(state.users, bet.username) ? state.users[bet.username] : null;
    if (!user) continue;

    const won = bet.choice === outcome;
    if (won) {
      const payout = roundMoney(bet.amount * 2);
      user.balance = roundMoney(user.balance + payout);
    }

    user.myHistory.unshift({
      round: completedRound,
      choice: bet.choice,
      outcome,
      amount: roundMoney(bet.amount),
      won,
      time: settledTime
    });
    if (user.myHistory.length > 10) {
      user.myHistory = user.myHistory.slice(0, 10);
    }
  }

  state.currentBets = [];
  state.lastOutcomeBanner = { round: completedRound, outcome, ts: Date.now() };
  state.roundNumber += 1;
  state.secondsLeft = ROUND_DURATION;
  saveState();
}

setInterval(() => {
  if (state.secondsLeft > 1) {
    state.secondsLeft -= 1;
  } else {
    settleRound();
  }
}, 1000);

app.get('/api/state', (req, res) => {
  const username = String(req.query.username || '').trim();
  const userObj = username && Object.prototype.hasOwnProperty.call(state.users, username) ? state.users[username] : null;

  res.json({
    brand: 'REX11',
    upiId: UPI_ID,
    supportEmail: SUPPORT_EMAIL,
    depositPlans: DEPOSIT_PLANS,
    roundNumber: state.roundNumber,
    secondsLeft: state.secondsLeft,
    roundHistory: state.roundHistory.slice(0, 10),
    lastOutcomeBanner: state.lastOutcomeBanner,
    userCount: Object.keys(state.users).length,
    maxUsers: MAX_USERS,
    user: userObj
      ? {
          username: userObj.username,
          balance: roundMoney(userObj.balance),
          myHistory: userObj.myHistory.slice(0, 10),
          lastWithdrawDate: userObj.lastWithdrawDate
        }
      : null
  });
});

app.post('/api/auth', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'यूज़रनेम और पासवर्ड ज़रूरी है।' });
  }
  if (username.length > 24) {
    return res.status(400).json({ error: 'यूज़रनेम 24 अक्षरों से कम रखें।' });
  }
  if (username === '__proto__' || username === 'constructor' || username === 'prototype') {
    return res.status(400).json({ error: 'यह यूज़रनेम मान्य नहीं है।' });
  }

  const existing = Object.prototype.hasOwnProperty.call(state.users, username) ? state.users[username] : null;
  if (existing) {
    if (existing.password !== password) {
      return res.status(401).json({ error: 'पासवर्ड गलत है।' });
    }
    return res.json({
      ok: true,
      user: {
        username: existing.username,
        balance: roundMoney(existing.balance),
        myHistory: existing.myHistory.slice(0, 10),
        lastWithdrawDate: existing.lastWithdrawDate
      }
    });
  }

  if (Object.keys(state.users).length >= MAX_USERS) {
    return res.status(403).json({
      error: 'अधिकतम 100 आईडी की सीमा पूरी हो चुकी है। नया अकाउंट बनने से पहले एडमिन को किसी पुरानी आईडी को हटाना होगा।'
    });
  }

  state.users[username] = {
    username,
    password,
    balance: 0,
    myHistory: [],
    lastWithdrawDate: null,
    createdAt: Date.now()
  };
  saveState();

  return res.json({
    ok: true,
    user: {
      username,
      balance: 0,
      myHistory: [],
      lastWithdrawDate: null
    }
  });
});

app.post('/api/bet', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const choice = String(req.body?.choice || '').toUpperCase();
  const amount = roundMoney(req.body?.amount);

  if (!username || !Object.prototype.hasOwnProperty.call(state.users, username)) {
    return res.status(401).json({ error: 'पहले प्रोफाइल से लॉगिन करें।' });
  }
  if (choice !== 'SMALL' && choice !== 'BIG') {
    return res.status(400).json({ error: 'SMALL या BIG चुनें।' });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'सही राशि डालें।' });
  }

  const user = state.users[username];
  if (user.balance < amount) {
    return res.status(400).json({ error: 'वॉलेट में पर्याप्त बैलेंस नहीं है।' });
  }

  user.balance = roundMoney(user.balance - amount);
  state.currentBets.push({
    id: 'bet_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    username,
    choice,
    amount,
    round: state.roundNumber
  });
  saveState();

  return res.json({ ok: true, balance: user.balance });
});

app.post('/api/deposit', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const planAmount = Number(req.body?.planAmount);
  const utr = String(req.body?.utr || '').trim();

  if (!username || !Object.prototype.hasOwnProperty.call(state.users, username)) {
    return res.status(401).json({ error: 'पहले लॉगिन करें।' });
  }
  const plan = Object.prototype.hasOwnProperty.call(DEPOSIT_PLANS, planAmount) ? DEPOSIT_PLANS[planAmount] : null;
  if (!plan) {
    return res.status(400).json({ error: 'केवल 100, 200 या 500 का प्लान चुनें।' });
  }
  if (!utr || utr.length < 4) {
    return res.status(400).json({ error: 'सही UTR नंबर डालें।' });
  }

  state.depositRequests.unshift({
    id: 'dep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    username,
    planAmount: plan.base,
    bonusPct: plan.bonusPct,
    creditAmount: plan.total,
    utr,
    createdAt: Date.now()
  });
  saveState();

  return res.json({ ok: true, message: 'डिपॉज़िट रिक्वेस्ट एडमिन को भेज दी गई है।' });
});

app.post('/api/withdraw', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const amount = roundMoney(req.body?.amount);
  const upi = String(req.body?.upi || '').trim();

  if (!username || !Object.prototype.hasOwnProperty.call(state.users, username)) {
    return res.status(401).json({ error: 'पहले लॉगिन करें।' });
  }
  const user = state.users[username];
  const today = todayKey();

  if (user.lastWithdrawDate === today) {
    return res.status(400).json({ error: 'एक दिन में केवल 1 बार विड्रॉल रिक्वेस्ट की जा सकती है।' });
  }
  if (!Number.isFinite(amount) || amount < 300 || amount > 500) {
    return res.status(400).json({ error: 'विड्रॉल राशि ₹300 से ₹500 के बीच होनी चाहिए।' });
  }
  if (!upi || !upi.includes('@') || upi.length < 4) {
    return res.status(400).json({ error: 'सही UPI ID डालें।' });
  }
  if (user.balance < amount) {
    return res.status(400).json({ error: 'वॉलेट में पर्याप्त बैलेंस नहीं है।' });
  }

  const taxAmount = roundMoney(amount * 0.33);
  const netAmount = roundMoney(amount - taxAmount);

  user.balance = roundMoney(user.balance - amount);
  user.lastWithdrawDate = today;

  state.withdrawRequests.unshift({
    id: 'wd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    username,
    amount,
    taxAmount,
    netAmount,
    upi,
    createdAt: Date.now()
  });
  saveState();

  return res.json({
    ok: true,
    balance: user.balance,
    message: `रिक्वेस्ट भेजी गई। 33% टैक्स (₹${taxAmount}) के बाद शुद्ध राशि ₹${netAmount} है।`
  });
});

function requireAdmin(req, res, next) {
  const pass = String(req.headers['x-admin-pass'] || req.body?.adminPass || '');
  if (pass !== ADMIN_PASS) {
    return res.status(403).json({ error: 'एडमिन पासवर्ड गलत है।' });
  }
  next();
}

app.post('/api/admin/login', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

app.get('/api/admin/data', requireAdmin, (req, res) => {
  const usersList = Object.values(state.users).map((u) => ({
    username: u.username,
    balance: roundMoney(u.balance),
    lastWithdrawDate: u.lastWithdrawDate
  }));

  res.json({
    mode: state.mode,
    manualQueue: state.manualQueue.slice(0, 10),
    depositRequests: state.depositRequests,
    withdrawRequests: state.withdrawRequests,
    users: usersList,
    userCount: usersList.length,
    maxUsers: MAX_USERS
  });
});

app.post('/api/admin/rounds', requireAdmin, (req, res) => {
  const mode = String(req.body?.mode || 'AUTO').toUpperCase();
  if (mode === 'AUTO') {
    state.mode = 'AUTO';
    state.manualQueue = [];
    saveState();
    return res.json({ ok: true, mode: state.mode, manualQueue: state.manualQueue });
  }

  const rawSeq = String(req.body?.sequence || '');
  const digits = rawSeq.match(/[12]/g) || [];
  if (digits.length === 0) {
    return res.status(400).json({ error: '1 (SMALL) और 2 (BIG) के अंक डालें (अधिकतम 10 राउंड)।' });
  }

  state.manualQueue = digits.slice(0, 10).map((d) => (d === '2' ? 'BIG' : 'SMALL'));
  state.mode = 'MANUAL';
  saveState();

  return res.json({ ok: true, mode: state.mode, manualQueue: state.manualQueue });
});

app.post('/api/admin/credit', requireAdmin, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const amount = roundMoney(req.body?.amount);

  if (!username || !Object.prototype.hasOwnProperty.call(state.users, username)) {
    return res.status(404).json({ error: 'यह यूज़रनेम नहीं मिला।' });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'सही राशि डालें।' });
  }

  state.users[username].balance = roundMoney(state.users[username].balance + amount);
  saveState();
  return res.json({ ok: true, balance: state.users[username].balance });
});

app.post('/api/admin/deposit-action', requireAdmin, (req, res) => {
  const id = String(req.body?.id || '');
  const action = String(req.body?.action || '').toUpperCase();

  if (action !== 'ACCEPT' && action !== 'DECLINE') {
    return res.status(400).json({ error: 'अमान्य कार्रवाई।' });
  }

  const idx = state.depositRequests.findIndex((r) => r.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'रिक्वेस्ट नहीं मिली या पहले ही प्रोसेस हो चुकी है।' });
  }

  const reqItem = state.depositRequests[idx];
  if (action === 'ACCEPT' && Object.prototype.hasOwnProperty.call(state.users, reqItem.username)) {
    state.users[reqItem.username].balance = roundMoney(
      state.users[reqItem.username].balance + Number(reqItem.creditAmount || 0)
    );
  }

  state.depositRequests.splice(idx, 1);
  saveState();
  return res.json({ ok: true });
});

app.post('/api/admin/withdraw-action', requireAdmin, (req, res) => {
  const id = String(req.body?.id || '');
  const action = String(req.body?.action || '').toUpperCase();

  if (action !== 'APPROVE' && action !== 'DECLINE') {
    return res.status(400).json({ error: 'अमान्य कार्रवाई।' });
  }

  const idx = state.withdrawRequests.findIndex((r) => r.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'रिक्वेस्ट नहीं मिली या पहले ही प्रोसेस हो चुकी है।' });
  }

  const reqItem = state.withdrawRequests[idx];
  if (action === 'DECLINE' && Object.prototype.hasOwnProperty.call(state.users, reqItem.username)) {
    state.users[reqItem.username].balance = roundMoney(
      state.users[reqItem.username].balance + Number(reqItem.amount || 0)
    );
  }

  state.withdrawRequests.splice(idx, 1);
  saveState();
  return res.json({ ok: true });
});

app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
  const username = String(req.params.username || '').trim();
  if (!username || !Object.prototype.hasOwnProperty.call(state.users, username)) {
    return res.status(404).json({ error: 'यूज़र नहीं मिला।' });
  }
  delete state.users[username];
  state.currentBets = state.currentBets.filter((b) => b.username !== username);
  state.depositRequests = state.depositRequests.filter((r) => r.username !== username);
  state.withdrawRequests = state.withdrawRequests.filter((r) => r.username !== username);
  saveState();
  return res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'सर्वर में त्रुटि हुई।' });
});

app.listen(PORT, () => {
  console.log(`REX11 server running on port ${PORT}`);
});
