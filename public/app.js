/* ============================================================
   NEPSE Pulse — Multi-user SPA
   Auth + Dashboard + Add Stock + Settings
   All data from Cloudflare Workers API (JWT auth)
   ============================================================ */

const API = 'https://nepse-pulse.bishalkumar45657.workers.dev';
const POLL_MS = 60_000;

// ── State ────────────────────────────────────────────────────
let token    = localStorage.getItem('np_token');
let username = localStorage.getItem('np_user');
let watchlistData  = [];
let alertsData     = [];
let allStocks      = [];
let lastAlertId    = null;
let pollTimer      = null;
let currentSymbol  = null;   // for the add modal

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    showApp();
  } else {
    showAuth();
  }
  bindStaticEvents();
});

// ── Auth screen ───────────────────────────────────────────────
function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('settings-username').textContent = username ?? '';
  loadUserProfile();
  navigateTo('dashboard');
  startPolling();
}

function startPolling() {
  clearInterval(pollTimer);
  refreshDashboard();
  pollTimer = setInterval(refreshDashboard, POLL_MS);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

// ── API helper ────────────────────────────────────────────────
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const data = await res.json();
  if (res.status === 401) { logout(); return null; }
  return { ok: res.ok, status: res.status, data };
}

// ── Navigation ────────────────────────────────────────────────
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.remove('hidden');
  document.querySelector(`.nav-btn[data-page="${page}"]`)?.classList.add('active');

  if (page === 'add') loadAllStocks();
  if (page === 'settings') loadUserProfile();
}

// ── Dashboard ─────────────────────────────────────────────────
async function refreshDashboard() {
  const [wl, al] = await Promise.all([
    api('/api/watchlist'),
    api('/api/alerts'),
  ]);
  if (!wl || !al) return;

  watchlistData = wl.data ?? [];
  alertsData    = al.data ?? [];

  renderPortfolio();
  renderWatchlistTable();
  renderAlertFeed();
  checkNewAlerts();
  updateMarketBadge();
  document.getElementById('last-updated-time').textContent = new Date().toLocaleTimeString();
}

function renderPortfolio() {
  const holdings = watchlistData.filter(s => s.holding > 0);
  const el = document.getElementById('portfolio-cards');
  if (!holdings.length) {
    el.innerHTML = '<p class="muted">No holdings yet. Add a stock and set your shares held.</p>';
    return;
  }
  el.innerHTML = holdings.map(s => {
    const priceColor = statusColor(s.activeAlerts);
    const pnlColor = s.pnl?.amount >= 0 ? 'var(--green)' : 'var(--red)';
    const sign = s.pnl?.amount >= 0 ? '+' : '';
    return `
    <div class="card">
      <div class="card-symbol">${s.symbol}</div>
      <div class="card-name">${s.name}</div>
      <div class="card-price" style="color:${priceColor}">${fmt(s.price)} NPR</div>
      ${s.pnl ? `<div class="card-pnl" style="color:${pnlColor}">${sign}${fmt(s.pnl.amount)} NPR &nbsp;(${sign}${s.pnl.pct.toFixed(1)}%)</div>` : ''}
      <div class="card-meta">${s.holding} shares · avg ${fmt(s.avgBuyPrice)} NPR</div>
      ${s.activeAlerts.length ? `<div class="card-status" style="background:${priceColor}22;color:${priceColor}">${activeAlertLabel(s.activeAlerts)}</div>` : ''}
    </div>`;
  }).join('');
}

function renderWatchlistTable() {
  const body = document.getElementById('watchlist-body');
  if (!watchlistData.length) {
    body.innerHTML = '<tr><td colspan="7" class="muted">No stocks in watchlist yet. Go to Add Stock.</td></tr>';
    return;
  }
  body.innerHTML = watchlistData.map(s => {
    const color = statusColor(s.activeAlerts);
    const th = s.thresholds ?? {};
    const buyZone  = th.buy_zone     ? `${th.buy_zone[0]}–${th.buy_zone[1]}`         : th.add_zone ? `${th.add_zone[0]}–${th.add_zone[1]}` : '—';
    const exitZone = th.partial_exit ? `${th.partial_exit[0]}–${th.partial_exit[1]}` : '—';
    const stopLoss = th.stop_loss    ? th.stop_loss                                   : '—';
    return `
    <tr>
      <td><span class="sym">${s.symbol}</span><br><span class="sector-tag">${s.sector}</span></td>
      <td class="price-cell" style="color:${color}">${fmt(s.price)}</td>
      <td><span class="status-pill" style="background:${color}22;color:${color}">${activeAlertLabel(s.activeAlerts)}</span></td>
      <td class="hide-mobile" style="color:var(--muted);font-size:13px">${buyZone}</td>
      <td class="hide-mobile" style="color:var(--muted);font-size:13px">${exitZone}</td>
      <td class="hide-mobile" style="color:var(--muted);font-size:13px">${stopLoss}</td>
      <td><button class="btn-icon danger" onclick="removeStock('${s.symbol}')">✕</button></td>
    </tr>`;
  }).join('');
}

