/**
 * NEPSE stock master list + price lookup.
 */

import { Hono } from 'hono';

export const SYMBOL_LIST = [
  { symbol: 'NABIL',   name: 'Nabil Bank Ltd.',                                  sector: 'Commercial Bank' },
  { symbol: 'EBL',     name: 'Everest Bank Ltd.',                                sector: 'Commercial Bank' },
  { symbol: 'SBL',     name: 'Siddhartha Bank Ltd.',                             sector: 'Commercial Bank' },
  { symbol: 'ADBL',    name: 'Agricultural Development Bank Ltd.',               sector: 'Development Bank' },
  { symbol: 'NIMB',    name: 'Nepal Investment Mega Bank Ltd.',                  sector: 'Commercial Bank' },
  { symbol: 'NICA',    name: 'NIC Asia Bank Ltd.',                               sector: 'Commercial Bank' },
  { symbol: 'SANIMA',  name: 'Sanima Bank Ltd.',                                 sector: 'Commercial Bank' },
  { symbol: 'MEGA',    name: 'Mega Bank Nepal Ltd.',                             sector: 'Commercial Bank' },
  { symbol: 'KBL',     name: 'Kumari Bank Ltd.',                                 sector: 'Commercial Bank' },
  { symbol: 'PRVU',    name: 'Prabhu Bank Ltd.',                                 sector: 'Commercial Bank' },
  { symbol: 'GBIME',   name: 'Global IME Bank Ltd.',                             sector: 'Commercial Bank' },
  { symbol: 'SHIFL',   name: 'Shangri-la Development Bank Ltd.',                 sector: 'Development Bank' },
  { symbol: 'NMFBS',   name: 'National Laghubitta Bittiya Sanstha Ltd.',         sector: 'Microfinance' },
  { symbol: 'CBBL',    name: 'Chhimek Laghubitta Bittiya Sanstha Ltd.',         sector: 'Microfinance' },
  { symbol: 'SKBBL',   name: 'Sana Kisan Bikas Laghubitta Bittiya Sanstha Ltd.',sector: 'Microfinance' },
  { symbol: 'HIDCL',   name: 'Hydroelectricity Investment and Development Co.',  sector: 'Hydropower' },
  { symbol: 'SKHL',    name: 'Super Khudi Hydropower Ltd.',                      sector: 'Hydropower' },
  { symbol: 'NHPC',    name: 'National Hydro Power Co. Ltd.',                    sector: 'Hydropower' },
  { symbol: 'UPPER',   name: 'Upper Tamakoshi Hydropower Ltd.',                  sector: 'Hydropower' },
  { symbol: 'NLIC',    name: 'Nepal Life Insurance Co. Ltd.',                    sector: 'Life Insurance' },
  { symbol: 'ALICL',   name: 'Asian Life Insurance Co. Ltd.',                    sector: 'Life Insurance' },
  { symbol: 'LICN',    name: 'Life Insurance Corporation Nepal Ltd.',            sector: 'Life Insurance' },
  { symbol: 'PICL',    name: 'Premier Insurance Co. Nepal Ltd.',                 sector: 'Non-Life Insurance' },
  { symbol: 'NTC',     name: 'Nepal Telecom',                                    sector: 'Telecom' },
  { symbol: 'NIFRA',   name: 'Nepal Infrastructure Bank Ltd.',                   sector: 'Finance' },
  { symbol: 'RLFL',    name: 'Reliance Finance Ltd.',                            sector: 'Finance' },
  { symbol: 'GFCL',    name: 'Goodwill Finance Co. Ltd.',                        sector: 'Finance' },
  { symbol: 'CFCL',    name: 'Capital Finance Corp. Ltd.',                       sector: 'Finance' },
  { symbol: 'MFIL',    name: 'Manjushree Finance Ltd.',                          sector: 'Finance' },
  { symbol: 'BBC',     name: 'Bottlers Nepal (Balaju) Ltd.',                     sector: 'Manufacturing' },
  { symbol: 'UNL',     name: 'Unilever Nepal Ltd.',                              sector: 'Manufacturing' },
  { symbol: 'BPCL',    name: 'Bottlers Nepal Ltd. (Balaju Bottlers)',            sector: 'Manufacturing' },
  { symbol: 'CIT',     name: 'Citizen Investment Trust',                         sector: 'Others' },
  { symbol: 'NMBMF',   name: 'NMB Microfinance Bittiya Sanstha Ltd.',           sector: 'Microfinance' },
  { symbol: 'NUBL',    name: 'Nirdhan Utthan Laghubitta Bittiya Sanstha Ltd.',  sector: 'Microfinance' },
  { symbol: 'SWBBL',   name: 'Swabalamban Laghubitta Bittiya Sanstha Ltd.',     sector: 'Microfinance' },
];

// Just the symbol strings — used by the scraper
export const SYMBOLS = SYMBOL_LIST.map(s => s.symbol);

const stocks = new Hono();

// GET /api/stocks — all symbols with latest cached price
stocks.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.symbol, p.price, p.recorded_at
     FROM price_history p
     INNER JOIN (
       SELECT symbol, MAX(recorded_at) as latest FROM price_history GROUP BY symbol
     ) m ON p.symbol = m.symbol AND p.recorded_at = m.latest`
  ).all();

  const priceMap = {};
  for (const r of rows.results) priceMap[r.symbol] = { price: r.price, updatedAt: r.recorded_at };

  const result = SYMBOL_LIST.map(s => ({
    ...s,
    price: priceMap[s.symbol]?.price ?? null,
    updatedAt: priceMap[s.symbol]?.updatedAt ?? null,
  }));

  return c.json(result);
});

export default stocks;
