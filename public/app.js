/* ============================================================
   NEPSE Pulse — Dashboard Logic
   Polls prices.json + alerts.json every 60 s.
   Shows browser Notification + in-page toast on new alerts.
   ============================================================ */

const POLL_INTERVAL  = 60_000;   // 60 seconds
const DATA_PRICES    = '/data/prices.json';
const DATA_ALERTS    = '/data/alerts.json';

let lastAlertId      = null;     // track newest alert to detect changes
let notifPermission  = Notification.permission;

// ---- Entry point -------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  refresh();
  setInterval(refresh, POLL_INTERVAL);
  updateNotifButton();
});

async function refresh() {
  try {
    const [priceData, alertData] = await Promise.all([
      fetchJSON(DATA_PRICES),
      fetchJSON(DATA_ALERTS),
    ]);
    renderPrices(priceData);
    renderAlerts(alertData);
    checkForNewAlerts(alertData);
    updateLastUpdated(priceData.updated_at);
    updateMarketBadge(priceData.updated_at);
  } catch (e) {
    console.warn('[pulse] refresh failed:', e);
  }
}

async function fetchJSON(url) {
  const r = await fetch(url + '?t=' + Date.now());
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---- Render prices + portfolio cards -----------------------------------

function renderPrices(data) {
  if (!data?.stocks) return;

  const holdings = data.stocks.filter(s => s.holding > 0);
  renderPortfolioCards(holdings);
  renderWatchlist(data.stocks);
}

function renderPortfolioCards(stocks) {
  const el = document.getElementById('portfolio-cards');
  if (!stocks.length) {
    el.innerHTML = '<p class="muted">No holdings yet.</p>';
    return;
  }
  el.innerHTML = stocks.map(s => {
    const price = s.price ?? '—';
    const pnlSign = s.pnl >= 0 ? '+' : '';
    const pnlColor = s.pnl >= 0 ? 'var(--green)' : 'var(--red)';
    const priceColor = s.status_color || 'var(--text)';
    return `
    <div class="card">
      <div class="card-symbol">${s.symbol}</div>
      <div class="card-name">${s.name}</div>
      <div class="card-price" style="color:${priceColor}">${fmt(price)} NPR</div>
      ${s.pnl !== null ? `
      <div class="card-pnl" style="color:${pnlColor}">
        ${pnlSign}${fmt(s.pnl)} NPR &nbsp;(${pnlSign}${s.pnl_pct?.toFixed(1)}%)
      </div>` : ''}
      <div class="card-meta">
        ${s.holding} shares · avg ${fmt(s.avg_cost)} NPR
      </div>
      <div class="card-status" style="background:${s.status_color}22;color:${s.status_color}">
        ${s.status_label}
      </div>
    </div>`;
  }).join('');
}

function renderWatchlist(stocks) {
  const el = document.getElementById('watchlist');
  const rows = stocks.map(s => {
    const price = s.price ?? '—';
    const thStr = s.thresholds.map(t =>
      `<span title="${t.type}">${labelFor(t.type)} ${t.range}</span>`
    ).join('<br>');
    return `
    <tr>
      <td><span class="sym">${s.symbol}</span><br>
          <span class="sector-tag">${s.sector}</span></td>
      <td class="price-cell" style="color:${s.status_color}">${fmt(price)}</td>
      <td><span class="status-pill" style="background:${s.status_color}22;color:${s.status_color}">
        ${s.status_label}
      </span></td>
      <td class="hide-mobile" style="font-size:12px;line-height:1.8;color:var(--muted)">${thStr}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
  <table>
    <thead>
      <tr>
        <th>Stock</th>
        <th>Price (NPR)</th>
        <th>Status</th>
        <th class="hide-mobile">Thresholds</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ---- Render alert feed -------------------------------------------------

function renderAlerts(data) {
  const el = document.getElementById('alert-feed');
  const alerts = data?.alerts ?? [];
  if (!alerts.length) {
    el.innerHTML = '<p class="muted">No alerts yet.</p>';
    return;
  }
  el.innerHTML = alerts.slice(0, 20).map(a => `
  <div class="alert-item" style="border-left-color:${a.color}">
    <div class="alert-icon">${a.emoji}</div>
    <div class="alert-body">
      <div class="alert-title">${a.symbol} — ${a.label}</div>
      <div class="alert-sub">${fmt(a.price)} NPR · ${a.threshold}
        ${a.pct_change ? ` · ${a.pct_change > 0 ? '+' : ''}${a.pct_change}%` : ''}
      </div>
      <div class="alert-action">${a.action}</div>
    </div>
    <div class="alert-time">${timeAgo(a.timestamp)}</div>
  </div>`).join('');
}

// ---- New alert detection → Browser Notification + toast ---------------

function checkForNewAlerts(data) {
  const alerts = data?.alerts ?? [];
  if (!alerts.length) return;

  const newest = alerts[0];
  if (newest.id === lastAlertId) return;  // no change
  if (lastAlertId === null) {             // first load — just record, don't fire
    lastAlertId = newest.id;
    return;
  }

  // Find all alerts newer than the last known one
  const newAlerts = [];
  for (const a of alerts) {
    if (a.id === lastAlertId) break;
    newAlerts.push(a);
  }

  newAlerts.forEach(a => {
    showToast(a);
    sendBrowserNotif(a);
  });

  lastAlertId = newest.id;
}

function sendBrowserNotif(a) {
  if (notifPermission !== 'granted') return;
  try {
    new Notification(`${a.emoji} ${a.symbol} — ${a.label}`, {
      body: `${fmt(a.price)} NPR · ${a.action}`,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📈</text></svg>',
      tag:  a.id,
    });
  } catch (e) {
    console.warn('[pulse] notification failed:', e);
  }
}

function showToast(a) {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.borderLeftColor = a.color;
  toast.innerHTML = `
    <div class="toast-title">${a.emoji} ${a.symbol} — ${a.label}</div>
    <div class="toast-body">${fmt(a.price)} NPR · ${a.action}</div>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 8000);
}

function getToastContainer() {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    document.body.appendChild(c);
  }
  return c;
}

// ---- Notification permission -------------------------------------------

async function requestNotifPermission() {
  if (!('Notification' in window)) {
    alert('Browser notifications not supported. Use the ntfy app instead.');
    return;
  }
  const result = await Notification.requestPermission();
  notifPermission = result;
  updateNotifButton();
  if (result === 'granted') showWelcomeNotif();
}

function updateNotifButton() {
  const btn = document.getElementById('notif-btn');
  if (notifPermission === 'granted') {
    btn.textContent = '🔔 Alerts On';
    btn.classList.add('enabled');
  } else if (notifPermission === 'denied') {
    btn.textContent = '🔕 Blocked';
    btn.disabled = true;
  }
}

function showWelcomeNotif() {
  new Notification('📈 NEPSE Pulse Alerts Enabled', {
    body: "You'll receive instant notifications for buy/sell signals.",
  });
}

// ---- Helpers -----------------------------------------------------------

function updateLastUpdated(iso) {
  const el = document.getElementById('last-updated');
  el.textContent = iso ? 'Updated ' + timeAgo(iso) : '';
}

function updateMarketBadge(iso) {
  const badge = document.getElementById('market-badge');
  // Simple check: if last update was within 35 min, market likely open
  if (!iso) return;
  const diffMin = (Date.now() - new Date(iso)) / 60000;
  const isOpen  = diffMin < 35;
  badge.className = 'badge ' + (isOpen ? 'badge-open' : 'badge-closed');
  badge.textContent = isOpen ? '🟢 Market Open' : '⚫ Market Closed';
}

function timeAgo(iso) {
  const diff = Math.round((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function fmt(n) {
  if (n == null || n === '—') return '—';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function labelFor(type) {
  const m = {
    stop_loss: '⛔', full_exit: '🔴', partial_exit: '🟡',
    buy_zone: '🟢', add_zone: '🔵',
  };
  return m[type] || '•';
}
