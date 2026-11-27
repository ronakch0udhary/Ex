const STORAGE_USER_KEY = 'rex11_user';
const STORAGE_ADMIN_KEY = 'rex11_admin_pass';

let currentUser = localStorage.getItem(STORAGE_USER_KEY) || '';
let adminPass = localStorage.getItem(STORAGE_ADMIN_KEY) || '';
let selectedChoice = 'SMALL';
let selectedPlan = null;
let lastShownBannerTs = 0;

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

function fmtRs(n) {
  const num = Number(n || 0);
  return '₹' + (Number.isInteger(num) ? num : num.toFixed(2));
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.tab;
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-view').forEach((v) => v.classList.remove('active'));
    document.getElementById(targetId).classList.add('active');
    if (targetId === 'tab-admin' && adminPass) {
      loadAdminData();
    }
  });
});

document.getElementById('adminIconBtn').addEventListener('click', () => {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-view').forEach((v) => v.classList.remove('active'));
  document.getElementById('tab-admin').classList.add('active');
  if (adminPass) {
    document.getElementById('adminAuthCard').classList.add('hidden');
    document.getElementById('adminDashboard').classList.remove('hidden');
    loadAdminData();
  } else {
    document.getElementById('adminAuthCard').classList.remove('hidden');
    document.getElementById('adminDashboard').classList.add('hidden');
  }
});

document.querySelectorAll('.choice-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedChoice = btn.dataset.choice;
    document.querySelectorAll('.choice-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
});
document.querySelector('.choice-btn[data-choice="SMALL"]').classList.add('selected');

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.getElementById('betAmount').value = chip.dataset.chip;
  });
});

document.getElementById('placeBetBtn').addEventListener('click', async () => {
  if (!currentUser) {
    showToast('पहले प्रोफाइल से लॉगिन करें।');
    return;
  }
  const amount = Number(document.getElementById('betAmount').value);
  const res = await fetch('/api/bet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser, choice: selectedChoice, amount })
  });
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'दांव नहीं लग सका');
  document.getElementById('betAmount').value = '';
  showToast(`राउंड पर ${selectedChoice} के लिए ${fmtRs(amount)} का दांव लगा!`);
  pollState();
});

document.getElementById('authSubmitBtn').addEventListener('click', async () => {
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'लॉगिन असफल');
  currentUser = data.user.username;
  localStorage.setItem(STORAGE_USER_KEY, currentUser);
  document.getElementById('authPassword').value = '';
  showToast('प्रोफाइल सेव और लॉगिन हो गया।');
  pollState();
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  currentUser = '';
  localStorage.removeItem(STORAGE_USER_KEY);
  showToast('लॉगआउट हो गया।');
  pollState();
});

document.querySelectorAll('.plan-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedPlan = Number(btn.dataset.plan);
    document.querySelectorAll('.plan-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('depositPayBox').classList.remove('hidden');
  });
});

document.getElementById('submitDepositBtn').addEventListener('click', async () => {
  if (!currentUser) return showToast('पहले लॉगिन करें।');
  if (!selectedPlan) return showToast('पहले 100, 200 या 500 का प्लान चुनें।');
  const utr = document.getElementById('utrInput').value.trim();
  const res = await fetch('/api/deposit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser, planAmount: selectedPlan, utr })
  });
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'रिक्वेस्ट नहीं भेजी जा सकी');
  document.getElementById('utrInput').value = '';
  showToast(data.message);
});

document.getElementById('withdrawAmount').addEventListener('input', (e) => {
  const amt = Number(e.target.value);
  if (!amt || amt <= 0) {
    document.getElementById('taxPreview').textContent = '33% टैक्स कटौती के बाद: ₹0';
    return;
  }
  const net = (amt * 0.67).toFixed(2);
  document.getElementById('taxPreview').textContent = `33% टैक्स कटौती के बाद: ₹${net}`;
});

document.getElementById('submitWithdrawBtn').addEventListener('click', async () => {
  if (!currentUser) return showToast('पहले लॉगिन करें।');
  const amount = Number(document.getElementById('withdrawAmount').value);
  const upi = document.getElementById('withdrawUpi').value.trim();
  const res = await fetch('/api/withdraw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser, amount, upi })
  });
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'विड्रॉल रिक्वेस्ट असफल');
  document.getElementById('withdrawAmount').value = '';
  document.getElementById('withdrawUpi').value = '';
  document.getElementById('taxPreview').textContent = '33% टैक्स कटौती के बाद: ₹0';
  showToast(data.message);
  pollState();
});

document.getElementById('adminLoginBtn').addEventListener('click', async () => {
  const pass = document.getElementById('adminPassInput').value;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminPass: pass })
  });
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'गलत पासवर्ड');
  adminPass = pass;
  localStorage.setItem(STORAGE_ADMIN_KEY, adminPass);
  document.getElementById('adminPassInput').value = '';
  document.getElementById('adminAuthCard').classList.add('hidden');
  document.getElementById('adminDashboard').classList.remove('hidden');
  loadAdminData();
});

