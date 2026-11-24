const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = 'rcdonhai5911';
const MAX_USERS = 100;
const START_CASH = 100;
const DB_PATH = path.join(__dirname, 'data.json');

app.use(express.json());

const defaultDb = () => ({
  usdInr: 84,
  stocks: [
    { symbol: 'MYC', name: 'MyCoin', price: 25, mode: 'manual', min: 5, max: 200, history: [25] }
  ],
  users: {},
  withdrawals: []
});

function readDb() {
  if (!fs.existsSync(DB_PATH)) {
    const d = defaultDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2));
    return d;
  }
  const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  if (!Array.isArray(parsed.withdrawals)) parsed.withdrawals = [];
  return parsed;
}

function writeDb(d) {
  fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2));
}

app.get('/api/state', (req, res) => {
  const db = readDb();
  res.json({ usdInr: db.usdInr, stocks: db.stocks, userCount: Object.keys(db.users).length });
});

app.post('/api/login', (req, res) => {
  const u = String(req.body.username || '').trim().toLowerCase();
  const p = String(req.body.password || '').trim();
  if (!u || !p) return res.status(400).json({ error: 'Username aur password daalein' });

  const db = readDb();
  if (db.users[u]) {
    if (db.users[u].password !== p) {
      return res.status(403).json({ error: 'Ye username pehle se booked hai ya password galat hai' });
    }
    return res.json({ user: db.users[u] });
  }

  if (Object.keys(db.users).length >= MAX_USERS) {
    return res.status(400).json({ error: 'Server limit (100 IDs) full ho chuki hai' });
  }

  db.users[u] = { username: u, password: p, cash: START_CASH, holdings: {} };
  writeDb(db);
  res.json({ user: db.users[u] });
});

app.get('/api/me/:username', (req, res) => {
  const u = String(req.params.username || '').trim().toLowerCase();
  const db = readDb();
  if (!db.users[u]) return res.status(404).json({ error: 'Not found' });
  const myWithdrawals = db.withdrawals.filter((w) => w.username === u).slice(-10).reverse();
  res.json({ user: db.users[u], withdrawals: myWithdrawals });
});

app.post('/api/trade', (req, res) => {
  const { username, password, symbol, side, qty } = req.body;
  const u = String(username || '').trim().toLowerCase();
  const q = Number(qty);
  const db = readDb();
  const user = db.users[u];
  const stock = db.stocks.find((s) => s.symbol === symbol);
  if (!user || user.password !== password) return res.status(401).json({ error: 'Login check karein' });
  if (!stock || !Number.isFinite(q) || q <= 0) return res.status(400).json({ error: 'Galat qty' });

  const cost = +(stock.price * q).toFixed(2);
  const held = Number(user.holdings[symbol] || 0);

  if (side === 'buy') {
    if (user.cash < cost) return res.status(400).json({ error: 'Balance kam hai' });
    user.cash = +(user.cash - cost).toFixed(2);
    user.holdings[symbol] = +(held + q).toFixed(4);
  } else {
    if (held < q) return res.status(400).json({ error: 'Itne shares/coins nahi hain' });
    user.cash = +(user.cash + cost).toFixed(2);
    user.holdings[symbol] = +(held - q).toFixed(4);
  }
  writeDb(db);
  res.json({ user, stocks: db.stocks });
});

app.post('/api/withdraw', (req, res) => {
  const { username, password, upiId, amount } = req.body;
  const u = String(username || '').trim().toLowerCase();
  const upi = String(upiId || '').trim();
  const amt = Number(amount);

  const db = readDb();
  const user = db.users[u];
  if (!user || user.password !== password) return res.status(401).json({ error: 'Pehle sahi login karein' });
  if (!upi || !upi.includes('@') || upi.length < 4) {
    return res.status(400).json({ error: 'Sahi UPI ID daalein (jaise name@upi)' });
  }
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Sahi withdrawal amount daalein' });
  }
  if (user.cash < amt) {
    return res.status(400).json({ error: 'Wallet balance kam hai' });
  }

  user.cash = +(user.cash - amt).toFixed(2);
  const reqItem = {
    id: 'WD_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    username: u,
    upiId: upi,
    amount: +amt.toFixed(2),
    status: 'pending',
    createdAt: new Date().toLocaleString('en-IN')
  };
  db.withdrawals.push(reqItem);
  writeDb(db);

  const myWithdrawals = db.withdrawals.filter((w) => w.username === u).slice(-10).reverse();
  res.json({ ok: true, user, withdrawals: myWithdrawals });
});