function renderAlertFeed() {
  const el = document.getElementById('alert-feed');
  if (!alertsData.length) { el.innerHTML = '<p class="muted">No alerts yet.</p>'; return; }
  const META = {
    stop_loss: { emoji:'⛔', color:'#dc2626', label:'STOP LOSS', action:'Sell ALL shares immediately.' },
    full_exit: { emoji:'🔴', color:'#ef4444', label:'SELL ALL',  action:'Lock in profits.' },
    partial_exit: { emoji:'🟡', color:'#f59e0b', label:'SELL HALF', action:'Sell ~50% of shares.' },
    buy_zone:  { emoji:'🟢', color:'#22c55e', label:'BUY NOW',  action:'Good entry point.' },
    add_zone:  { emoji:'🔵', color:'#3b82f6', label:'BUY MORE', action:'Reduce your average cost.' },
    rapid_up:  { emoji:'⚡', color:'#a855f7', label:'RAPID RISE',  action:'Price spiked this cycle.' },
    rapid_down:{ emoji:'⚡', color:'#f97316', label:'RAPID DROP', action:'Price dropped this cycle.' },
    daily_digest:{ emoji:'📊', color:'#6b7280', label:'DIGEST', action:'' },
  };
  el.innerHTML = alertsData.slice(0, 20).map(a => {
    const m = META[a.alert_type] ?? { emoji:'•', color:'var(--border)', label: a.alert_type, action:'' };
    return `
    <div class="alert-item" style="border-left-color:${m.color}">
      <div class="alert-icon">${m.emoji}</div>
      <div class="alert-body">
        <div class="alert-title">${a.symbol} — ${m.label}</div>
        <div class="alert-sub">${fmt(a.price)} NPR</div>
        ${a.ai_context ? `<div class="alert-ai">✨ ${a.ai_context}</div>` : ''}
        <div class="alert-action">${m.action}</div>
      </div>
      <div class="alert-time">${timeAgo(a.fired_at)}</div>
    </div>`;
  }).join('');
}

function checkNewAlerts() {
  if (!alertsData.length) return;
  const newest = alertsData[0];
  if (!newest) return;
  const id = `${newest.symbol}-${newest.alert_type}-${newest.fired_at}`;
  if (id === lastAlertId) return;
  if (lastAlertId !== null) {
    showToast(newest);
  }
  lastAlertId = id;
}

async function removeStock(symbol) {
  if (!confirm(`Remove ${symbol} from your watchlist?`)) return;
  const r = await api(`/api/watchlist/${symbol}`, { method: 'DELETE' });
  if (r?.ok) refreshDashboard();
}

// ── Add Stock page ─────────────────────────────────────────────
async function loadAllStocks() {
  if (!allStocks.length) {
    const r = await api('/api/stocks');
    if (!r?.ok) return;
    allStocks = r.data ?? [];
  }
  renderStockResults(allStocks);
  document.getElementById('stock-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = q ? allStocks.filter(s =>
      s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    ) : allStocks;
    renderStockResults(filtered);
  }, { once: false });
}

function renderStockResults(stocks) {
  const inWatchlist = new Set(watchlistData.map(s => s.symbol));
  document.getElementById('stock-results').innerHTML = stocks.map(s => {
    const inWL = inWatchlist.has(s.symbol);
    return `
    <div class="stock-result-item ${inWL ? 'in-watchlist' : ''}" onclick="${inWL ? '' : `openAddModal('${s.symbol}')`}" style="${inWL ? 'opacity:0.5;cursor:default' : ''}">
      <div class="stock-result-left">
        <span class="stock-result-sym">${s.symbol}</span>
        <span class="stock-result-name">${s.name}</span>
      </div>
      <div class="stock-result-right">
        <span class="stock-result-price">${s.price ? fmt(s.price) + ' NPR' : '—'}</span>
        <span class="stock-result-sector">${s.sector}</span>
        ${inWL ? '<span style="color:var(--green);font-size:12px">✓ Added</span>' : ''}
      </div>
    </div>`;
  }).join('');
}