document.getElementById('modeAutoBtn').addEventListener('click', async () => {
  const res = await fetch('/api/admin/rounds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-pass': adminPass },
    body: JSON.stringify({ mode: 'AUTO' })
  });
  const data = await res.json();
  if (res.ok) {
    showToast('AUTO मोड चालू हो गया।');
    loadAdminData();
  } else showToast(data.error);
});

document.getElementById('saveSeqBtn').addEventListener('click', async () => {
  const sequence = document.getElementById('manualSeqInput').value.trim();
  const res = await fetch('/api/admin/rounds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-pass': adminPass },
    body: JSON.stringify({ mode: 'MANUAL', sequence })
  });
  const data = await res.json();
  if (res.ok) {
    document.getElementById('manualSeqInput').value = '';
    showToast('अगले राउंड्स का सीक्वेंस सेव हो गया।');
    loadAdminData();
  } else showToast(data.error);
});

document.getElementById('creditBtn').addEventListener('click', async () => {
  const username = document.getElementById('creditUsername').value.trim();
  const amount = Number(document.getElementById('creditAmount').value);
  const res = await fetch('/api/admin/credit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-pass': adminPass },
    body: JSON.stringify({ username, amount })
  });
  const data = await res.json();
  if (res.ok) {
    document.getElementById('creditAmount').value = '';
    showToast(`${username} के खाते में ${fmtRs(amount)} जोड़ दिए गए।`);
    loadAdminData();
    pollState();
  } else showToast(data.error);
});

async function handleDepositAction(id, action) {
  const res = await fetch('/api/admin/deposit-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-pass': adminPass },
    body: JSON.stringify({ id, action })
  });
  const data = await res.json();
  if (res.ok) {
    showToast(action === 'ACCEPT' ? 'डिपॉज़िट मंजूर और लिस्ट से हटा दिया गया।' : 'डिपॉज़िट डिक्लाइन और हटा दिया गया।');
    loadAdminData();
    pollState();
  } else showToast(data.error);
}

async function handleWithdrawAction(id, action) {
  const res = await fetch('/api/admin/withdraw-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-pass': adminPass },
    body: JSON.stringify({ id, action })
  });
  const data = await res.json();
  if (res.ok) {
    showToast(action === 'APPROVE' ? 'विड्रॉल मंजूर और लिस्ट से हटा दिया गया।' : 'विड्रॉल डिक्लाइन और हटा दिया गया।');
    loadAdminData();
    pollState();
  } else showToast(data.error);
}

async function deleteUserAccount(username) {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
    method: 'DELETE',
    headers: { 'x-admin-pass': adminPass }
  });
  const data = await res.json();
  if (res.ok) {
    showToast(`${username} आईडी हटा दी गई।`);
    loadAdminData();
    pollState();
  } else showToast(data.error);
}

async function loadAdminData() {
  if (!adminPass) return;
  const res = await fetch('/api/admin/data', {
    headers: { 'x-admin-pass': adminPass }
  });
  if (res.status === 403) {
    adminPass = '';
    localStorage.removeItem(STORAGE_ADMIN_KEY);
    document.getElementById('adminDashboard').classList.add('hidden');
    document.getElementById('adminAuthCard').classList.remove('hidden');
    showToast('एडमिन पासवर्ड मान्य नहीं है, दोबारा लॉगिन करें।');
    return;
  }
  if (!res.ok) return;
  const d = await res.json();

  document.getElementById('adminRoundStatus').textContent =
    `वर्तमान मोड: ${d.mode} | क्यू में बाकी: ${d.manualQueue.join(', ') || 'कोई नहीं'}`;

  const depEl = document.getElementById('adminDepositList');
  depEl.innerHTML = d.depositRequests.length
    ? d.depositRequests
        .map(
          (r) => `
      <div class="row-card">
        <div><strong>${escapeHtml(r.username)}</strong> • प्लान: ${fmtRs(r.planAmount)} (+${r.bonusPct}%) → <strong>${fmtRs(r.creditAmount)}</strong></div>
        <div class="muted-sm">UTR: ${escapeHtml(r.utr)}</div>
        <div class="row-actions">
          <button class="success-btn" onclick="handleDepositAction('${escapeHtml(r.id)}', 'ACCEPT')">Accept</button>
          <button class="warn-btn" onclick="handleDepositAction('${escapeHtml(r.id)}', 'DECLINE')">Decline</button>
        </div>
      </div>`
        )
        .join('')
    : '<div class="muted-sm">कोई डिपॉज़िट रिक्वेस्ट नहीं है।</div>';

  const wdEl = document.getElementById('adminWithdrawList');
  wdEl.innerHTML = d.withdrawRequests.length
    ? d.withdrawRequests
        .map(
          (r) => `
      <div class="row-card">
        <div><strong>${escapeHtml(r.username)}</strong> • रिक्वेस्ट: ${fmtRs(r.amount)} | 33% टैक्स: -${fmtRs(r.taxAmount)}</div>
        <div>क्रेडिट योग्य (UPI <strong>${escapeHtml(r.upi)}</strong>): <strong style="color:#69f0ae">${fmtRs(r.netAmount)}</strong></div>
        <div class="row-actions">
          <button class="success-btn" onclick="handleWithdrawAction('${escapeHtml(r.id)}', 'APPROVE')">मंजूर करें</button>
          <button class="warn-btn" onclick="handleWithdrawAction('${escapeHtml(r.id)}', 'DECLINE')">डिक्लाइन</button>
        </div>
      </div>`
        )
        .join('')
    : '<div class="muted-sm">कोई विड्रॉल रिक्वेस्ट नहीं है।</div>';

  document.getElementById('adminUserCount').textContent = `(${d.userCount}/${d.maxUsers})`;
  const usersEl = document.getElementById('adminUsersList');
  usersEl.innerHTML = d.users.length
    ? d.users
        .map(
          (u) => `
      <div class="row-card profile-head">
        <div>
          <strong>${escapeHtml(u.username)}</strong>
          <div class="muted-sm">बैलेंस: ${fmtRs(u.balance)}</div>
        </div>
        <button class="ghost-btn" onclick="deleteUserAccount('${escapeHtml(u.username)}')">हटाएं</button>
      </div>`
        )
        .join('')
    : '<div class="muted-sm">अभी कोई यूज़र नहीं है।</div>';
}

