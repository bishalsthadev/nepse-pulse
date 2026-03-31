/**
 * Google Gemini API client.
 * Uses gemini-2.0-flash (free tier: 15 RPM, 1M tokens/day).
 */

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

async function callGemini(prompt, apiKey) {
  const res = await fetch(`${GEMINI_API}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 150, temperature: 0.3 },
    }),
  });

  if (!res.ok) {
    console.error(`[gemini] API error: ${res.status}`);
    return null;
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
}

/**
 * Generate AI-powered threshold suggestions for a stock.
 *
 * @param {string} symbol
 * @param {string} name
 * @param {number} currentPrice
 * @param {number[]} recentPrices  last 30 prices (oldest first)
 * @param {string} apiKey
 * @returns {{ buy_zone, add_zone, partial_exit, full_exit, stop_loss } | null}
 */
export async function suggestThresholds(symbol, name, currentPrice, recentPrices, apiKey) {
  const priceList = recentPrices.slice(-30).join(', ');
  const prompt = `You are a NEPSE (Nepal Stock Exchange) analyst. A retail investor wants to set up price alerts for:
- Stock: ${symbol} (${name})
- Current price: ${currentPrice} NPR
- Recent prices (oldest to newest): ${priceList}

Suggest price alert zones. Consider the price range, volatility, and typical support/resistance levels.
Respond with ONLY valid JSON, no explanation:
{
  "buy_zone": [low, high],
  "add_zone": [low, high],
  "partial_exit": [low, high],
  "full_exit": [low, high],
  "stop_loss": number
}`;

  const text = await callGemini(prompt, apiKey);
  if (!text) return null;

  try {
    // Extract JSON even if wrapped in markdown code block
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (_) {
    return null;
  }
}

/**
 * Generate a short AI early warning sentence for an approaching threshold.
 *
 * @param {string} symbol
 * @param {number} currentPrice
 * @param {string} thresholdType  e.g. "buy_zone"
 * @param {number} thresholdVal   the target price
 * @param {number} proximityPct   how close (percentage)
 * @param {string} direction      "rising" or "falling"
 * @param {number[]} recentPrices last 5 prices
 * @param {string} apiKey
 * @returns {string | null}
 */
export async function earlyWarningText(symbol, currentPrice, thresholdType, thresholdVal, proximityPct, direction, recentPrices, apiKey) {
  const typeLabel = thresholdType.replace(/_/g, ' ');
  const trend = recentPrices.length >= 2
    ? (recentPrices[recentPrices.length - 1] > recentPrices[0] ? 'upward' : 'downward')
    : direction;

  const prompt = `Write a single concise Telegram notification sentence (max 20 words) for a NEPSE investor.
Stock ${symbol} is ${proximityPct.toFixed(1)}% away from their ${typeLabel} at ${thresholdVal} NPR.
Current price: ${currentPrice} NPR. Trend: ${trend}. Recent prices: ${recentPrices.join(', ')}.
Be direct and actionable. Do not use markdown.`;

  return callGemini(prompt, apiKey);
}
