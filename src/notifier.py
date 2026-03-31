"""
Sends alerts via:
  1. Resend.com  — formatted HTML email
  2. Telegram    — instant push notification via bot
"""

import json
import requests
from analyzer import Alert, ALERT_META
from config import (
    RESEND_API_KEY, ALERT_EMAIL_TO, ALERT_EMAIL_FROM,
    TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, STOCKS,
)


# -------------------------------------------------------------------
# Email via Resend.com
# -------------------------------------------------------------------

def send_email(alerts: list[Alert], is_digest: bool = False) -> bool:
    if not RESEND_API_KEY:
        print("[notifier] RESEND_API_KEY not set — skipping email.")
        return False

    subject = (
        "📊 NEPSE Pulse — Daily Market Digest"
        if is_digest
        else _email_subject(alerts)
    )
    html = _build_html(alerts, is_digest)

    payload = {
        "from":    ALERT_EMAIL_FROM,
        "to":      [ALERT_EMAIL_TO],
        "subject": subject,
        "html":    html,
    }
    try:
        r = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type":  "application/json",
            },
            json=payload,
            timeout=15,
        )
        r.raise_for_status()
        print(f"[notifier] Email sent: {subject}")
        return True
    except Exception as e:
        print(f"[notifier] Email failed: {e}")
        return False


def _email_subject(alerts: list[Alert]) -> str:
    if len(alerts) == 1:
        a = alerts[0]
        meta = ALERT_META[a.alert_type]
        return f"{meta['emoji']} NEPSE Pulse — {a.symbol} {meta['label']}"
    types = ", ".join({ALERT_META[a.alert_type]["label"] for a in alerts})
    return f"⚡ NEPSE Pulse — {len(alerts)} Alerts: {types}"


def _build_html(alerts: list[Alert], is_digest: bool) -> str:
    rows = ""
    for a in alerts:
        meta   = ALERT_META[a.alert_type]
        color  = meta["color"]
        label  = meta["label"]
        emoji  = meta["emoji"]
        cfg    = STOCKS.get(a.symbol, {})
        holding = cfg.get("holding", 0)
        avg_cost = cfg.get("avg_buy_price")

        pnl_row = ""
        if holding > 0 and avg_cost:
            pnl = (a.current_price - avg_cost) * holding
            pct = ((a.current_price - avg_cost) / avg_cost) * 100
            sign = "+" if pnl >= 0 else ""
            pnl_color = "#22c55e" if pnl >= 0 else "#ef4444"
            pnl_row = f"""
            <tr>
              <td style="padding:4px 0;color:#9ca3af;font-size:13px;">Your P&amp;L</td>
              <td style="padding:4px 0;font-weight:600;color:{pnl_color};">
                {sign}{pnl:,.0f} NPR ({pct:+.1f}%) on {holding} shares
              </td>
            </tr>"""

        pct_row = ""
        if a.pct_change is not None:
            pc = a.pct_change
            pct_row = f"""
            <tr>
              <td style="padding:4px 0;color:#9ca3af;font-size:13px;">Move</td>
              <td style="padding:4px 0;font-weight:600;">{"+" if pc > 0 else ""}{pc}% this cycle</td>
            </tr>"""

        rows += f"""
        <div style="background:#1f2937;border-radius:12px;padding:20px;margin-bottom:16px;
                    border-left:4px solid {color};">
          <div style="display:flex;align-items:center;margin-bottom:12px;">
            <span style="font-size:24px;margin-right:10px;">{emoji}</span>
            <div>
              <div style="font-size:18px;font-weight:700;color:#f9fafb;">
                {a.symbol} — {label}
              </div>
              <div style="font-size:13px;color:#9ca3af;">{a.name}</div>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:4px 0;color:#9ca3af;font-size:13px;width:120px;">Current Price</td>
              <td style="padding:4px 0;font-weight:700;font-size:16px;color:{color};">
                {a.current_price:,.2f} NPR
              </td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#9ca3af;font-size:13px;">Threshold</td>
              <td style="padding:4px 0;">{a.threshold}</td>
            </tr>
            {pnl_row}
            {pct_row}
            <tr>
              <td style="padding:4px 0;color:#9ca3af;font-size:13px;">Action</td>
              <td style="padding:4px 0;font-weight:600;color:#fbbf24;">{a.action}</td>
            </tr>
          </table>
        </div>"""

    title = "Daily Market Digest" if is_digest else "Stock Alert"
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#111827;font-family:'Segoe UI',Arial,sans-serif;color:#f9fafb;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="margin:0;font-size:22px;color:#f9fafb;">📈 NEPSE Pulse</h1>
      <p style="margin:4px 0 0;color:#6b7280;font-size:14px;">{title} — Nepal Stock Monitor</p>
    </div>
    {rows}
    <div style="text-align:center;margin-top:24px;color:#4b5563;font-size:12px;">
      <p>View live dashboard → <a href="https://stock.bishalstha.info.np"
         style="color:#6b7280;">stock.bishalstha.info.np</a></p>
      <p>NEPSE Pulse • Data from NEPSE public sources • Not financial advice</p>
    </div>
  </div>