async function pollState() {
  try {
    const q = currentUser ? `?username=${encodeURIComponent(currentUser)}` : '';
    const res = await fetch('/api/state' + q);
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('roundNum').textContent = data.roundNumber;
    const secs = String(data.secondsLeft).padStart(2, '0');
    document.getElementById('timerText').textContent = `00:${secs}`;

    document.getElementById('slotsInfo').textContent = `(${data.userCount}/${data.maxUsers} IDs)`;

    if (data.user) {
      document.getElementById('walletBox').textContent = fmtRs(data.user.balance);
      document.getElementById('topUserBadge').textContent = data.user.username;
      document.getElementById('authSection').classList.add('hidden');
      document.getElementById('loggedInProfile').classList.remove('hidden');
      document.getElementById('profileUsername').textContent = data.user.username;

      const myHist = document.getElementById('myHistoryList');
      myHist.innerHTML = data.user.myHistory.length
        ? data.user.myHistory
            .map(
              (h) => `
          <div class="row-card profile-head">
            <div>
              <strong>राउंड #${h.round}</strong> • चुना: ${escapeHtml(h.choice)} (नतीजा: ${escapeHtml(h.outcome)})
              <div class="muted-sm">दांव: ${fmtRs(h.amount)} • ${escapeHtml(h.time)}</div>
            </div>
            <strong style="color:${h.won ? '#69f0ae' : '#ff80ab'}">${h.won ? 'WINNER' : 'LOSS'}</strong>
          </div>`
            )
            .join('')
        : '<div class="muted-sm">अभी कोई राउंड हिस्ट्री नहीं है।</div>';
    } else {
      if (currentUser) {
        currentUser = '';
        localStorage.removeItem(STORAGE_USER_KEY);
      }
      document.getElementById('walletBox').textContent = '₹0';
      document.getElementById('topUserBadge').textContent = 'Guest';
      document.getElementById('authSection').classList.remove('hidden');
      document.getElementById('loggedInProfile').classList.add('hidden');
      document.getElementById('myHistoryList').innerHTML =
        '<div class="muted-sm">अपनी 10 राउंड की हिस्ट्री देखने के लिए प्रोफाइल में लॉगिन करें।</div>';
    }

    const pubHist = document.getElementById('publicHistoryList');
    pubHist.innerHTML = data.roundHistory.length
      ? data.roundHistory
          .map(
            (r) => `<span class="pill-item ${r.outcome === 'BIG' ? 'pill-big' : 'pill-small'}">#${r.round} ${r.outcome}</span>`
          )
          .join('')
      : '<span class="muted-sm">पहला राउंड जारी है...</span>';

    if (data.lastOutcomeBanner && data.lastOutcomeBanner.ts !== lastShownBannerTs) {
      lastShownBannerTs = data.lastOutcomeBanner.ts;
      const banner = document.getElementById('resultBanner');
      const userRoundItem = data.user?.myHistory?.find((x) => x.round === data.lastOutcomeBanner.round);

      banner.classList.remove('hidden', 'win', 'loss');
      if (userRoundItem) {
        if (userRoundItem.won) {
          banner.classList.add('win');
          banner.textContent = `🏆 WINNER! राउंड #${data.lastOutcomeBanner.round} का नतीजा ${data.lastOutcomeBanner.outcome} रहा।`;
        } else {
          banner.classList.add('loss');
          banner.textContent = `❌ LOSS — राउंड #${data.lastOutcomeBanner.round} का नतीजा ${data.lastOutcomeBanner.outcome} रहा।`;
        }
      } else {
        banner.classList.add('win');
        banner.textContent = `राउंड #${data.lastOutcomeBanner.round} का नतीजा: ${data.lastOutcomeBanner.outcome}`;
      }

      setTimeout(() => banner.classList.add('hidden'), 5000);
    }
  } catch (e) {
    // ignore transient network hiccups
  }
}

pollState();
setInterval(pollState, 1000);
                          
