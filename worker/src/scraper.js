/**
 * NEPSE price scraper — fetches latest traded price for a stock symbol.
 * Primary source: financialnotices.com
 * Fallback source: merolagani.com
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchFromFinancialNotices(symbol) {
  const url = `https://www.financialnotices.com/stock-nepse.php?symbol=${symbol}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, cf: { cacheTtl: 0 } });
  if (!res.ok) return null;
  const html = await res.text();

  // "NABIL was closed at RS. 543.00 on 2026-03-31"
  let m = html.match(/was\s+closed\s+at\s+RS\.\s*([\d,]+\.?\d*)/i);
  if (m) return parseFloat(m[1].replace(/,/g, ''));

  // fallback pattern: RS. <number>
  m = html.match(/RS\.\s*([\d,]+\.?\d*)/i);
  if (m) return parseFloat(m[1].replace(/,/g, ''));

  return null;
}

async function fetchFromMerolagani(symbol) {
  const url = `https://merolagani.com/CompanyDetail.aspx?symbol=${symbol}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, cf: { cacheTtl: 0 } });
  if (!res.ok) return null;
  const html = await res.text();

  // Look for LTP value in common class patterns
  for (const pattern of [
    /class="ltp[^"]*"[^>]*>\s*([\d,]+\.?\d*)/i,
    /class="[^"]*price[^"]*"[^>]*>\s*([\d,]+\.?\d*)/i,
    /"market-price"[^>]*>\s*([\d,]+\.?\d*)/i,
    /Last\s+Traded\s+Price[^<]*<[^>]+>\s*([\d,]+\.?\d*)/i,
  ]) {
    const m = html.match(pattern);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
  }

  return null;
}

/**
 * Fetch the latest price for a single symbol.
 * Returns the price as a number, or null if both sources fail.
 */
export async function fetchPrice(symbol) {
  try {
    const price = await fetchFromFinancialNotices(symbol);
    if (price !== null && price > 0) return price;
  } catch (_) {}

  try {
    const price = await fetchFromMerolagani(symbol);
    if (price !== null && price > 0) return price;
  } catch (_) {}

  return null;
}

/**
 * Fetch prices for multiple symbols concurrently (with a small delay between
 * batches to avoid hammering the source sites).
 * Returns { SYMBOL: price|null, ... }
 */
export async function fetchAllPrices(symbols) {
  const results = {};
  // Fetch in batches of 3 with a 1-second gap between batches
  for (let i = 0; i < symbols.length; i += 3) {
    const batch = symbols.slice(i, i + 3);
    const prices = await Promise.all(batch.map(s => fetchPrice(s)));
    batch.forEach((s, idx) => { results[s] = prices[idx]; });
    if (i + 3 < symbols.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return results;
}
