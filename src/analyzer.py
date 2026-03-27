"""
Compares current prices against configured thresholds and detects
rapid price movements. Returns a list of Alert objects.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from config import STOCKS, RAPID_MOVE_THRESHOLD_PCT


# -------------------------------------------------------------------
# Alert types and their display metadata
# -------------------------------------------------------------------

ALERT_META = {
    "stop_loss":     {"emoji": "⛔", "label": "STOP LOSS HIT",   "priority": "urgent",  "color": "#dc2626"},
    "full_exit":     {"emoji": "🔴", "label": "SELL ALL",         "priority": "high",    "color": "#ef4444"},
    "partial_exit":  {"emoji": "🟡", "label": "SELL HALF",        "priority": "high",    "color": "#f59e0b"},
    "buy_zone":      {"emoji": "🟢", "label": "BUY NOW",          "priority": "high",    "color": "#22c55e"},
    "add_zone":      {"emoji": "🔵", "label": "BUY MORE",         "priority": "default", "color": "#3b82f6"},
    "rapid_up":      {"emoji": "⚡", "label": "RAPID RISE",       "priority": "default", "color": "#a855f7"},
    "rapid_down":    {"emoji": "⚡", "label": "RAPID DROP",       "priority": "default", "color": "#f97316"},
    "daily_digest":  {"emoji": "📊", "label": "DAILY DIGEST",     "priority": "low",     "color": "#6b7280"},
}


@dataclass
class Alert:
    symbol:      str
    name:        str
    alert_type:  str          # key into ALERT_META
    current_price: float
    threshold:   str          # human-readable threshold description
    action:      str          # what the user should do
    timestamp:   str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    pct_change:  Optional[float] = None  # for rapid move alerts


def _in_zone(price: float, zone) -> bool:
    """Check if price is within a threshold zone (tuple) or at/below a single value."""
    if isinstance(zone, tuple):
        return zone[0] <= price <= zone[1]
    return price <= zone  # for stop_loss: price AT or BELOW the level


def _crossed_into(price: float, prev_price: float | None, zone) -> bool:
    """True only when price just entered the zone (wasn't there before)."""
    if prev_price is None:
        return _in_zone(price, zone)
    was_in = _in_zone(prev_price, zone)
    now_in = _in_zone(price, zone)
    return now_in and not was_in


def analyze(
    prices: dict[str, float | None],
    state: dict,
) -> list[Alert]:
    """
    Compare fresh prices against thresholds and previous state.
    Returns only NEW alerts (deduplication via state['active_alerts']).
    """
    alerts = []
    now = datetime.now(timezone.utc).isoformat()

    for symbol, cfg in STOCKS.items():
        price = prices.get(symbol)
        if price is None:
            continue

        prev_price = state.get("prices", {}).get(symbol)
        active    = state.get("active_alerts", {}).get(symbol, [])
        thresholds = cfg["thresholds"]

        # --- Threshold alerts ---
        for alert_type, zone in thresholds.items():
            in_now  = _in_zone(price, zone)
            in_prev = _in_zone(prev_price, zone) if prev_price else False

            # Entered zone fresh
            if in_now and not in_prev and alert_type not in active:
                if alert_type == "stop_loss":
                    action = "Sell ALL shares immediately to cut losses."
                elif alert_type == "full_exit":
                    action = "Sell your remaining shares and lock in profits."
                elif alert_type == "partial_exit":
                    action = "Sell ~50% of your shares and keep the rest."
                elif alert_type == "buy_zone":
                    action = "Good entry point — consider buying."
                elif alert_type == "add_zone":
                    action = "Price is lower — consider buying more to reduce avg cost."
                else:
                    action = "Review your position."

                alerts.append(Alert(
                    symbol=symbol,
                    name=cfg["name"],
                    alert_type=alert_type,
                    current_price=price,
                    threshold=_describe_zone(zone),
                    action=action,
                    timestamp=now,
                ))

            # Exited zone — remove from active so it can re-trigger later
            if not in_now and in_prev and alert_type in active:
                active.remove(alert_type)

        # --- Rapid movement alert ---
        if prev_price and prev_price > 0:
            pct = ((price - prev_price) / prev_price) * 100
            if abs(pct) >= RAPID_MOVE_THRESHOLD_PCT:
                direction = "rapid_up" if pct > 0 else "rapid_down"
                if direction not in active:
                    action = (
                        "Sharp rise — check if a threshold is near."
                        if pct > 0
                        else "Sharp drop — check if stop loss is close."
                    )
                    alerts.append(Alert(
                        symbol=symbol,
                        name=cfg["name"],
                        alert_type=direction,
                        current_price=price,
                        threshold=f"±{RAPID_MOVE_THRESHOLD_PCT}% move",
                        action=action,
                        timestamp=now,
                        pct_change=round(pct, 2),
                    ))

    return alerts


def build_daily_digest(prices: dict[str, float | None]) -> list[Alert]:
    """Build one summary alert per stock for the end-of-day digest email."""
    alerts = []
    now = datetime.now(timezone.utc).isoformat()

    for symbol, cfg in STOCKS.items():
        price = prices.get(symbol)
        if price is None:
            continue

        status = _describe_position(symbol, price, cfg)
        alerts.append(Alert(
            symbol=symbol,
            name=cfg["name"],
            alert_type="daily_digest",
            current_price=price,
            threshold=status["nearest_zone"],
            action=status["recommendation"],
            timestamp=now,
        ))

    return alerts


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------

def _describe_zone(zone) -> str:
    if isinstance(zone, tuple):
        return f"{zone[0]}–{zone[1]} NPR"
    return f"{zone} NPR"


def _describe_position(symbol: str, price: float, cfg: dict) -> dict:
    """Return nearest zone and a plain-English recommendation."""
    thresholds = cfg["thresholds"]
    holding    = cfg.get("holding", 0)
    avg_cost   = cfg.get("avg_buy_price")

    # Find which zone the price is closest to
    nearest = "No active threshold triggered"
    recommendation = "Monitor — no action needed."

    if "stop_loss" in thresholds and price <= thresholds["stop_loss"]:
        nearest = f"⛔ BELOW stop loss ({thresholds['stop_loss']} NPR)"
        recommendation = "SELL immediately — stop loss breached."
    elif "full_exit" in thresholds and _in_zone(price, thresholds["full_exit"]):
        nearest = f"🔴 Full exit zone ({_describe_zone(thresholds['full_exit'])})"
        recommendation = "Sell remaining shares."
    elif "partial_exit" in thresholds and _in_zone(price, thresholds["partial_exit"]):
        nearest = f"🟡 Partial exit zone ({_describe_zone(thresholds['partial_exit'])})"
        recommendation = "Sell ~50% of shares."
    elif "buy_zone" in thresholds and _in_zone(price, thresholds["buy_zone"]):
        nearest = f"🟢 Buy zone ({_describe_zone(thresholds['buy_zone'])})"
        recommendation = "Good entry point — consider buying."
    elif "add_zone" in thresholds and _in_zone(price, thresholds["add_zone"]):
        nearest = f"🔵 Add zone ({_describe_zone(thresholds['add_zone'])})"
        recommendation = "Buy more to lower average cost."

    result = {"nearest_zone": nearest, "recommendation": recommendation}

    if holding > 0 and avg_cost:
        pnl = (price - avg_cost) * holding
        pct = ((price - avg_cost) / avg_cost) * 100
        result["pnl_summary"] = (
            f"{holding} shares @ avg {avg_cost} NPR | "
            f"Current: {price} NPR | "
            f"P&L: {'+'  if pnl >= 0 else ''}{pnl:,.0f} NPR ({pct:+.1f}%)"
        )

    return result
