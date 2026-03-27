"""
Fetches current stock prices from NEPSE data sources.
Primary:  financialnotices.com (confirmed working)
Fallback: merolagani.com
"""

import re
import time
import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}
TIMEOUT = 20


def _parse_financialnotices(symbol: str) -> float | None:
    """Scrape current price from financialnotices.com."""
    url = f"https://www.financialnotices.com/stock-nepse.php?symbol={symbol}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()

        # Pattern: "NABIL was closed at RS. 543 on 2026-03-26"
        match = re.search(
            r'closed at RS\.\s*([\d,]+(?:\.\d+)?)',
            r.text, re.IGNORECASE
        )
        if match:
            return float(match.group(1).replace(",", ""))

        # Fallback: look for price in structured data tags
        soup = BeautifulSoup(r.text, "html.parser")
        for tag in soup.find_all(string=re.compile(r'RS\.\s*[\d,]+')):
            m = re.search(r'RS\.\s*([\d,]+(?:\.\d+)?)', tag, re.IGNORECASE)
            if m:
                return float(m.group(1).replace(",", ""))
    except Exception as e:
        print(f"[scraper] financialnotices failed for {symbol}: {e}")
    return None


def _parse_merolagani(symbol: str) -> float | None:
    """Fallback: scrape last traded price from merolagani.com."""
    url = f"https://merolagani.com/CompanyDetail.aspx?symbol={symbol}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        # Merolagani shows LTP in a span with class 'ltp' or similar
        for candidate in ["ltp", "price", "market-price"]:
            el = soup.find(class_=re.compile(candidate, re.IGNORECASE))
            if el:
                m = re.search(r'[\d,]+(?:\.\d+)?', el.get_text())
                if m:
                    return float(m.group().replace(",", ""))
    except Exception as e:
        print(f"[scraper] merolagani failed for {symbol}: {e}")
    return None


def fetch_price(symbol: str) -> float | None:
    """
    Returns current LTP (Last Traded Price) for the given NEPSE symbol.
    Tries primary source first, falls back to secondary.
    """
    price = _parse_financialnotices(symbol)
    if price:
        return price

    print(f"[scraper] Primary failed for {symbol}, trying fallback...")
    time.sleep(2)
    return _parse_merolagani(symbol)


def fetch_all_prices(symbols: list[str]) -> dict[str, float | None]:
    """
    Fetches prices for all symbols with a small delay between requests
    to avoid hammering the server.
    """
    results = {}
    for i, symbol in enumerate(symbols):
        results[symbol] = fetch_price(symbol)
        print(f"[scraper] {symbol}: {results[symbol]}")
        if i < len(symbols) - 1:
            time.sleep(2)  # polite delay between requests
    return results
