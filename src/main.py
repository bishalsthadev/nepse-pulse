"""
NEPSE Pulse — Main Runner
Invoked by GitHub Actions every 30 min during NEPSE trading hours.
Also invoked separately for the daily digest at market close.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from config import STOCKS, MARKET_DAYS, MARKET_OPEN_UTC_HOUR, MARKET_OPEN_UTC_MINUTE, \
    MARKET_CLOSE_UTC_HOUR, MARKET_CLOSE_UTC_MINUTE
from scraper import fetch_all_prices
from analyzer import analyze, build_daily_digest
from notifier import dispatch
from dashboard_gen import update_prices_json, append_alerts_json

STATE_FILE = Path(__file__).parent.parent / "state" / "state.json"


# -------------------------------------------------------------------
# State management
# -------------------------------------------------------------------

def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception:
            pass
    return {"prices": {}, "active_alerts": {}}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def update_state(state: dict, prices: dict, alerts) -> dict:
    # Update last known prices
    for symbol, price in prices.items():
        if price is not None:
            state.setdefault("prices", {})[symbol] = price

    # Track active alerts to prevent duplicate notifications
    for alert in alerts:
        if alert.alert_type in ("rapid_up", "rapid_down", "daily_digest"):
            continue  # don't deduplicate transient alerts
        state.setdefault("active_alerts", {}).setdefault(alert.symbol, [])
        if alert.alert_type not in state["active_alerts"][alert.symbol]:
            state["active_alerts"][alert.symbol].append(alert.alert_type)

    return state


# -------------------------------------------------------------------
# Market hours check
# -------------------------------------------------------------------

def is_market_open() -> bool:
    now = datetime.now(timezone.utc)
    if now.weekday() not in MARKET_DAYS:
        return False
    open_mins  = MARKET_OPEN_UTC_HOUR * 60 + MARKET_OPEN_UTC_MINUTE
    close_mins = MARKET_CLOSE_UTC_HOUR * 60 + MARKET_CLOSE_UTC_MINUTE
    now_mins   = now.hour * 60 + now.minute
    return open_mins <= now_mins <= close_mins


def is_digest_time() -> bool:
    """True ~15 min after market close (daily digest window)."""
    now = datetime.now(timezone.utc)
    if now.weekday() not in MARKET_DAYS:
        return False
    digest_hour   = MARKET_CLOSE_UTC_HOUR
    digest_minute = MARKET_CLOSE_UTC_MINUTE + 15  # 15 min after close
    return now.hour == digest_hour and abs(now.minute - digest_minute) <= 5


# -------------------------------------------------------------------
# Main entry points
# -------------------------------------------------------------------

def run_monitor():
    """Standard monitoring run — check prices and fire threshold alerts."""
    print(f"[main] Monitor run at {datetime.now(timezone.utc).isoformat()}")

    if not is_market_open():
        print("[main] Market is closed — skipping price check.")
        return

    state  = load_state()
    prices = fetch_all_prices(list(STOCKS.keys()))
    alerts = analyze(prices, state)

    print(f"[main] {len(alerts)} alert(s) generated.")
    for a in alerts:
        print(f"  {a.alert_type.upper()} — {a.symbol} @ {a.current_price}")

    state = update_state(state, prices, alerts)
    save_state(state)

    # Update dashboard data files
    update_prices_json(prices)
    if alerts:
        append_alerts_json(alerts)

    # Send notifications
    dispatch(alerts)


def run_digest():
    """End-of-day digest — send a summary of all watched stocks."""
    print(f"[main] Digest run at {datetime.now(timezone.utc).isoformat()}")

    state  = load_state()
    prices = fetch_all_prices(list(STOCKS.keys()))
    alerts = build_daily_digest(prices)

    state = update_state(state, prices, [])
    save_state(state)

    update_prices_json(prices)

    dispatch(alerts, is_digest=True)
    print("[main] Daily digest sent.")


# -------------------------------------------------------------------
# CLI
# -------------------------------------------------------------------

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "monitor"
    if mode == "digest":
        run_digest()
    else:
        run_monitor()
