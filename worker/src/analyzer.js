/**
 * Threshold analysis — determines which alerts to fire for a user's stock.
 * Pure logic, no I/O.
 */

export const ALERT_META = {
  stop_loss:    { emoji: '⛔', label: 'STOP LOSS HIT',  color: '#dc2626', action: 'Sell ALL shares immediately to cut losses.' },
  full_exit:    { emoji: '🔴', label: 'SELL ALL',       color: '#ef4444', action: 'Sell your remaining shares and lock in profits.' },
  partial_exit: { emoji: '🟡', label: 'SELL HALF',      color: '#f59e0b', action: 'Sell ~50% of your shares and keep the rest.' },
  buy_zone:     { emoji: '🟢', label: 'BUY NOW',        color: '#22c55e', action: 'Good entry point — consider buying.' },
  add_zone:     { emoji: '🔵', label: 'BUY MORE',       color: '#3b82f6', action: 'Price is lower — consider buying more to reduce avg cost.' },
  rapid_up:     { emoji: '⚡', label: 'RAPID RISE',     color: '#a855f7', action: 'Price spiked sharply this cycle.' },
  rapid_down:   { emoji: '⚡', label: 'RAPID DROP',     color: '#f97316', action: 'Price dropped sharply this cycle.' },
  daily_digest: { emoji: '📊', label: 'DAILY DIGEST',   color: '#6b7280', action: '' },
};

const RAPID_MOVE_PCT = 3.0;

/**
 * Check if price is inside a threshold zone.
 * zone can be [lo, hi] tuple or a single number (≤ triggers for stop_loss).
 */
function inZone(price, zone, type) {
  if (type === 'stop_loss') return price <= zone;
  if (Array.isArray(zone)) return price >= zone[0] && price <= zone[1];
  return false;
}

/**
 * Returns true if price just entered zone (wasn't there before).
 */
function crossedInto(price, zone, type, activeAlerts) {
  return inZone(price, zone, type) && !activeAlerts.includes(type);
}

/**
 * Analyze a single user's stock against their thresholds.
 *
 * @param {string}   symbol
 * @param {string}   name
 * @param {number}   price         current price
 * @param {number|null} prevPrice  price from previous cycle (for rapid move)
 * @param {object}   thresholds    { buy_zone:[lo,hi], add_zone:[lo,hi], partial_exit:[lo,hi], full_exit:[lo,hi], stop_loss:val }
 * @param {string[]} activeAlerts  alert types already active (to prevent duplicates)
 * @param {number}   holding       shares held
 * @param {number|null} avgCost    average buy price
 * @returns {{ alerts: Alert[], newActiveAlerts: string[] }}
 */
export function analyzeStock(symbol, name, price, prevPrice, thresholds, activeAlerts, holding, avgCost) {
  const alerts = [];
  let newActive = [...activeAlerts];

  // Threshold-based alerts (deduplicated)
  const thresholdTypes = ['stop_loss', 'full_exit', 'partial_exit', 'buy_zone', 'add_zone'];
  for (const type of thresholdTypes) {
    if (!thresholds[type]) continue;
    if (crossedInto(price, thresholds[type], type, newActive)) {
      alerts.push(buildAlert(symbol, name, type, price, thresholds[type], holding, avgCost, null));
      newActive.push(type);
    } else if (!inZone(price, thresholds[type], type)) {
      // Price left the zone — allow re-triggering next time
      newActive = newActive.filter(a => a !== type);
    }
  }

  // Rapid move (never deduplicated)
  if (prevPrice !== null && prevPrice > 0) {
    const pct = ((price - prevPrice) / prevPrice) * 100;
    if (Math.abs(pct) >= RAPID_MOVE_PCT) {
      const type = pct > 0 ? 'rapid_up' : 'rapid_down';
      alerts.push(buildAlert(symbol, name, type, price, null, holding, avgCost, pct));
    }
  }

  return { alerts, newActiveAlerts: newActive };
}

function buildAlert(symbol, name, type, price, threshold, holding, avgCost, pctChange) {
  const meta = ALERT_META[type];
  let thresholdDesc = '';
  if (threshold !== null) {
    if (Array.isArray(threshold)) thresholdDesc = `${threshold[0]}–${threshold[1]} NPR`;
    else thresholdDesc = `${threshold} NPR`;
  }

  let pnl = null;
  if (holding > 0 && avgCost) {
    pnl = { amount: (price - avgCost) * holding, pct: ((price - avgCost) / avgCost) * 100 };
  }

  return { symbol, name, type, price, threshold: thresholdDesc, pnl, pctChange, meta };
}

/**
 * Check how close price is to any threshold it hasn't already crossed.
 * Returns { type, threshold, proximityPct, direction } for the nearest one, or null.
 */
export function nearestApproach(price, prevPrice, thresholds, activeAlerts) {
  let nearest = null;
  let minDist = Infinity;

  for (const [type, zone] of Object.entries(thresholds)) {
    if (activeAlerts.includes(type)) continue;
    if (!zone) continue;

    let target;
    if (type === 'stop_loss') target = zone;
    else if (Array.isArray(zone)) target = price > zone[1] ? zone[1] : zone[0];
    else continue;

    const dist = Math.abs((price - target) / target) * 100;
    if (dist < minDist) {
      minDist = dist;
      const direction = price > target ? 'falling' : 'rising';
      nearest = { type, threshold: target, proximityPct: dist, direction };
    }
  }

  return nearest;
}