</body>
</html>"""


# -------------------------------------------------------------------
# Telegram push notification
# -------------------------------------------------------------------

def send_telegram(alert: Alert) -> bool:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("[notifier] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping Telegram.")
        return False

    meta = ALERT_META[alert.alert_type]
    cfg = STOCKS.get(alert.symbol, {})
    holding = cfg.get("holding", 0)
    avg_cost = cfg.get("avg_buy_price")

    lines = [
        f"{meta['emoji']} <b>{alert.symbol} — {meta['label']}</b>",
        f"<i>{alert.name}</i>",
        "",
        f"💰 Price: <b>{alert.current_price:,.2f} NPR</b>",
        f"🎯 Zone: {alert.threshold}",
    ]

    if alert.pct_change is not None:
        sign = "+" if alert.pct_change > 0 else ""
        lines.append(f"⚡ Move: {sign}{alert.pct_change:.1f}% this cycle")

    if holding > 0 and avg_cost:
        pnl = (alert.current_price - avg_cost) * holding
        pct = ((alert.current_price - avg_cost) / avg_cost) * 100
        sign = "+" if pnl >= 0 else ""
        lines.append(f"📊 P&amp;L: {sign}{pnl:,.0f} NPR ({pct:+.1f}%) on {holding} shares")

    lines += ["", f"👉 <b>{alert.action}</b>"]

    text = "\n".join(lines)
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
        r.raise_for_status()
        print(f"[notifier] Telegram sent: {alert.symbol} {meta['label']}")
        return True
    except Exception as e:
        print(f"[notifier] Telegram failed: {e}")
        return False


def send_telegram_digest(alerts: list[Alert]) -> bool:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("[notifier] Telegram not configured — skipping digest.")
        return False

    lines = ["📊 <b>NEPSE Pulse — Daily Digest</b>", ""]
    for a in alerts:
        meta = ALERT_META[a.alert_type]
        cfg = STOCKS.get(a.symbol, {})
        holding = cfg.get("holding", 0)
        avg_cost = cfg.get("avg_buy_price")

        line = f"{meta['emoji']} <b>{a.symbol}</b> — {a.current_price:,.2f} NPR | {meta['label']}"
        if holding > 0 and avg_cost:
            pnl = (a.current_price - avg_cost) * holding
            sign = "+" if pnl >= 0 else ""
            line += f" | P&amp;L: {sign}{pnl:,.0f} NPR"
        lines.append(line)

    lines += ["", "View dashboard: stock.bishalstha.info.np"]
    text = "\n".join(lines)
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
        r.raise_for_status()
        print("[notifier] Telegram digest sent.")
        return True
    except Exception as e:
        print(f"[notifier] Telegram digest failed: {e}")
        return False


# -------------------------------------------------------------------
# Dispatch: send both email + push for each alert
# -------------------------------------------------------------------

def dispatch(alerts: list[Alert], is_digest: bool = False) -> None:
    if not alerts:
        return

    # Always send email (batch all alerts into one email)
    send_email(alerts, is_digest=is_digest)

    # Send Telegram notifications
    if is_digest:
        send_telegram_digest(alerts)
    else:
        for alert in alerts:
            send_telegram(alert)