app.post('/api/admin', (req, res) => {
  const { pin, type, symbol, name, price, mode, min, max, username, amount, usdInr, withdrawalId, action } = req.body;
  if (pin !== ADMIN_PIN) return res.status(401).json({ error: 'Galat Admin PIN' });

  const db = readDb();
  if (typeof usdInr === 'number' && usdInr > 0) db.usdInr = usdInr;

  if (type === 'create') {
    const sym = String(symbol || '').trim().toUpperCase();
    const pr = Number(price) > 0 ? Number(price) : 10;
    if (!sym || db.stocks.some((s) => s.symbol === sym)) return res.status(400).json({ error: 'Symbol invalid ya pehle se hai' });
    db.stocks.push({
      symbol: sym,
      name: String(name || sym).trim(),
      price: pr,
      mode: mode || 'manual',
      min: Number(min) > 0 ? Number(min) : 1,
      max: Number(max) > 0 ? Number(max) : 500,
      history: [pr]
    });
  } else if (type === 'delete') {
    if (db.stocks.length <= 1) return res.status(400).json({ error: 'Kam se kam 1 stock rehna chahiye' });
    db.stocks = db.stocks.filter((s) => s.symbol !== symbol);
  } else if (type === 'price') {
    const st = db.stocks.find((s) => s.symbol === symbol);
    if (!st) return res.status(404).json({ error: 'Stock nahi mila' });
    if (mode) st.mode = mode;
    if (Number(min) > 0) st.min = Number(min);
    if (Number(max) > 0) st.max = Number(max);
    if (Number(price) > 0) {
      let np = Number(price);
      if (st.mode === 'auto') np = Math.min(st.max, Math.max(st.min, np));
      st.price = +np.toFixed(2);
      st.history.push(st.price);
      if (st.history.length > 60) st.history.shift();
    }
  } else if (type === 'sendMoney') {
    const u = String(username || '').trim().toLowerCase();
    const amt = Number(amount);
    if (!u || !Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Username aur amount sahi daalein' });
    if (!db.users[u]) {
      if (Object.keys(db.users).length >= MAX_USERS) return res.status(400).json({ error: '100 ID limit full' });
      db.users[u] = { username: u, password: 'user123', cash: 0, holdings: {} };
    }
    db.users[u].cash = +(Number(db.users[u].cash || 0) + amt).toFixed(2);
  } else if (type === 'deleteUser') {
    const u = String(username || '').trim().toLowerCase();
    if (!u || !db.users[u]) return res.status(404).json({ error: 'User nahi mila' });
    delete db.users[u];
  } else if (type === 'reviewWithdrawal') {
    const wd = db.withdrawals.find((w) => w.id === withdrawalId);
    if (!wd) return res.status(404).json({ error: 'Withdrawal request nahi mili' });
    if (wd.status !== 'pending') return res.status(400).json({ error: 'Ye request pehle hi process ho chuki hai' });

    if (action === 'approve') {
      wd.status = 'approved';
    } else if (action === 'reject') {
      wd.status = 'rejected';
      if (db.users[wd.username]) {
        db.users[wd.username].cash = +(Number(db.users[wd.username].cash || 0) + Number(wd.amount)).toFixed(2);
      }
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }
  }

  writeDb(db);

  const safeUsers = {};
  for (const [k, v] of Object.entries(db.users)) {
    safeUsers[k] = { username: v.username, cash: v.cash, holdings: v.holdings };
  }

  const enrichedWithdrawals = db.withdrawals.slice().reverse().map((w) => ({
    ...w,
    currentBalance: db.users[w.username] ? Number(db.users[w.username].cash || 0) : 0
  }));

  res.json({ ok: true, usdInr: db.usdInr, stocks: db.stocks, users: safeUsers, withdrawals: enrichedWithdrawals });
});

setInterval(() => {
  const db = readDb();
  let changed = false;
  for (const st of db.stocks) {
    if (st.mode === 'auto') {
      const change = (Math.random() - 0.48) * 0.04;
      let np = Math.min(st.max, Math.max(st.min, st.price * (1 + change)));
      st.price = +np.toFixed(2);
      st.history.push(st.price);
      if (st.history.length > 60) st.history.shift();
      changed = true;
    }
  }
  if (changed) writeDb(db);
}, 2000);

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Mini Coin & Stock Exchange</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;margin:0;padding:16px}
    .row{display:flex;gap:12px;flex-wrap:wrap}.card{background:#1e293b;border-radius:10px;padding:14px;flex:1;min-width:280px}
    input,select,button{padding:8px 10px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#fff;margin:4px 0}
    button{background:#2563eb;border:none;cursor:pointer;font-weight:600}button.danger{background:#dc2626}button.ghost{background:#334155}button.ok{background:#16a34a}
    canvas{width:100%;height:200px;background:#090d16;border-radius:8px;display:block}
    .stock-item{padding:8px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;cursor:pointer}
    .stock-item.active{background:#334155;border-radius:6px}
    .wd-card{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px;margin:8px 0;font-size:13px}
    .muted{color:#94a3b8;font-size:12px}
  </style></head><body>
  <h2>Mini Coin & Stock Exchange (Under 100 IDs)</h2>
  <div class="row">
    <div class="card" style="max-width:360px">
      <h3>User Login / Register</h3>
      <input id="uName" placeholder="Unique Username"><br>
      <input id="uPass" type="password" placeholder="Password"><br>
      <button onclick="login()">Login / Create ID</button>
      <div id="userInfo" style="margin-top:10px;color:#93c5fd">Not logged in</div>

      <hr style="border-color:#334155;margin:14px 0">
      <h3>Wallet & Withdraw</h3>
      <div id="walletSummary" class="muted">Login ke baad wallet balance aur kamai dikhegi.</div>
      <div style="margin-top:8px">
        <input id="wdUpi" placeholder="Your UPI ID (e.g. name@upi)" style="width:180px"><br>
        <input id="wdAmt" type="number" step="0.01" placeholder="Withdraw Amount ₹" style="width:150px">
        <button class="ok" onclick="requestWithdraw()">Withdraw</button>
        <div id="wdMsg" style="margin-top:6px;font-size:13px"></div>
      </div>
      <div id="myWdList" style="margin-top:10px"></div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 id="selTitle">Select Stock</h3>
        <span id="usdBadge">1 USD = ₹84</span>
      </div>
      <canvas id="chart" width="500" height="200"></canvas>
      <div style="margin-top:10px">
        <input id="qty" type="number" step="0.01" value="1" style="width:90px">
        <button onclick="trade('buy')">Buy</button>
        <button class="danger" onclick="trade('sell')">Sell</button>
        <span id="tradeMsg" style="margin-left:8px;font-size:13px"></span>
      </div>
    </div>
  </div>

  <div class="row" style="margin-top:12px">
    <div class="card" style="max-width:360px">
      <h3>Available Stocks</h3>
      <div id="stockList"></div>
    </div>

    <div class="card">
      <h3>Admin Panel</h3>
      <input id="admPin" type="password" placeholder="Admin PIN" style="width:140px">
      <button type="button" class="ghost" onclick="togglePin()">Show/Hide</button>
      <button onclick="unlockAdmin()">Unlock</button>

      <div id="admBox" style="display:none;margin-top:10px">
        <div>
          <b>Withdrawal Requests (Balance, Amount & UPI):</b>
          <div id="admWithdrawals">Koi request nahi hai.</div>
        </div>
        <hr style="border-color:#334155">
        <div>
          <b>Send Virtual Money to User:</b><br>
          <input id="mUser" placeholder="Target Username" style="width:140px">
          <input id="mAmt" type="number" placeholder="Amount ₹" style="width:100px">
          <button onclick="sendMoney()">Send ₹</button>
        </div>
        <hr style="border-color:#334155">
        <div>
          <b>Delete Fake User ID:</b><br>
          <input id="delUser" placeholder="Username to delete" style="width:150px">
          <button class="danger" onclick="deleteUser()">Delete User</button>
        </div>
        <hr style="border-color:#334155">
        <div>
          <b>Update Selected Stock / Auto Limit:</b><br>
          <input id="pVal" type="number" step="0.01" placeholder="New Price ₹" style="width:110px">
          <select id="pMode"><option value="manual">manual</option><option value="auto">auto</option></select>
          <input id="pMin" type="number" placeholder="Min ₹" style="width:80px">
          <input id="pMax" type="number" placeholder="Max ₹" style="width:80px">
          <button onclick="updateStock()">Update</button>
          <button class="danger" onclick="deleteStock()">Delete Stock</button>
        </div>
        <hr style="border-color:#334155">
        <div>
          <b>Create New Stock/Coin:</b><br>
          <input id="cSym" placeholder="Symbol (e.g. GOLD)" style="width:110px">
          <input id="cName" placeholder="Name" style="width:110px">
          <input id="cPrice" type="number" placeholder="Price ₹" style="width:90px">
          <button onclick="createStock()">Create</button>
        </div>
        <div id="admMsg" style="margin-top:8px;color:#86efac"></div>
      </div>
    </div>
  </div>

  <script>
    let state = { usdInr: 84, stocks: [] }, selected = null, user = null, pass = '', adminPin = '', myWithdrawals = [];

    function togglePin() {
      const inp = document.getElementById('admPin');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    }

    async function refresh() {
      const r = await fetch('/api/state');
      state = await r.json();
      document.getElementById('usdBadge').innerText = '1 USD = ₹' + state.usdInr + ' | Users: ' + state.userCount + '/100';
      if (!selected && state.stocks[0]) selected = state.stocks[0].symbol;
      renderStocks();
      drawChart();
      if (user) {
        const ur = await fetch('/api/me/' + encodeURIComponent(user.username));
        if (ur.ok) {
          const ud = await ur.json();
          user = ud.user;
          myWithdrawals = ud.withdrawals || [];
          renderUser();
        }
      }
      if (adminPin) {
        await loadAdminData();
      }
    }

    function renderStocks() {
      const el = document.getElementById('stockList');
      el.innerHTML = state.stocks.map(s =>
        '<div class="stock-item '+(s.symbol===selected?'active':'')+'" onclick="selectStock(\\''+s.symbol+'\\')">' +
        '<span><b>'+s.symbol+'</b> ('+s.name+') ['+s.mode+']</span><span><b>₹'+s.price+'</b></span></div>'
      ).join('');
      const st = state.stocks.find(x => x.symbol === selected);
      if (st) document.getElementById('selTitle').innerText = st.symbol + ' — ₹' + st.price + ' ($' + (st.price/state.usdInr).toFixed(2) + ')';
    }

    function selectStock(sym) { selected = sym; renderStocks(); drawChart(); }

    function drawChart() {
      const c = document.getElementById('chart'), ctx = c.getContext('2d');
      ctx.clearRect(0,0,c.width,c.height);
      const st = state.stocks.find(x => x.symbol === selected);
      if (!st || !st.history.length) return;
      const arr = st.history, min = Math.min(...arr), max = Math.max(...arr), span = (max - min) || 1;
      ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.beginPath();
      arr.forEach((v, i) => {
        const x = (i / Math.max(1, arr.length - 1)) * (c.width - 20) + 10;
        const y = c.height - (((v - min) / span) * (c.height - 30) + 15);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    async function login() {
      const username = document.getElementById('uName').value, password = document.getElementById('uPass').value;
      const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username, password }) });
      const d = await r.json();
      if (!r.ok) return alert(d.error);
      user = d.user; pass = password;
      localStorage.setItem('mini_u', JSON.stringify({ username: user.username, password }));
      const ur = await fetch('/api/me/' + encodeURIComponent(user.username));
      if (ur.ok) { const ud = await ur.json(); user = ud.user; myWithdrawals = ud.withdrawals || []; }
      renderUser();
    }

    function calcPortfolioValue(uObj) {
      let hVal = 0;
      for (const [sym, q] of Object.entries(uObj.holdings || {})) {
        const st = state.stocks.find(x => x.symbol === sym);
        if (st && q > 0) hVal += st.price * Number(q);
      }
      return +(Number(uObj.cash || 0) + hVal).toFixed(2);
    }

    function renderUser() {
      if (!user) return;
      const hStr = Object.entries(user.holdings || {}).filter(([,q])=>q>0).map(([k,q])=>k+': '+q).join(', ') || 'None';
      document.getElementById('userInfo').innerHTML = '<b>@'+user.username+'</b><br>Wallet Cash: <b>₹'+user.cash+'</b><br>Holdings: '+hStr;

      const totalVal = calcPortfolioValue(user);
      const netGain = +(totalVal - 100).toFixed(2);
      const sign = netGain >= 0 ? '+' : '';
      const color = netGain >= 0 ? '#86efac' : '#fca5a5';
      document.getElementById('walletSummary').innerHTML =
        '<div style="color:#f8fafc;font-size:14px">Available Wallet: <b>₹'+user.cash+'</b> | Total Value: <b>₹'+totalVal+'</b></div>' +
        '<div style="color:'+color+';margin-top:2px">Net Kamai (vs ₹100 start): <b>'+sign+'₹'+netGain+'</b></div>';

      document.getElementById('myWdList').innerHTML = myWithdrawals.length
        ? '<div class="muted">Recent Withdrawals:</div>' + myWithdrawals.map(w =>
            '<div class="wd-card">₹<b>'+w.amount+'</b> → '+w.upiId+' | <b>'+w.status.toUpperCase()+'</b><br><span class="muted">'+w.createdAt+'</span></div>'
          ).join('')
        : '';
    }

    async function trade(side) {
      if (!user) return alert('Pehle login karein');
      const qty = Number(document.getElementById('qty').value);
      const r = await fetch('/api/trade', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username:user.username, password:pass, symbol:selected, side, qty }) });
      const d = await r.json();
      document.getElementById('tradeMsg').innerText = d.error || (side.toUpperCase() + ' done!');
      if (r.ok) { user = d.user; state.stocks = d.stocks; renderUser(); renderStocks(); drawChart(); }
    }

    async function requestWithdraw() {
      if (!user) return alert('Pehle login karein');
      const upiId = document.getElementById('wdUpi').value;
      const amount = Number(document.getElementById('wdAmt').value);
      const r = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, password: pass, upiId, amount })
      });
      const d = await r.json();
      const el = document.getElementById('wdMsg');
      if (!r.ok) {
        el.style.color = '#fca5a5';
        el.innerText = d.error;
        return;
      }
      user = d.user;
      myWithdrawals = d.withdrawals || [];
      document.getElementById('wdAmt').value = '';
      el.style.color = '#86efac';
      el.innerText = 'Withdrawal request bhej di gayi hai!';
      renderUser();
    }

    async function unlockAdmin() {
      const pinVal = document.getElementById('admPin').value;
      if (pinVal !== 'rcdonhai5911') return alert('Wrong PIN');
      adminPin = pinVal;
      document.getElementById('adm