async function openAddModal(symbol) {
  currentSymbol = symbol;
  const stock = allStocks.find(s => s.symbol === symbol);
  document.getElementById('modal-title').textContent = `Add ${symbol}`;
  document.getElementById('modal-price').textContent = stock?.price ? `Current price: ${fmt(stock.price)} NPR` : '';
  document.getElementById('m-holding').value = 0;
  document.getElementById('m-avg').value = '';
  clearThresholdInputs();
  document.getElementById('ai-badge').classList.add('hidden');
  document.getElementById('suggest-loading').classList.remove('hidden');
  document.getElementById('add-modal').classList.remove('hidden');

  // Load AI suggestions
  const r = await api('/api/suggest', { method: 'POST', body: JSON.stringify({ symbol }) });
  document.getElementById('suggest-loading').classList.add('hidden');
  if (r?.ok && r.data?.thresholds) {
    fillThresholds(r.data.thresholds);
    document.getElementById('ai-badge').classList.remove('hidden');
    document.getElementById('ai-badge').textContent = r.data.source === 'gemini' ? '✨ AI Suggested' : '📊 Auto Suggested';
  }
}

function fillThresholds(t) {
  if (t.buy_zone)     { setVal('m-buy-lo', t.buy_zone[0]);     setVal('m-buy-hi', t.buy_zone[1]); }
  if (t.add_zone)     { setVal('m-add-lo', t.add_zone[0]);     setVal('m-add-hi', t.add_zone[1]); }
  if (t.partial_exit) { setVal('m-partial-lo', t.partial_exit[0]); setVal('m-partial-hi', t.partial_exit[1]); }
  if (t.full_exit)    { setVal('m-full-lo', t.full_exit[0]);   setVal('m-full-hi', t.full_exit[1]); }
  if (t.stop_loss)    setVal('m-stop', t.stop_loss);
}

function clearThresholdInputs() {
  ['m-buy-lo','m-buy-hi','m-add-lo','m-add-hi','m-partial-lo','m-partial-hi','m-full-lo','m-full-hi','m-stop'].forEach(id => setVal(id, ''));
}

function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val ?? ''; }
function getNum(id) { const v = document.getElementById(id)?.value; return v ? parseFloat(v) : null; }

function readThresholdsFromModal() {
  const t = {};
  const buyLo = getNum('m-buy-lo'), buyHi = getNum('m-buy-hi');
  if (buyLo && buyHi) t.buy_zone = [buyLo, buyHi];
  const addLo = getNum('m-add-lo'), addHi = getNum('m-add-hi');
  if (addLo && addHi) t.add_zone = [addLo, addHi];
  const pLo = getNum('m-partial-lo'), pHi = getNum('m-partial-hi');
  if (pLo && pHi) t.partial_exit = [pLo, pHi];
  const fLo = getNum('m-full-lo'), fHi = getNum('m-full-hi');
  if (fLo && fHi) t.full_exit = [fLo, fHi];
  const sl = getNum('m-stop');
  if (sl) t.stop_loss = sl;
  return t;
}

function closeModal() {
  document.getElementById('add-modal').classList.add('hidden');
  currentSymbol = null;
}

// ── Settings page ──────────────────────────────────────────────
async function loadUserProfile() {
  const r = await api('/api/auth/me');
  if (!r?.ok) return;
  const chatId = r.data?.telegram_chat_id ?? '';
  document.getElementById('telegram-chat-id').value = chatId;
  document.getElementById('settings-username').textContent = r.data?.username ?? username ?? '';
}

// ── Auth events ───────────────────────────────────────────────
function bindStaticEvents() {
  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
      document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
    });
  });

  // Login
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');
    const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({
      username: document.getElementById('login-username').value,
      password: document.getElementById('login-password').value,
    }) });
    if (!r) return;
    if (!r.ok) { errEl.textContent = r.data?.error ?? 'Login failed'; errEl.classList.remove('hidden'); return; }
    token = r.data.token; username = r.data.username;
    localStorage.setItem('np_token', token);
    localStorage.setItem('np_user', username);
    showApp();
  });

  // Register
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('reg-error');
    errEl.classList.add('hidden');
    const r = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({
      username: document.getElementById('reg-username').value,
      password: document.getElementById('reg-password').value,
    }) });
    if (!r) return;
    if (!r.ok) { errEl.textContent = r.data?.error ?? 'Registration failed'; errEl.classList.remove('hidden'); return; }
    token = r.data.token; username = r.data.username;
    localStorage.setItem('np_token', token);
    localStorage.setItem('np_user', username);
    showApp();
  });

  // Navigation
  document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Modal close/cancel
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('add-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

  // Modal save
  document.getElementById('modal-save').addEventListener('click', async () => {
    if (!currentSymbol) return;
    const holding   = parseInt(document.getElementById('m-holding').value) || 0;
    const avgBuyPrice = getNum('m-avg');
    const thresholds  = readThresholdsFromModal();

    const r = await api('/api/watchlist', { method: 'POST', body: JSON.stringify({ symbol: currentSymbol, holding, avgBuyPrice, thresholds }) });
    if (!r?.ok) { showToastMsg('Error', r?.data?.error ?? 'Failed to add stock'); return; }
    closeModal();
    watchlistData = [];
    allStocks = allStocks.map(s => s); // force re-render
    navigateTo('dashboard');
    refreshDashboard();
  });

  // Save Telegram
  document.getElementById('save-telegram').addEventListener('click', async () => {
    const chatId = document.getElementById('telegram-chat-id').value.trim();
    const r = await api('/api/profile', { method: 'PUT', body: JSON.stringify({ telegramChatId: chatId }) });
    const msgEl = document.getElementById('settings-msg');
    if (r?.ok) {
      msgEl.textContent = 'Saved!';
      msgEl.classList.remove('hidden');
      setTimeout(() => msgEl.classList.add('hidden'), 2000);
    } else {
      msgEl.textContent = 'Save failed.';
      msgEl.classList.remove('hidden');
    }
  });
}

function logout() {
  stopPolling();
  token = null; username = null;
  localStorage.removeItem('np_token');
  localStorage.removeItem('np_user');
  watchlistData = []; alertsData = []; lastAlertId = null;
  showAuth();
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(alert) {
  const META = {
    stop_loss: { emoji:'⛔', label:'STOP LOSS' }, full_exit: { emoji:'🔴', label:'SELL ALL' },
    partial_exit: { emoji:'🟡', label:'SELL HALF' }, buy_zone: { emoji:'🟢', label:'BUY NOW' },
    add_zone: { emoji:'🔵', label:'BUY MORE' }, rapid_up: { emoji:'⚡', label:'RAPID RISE' },
    rapid_down: { emoji:'⚡', label:'RAPID DROP' },
  };
  const m = META[alert.alert_type] ?? { emoji:'•', label: alert.alert_type };
  showToastMsg(`${m.emoji} ${alert.symbol} — ${m.label}`, `${fmt(alert.price)} NPR`);
}

function showToastMsg(title, body) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="toast-title">${title}</div><div class="toast-body">${body}</div>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

// ── Helpers ───────────────────────────────────────────────────
function updateMarketBadge() {
  const badge = document.getElementById('market-badge');
  const now = new Date();
  const day = now.getUTCDay();
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const isOpen = [0,1,2,3,4].includes(day) && mins >= 315 && mins < 555;
  badge.className = 'badge ' + (isOpen ? 'badge-open' : 'badge-closed');
  badge.textContent = isOpen ? '🟢 Market Open' : '⚫ Market Closed';
}

function statusColor(activeAlerts) {
  if (!activeAlerts?.length) return 'var(--muted)';
  if (activeAlerts.includes('stop_loss'))    return '#dc2626';
  if (activeAlerts.includes('full_exit'))    return '#ef4444';
  if (activeAlerts.includes('partial_exit')) return '#f59e0b';
  if (activeAlerts.includes('buy_zone'))     return '#22c55e';
  if (activeAlerts.includes('add_zone'))     return '#3b82f6';
  return 'var(--muted)';
}

function activeAlertLabel(activeAlerts) {
  if (!activeAlerts?.length) return 'Watching';
  const priority = ['stop_loss','full_exit','partial_exit','buy_zone','add_zone'];
  const LABELS = { stop_loss:'⛔ STOP LOSS', full_exit:'🔴 SELL ALL', partial_exit:'🟡 SELL HALF', buy_zone:'🟢 BUY NOW', add_zone:'🔵 BUY MORE' };
  for (const t of priority) if (activeAlerts.includes(t)) return LABELS[t];
  return 'Watching';
}

function timeAgo(iso) {
  const diff = Math.round((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function fmt(n) {
  if (n == null || n === '—') return '—';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
