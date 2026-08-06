// Price sources with fallback.
//
// Binance returns HTTP 451 to US IP ranges, which is where GitHub's hosted
// runners live - so the cloud watcher cannot use it even though a home machine
// can. This tries several exchanges in order and reports which one answered.
//
// Every source is normalised to the same shape:
//   { openTime, open, high, low, close, closeTime }   oldest -> newest
// and the still-forming final bar is dropped by the caller.

const BASE = s => s.replace(/USDT$|USD$/, '');            // BTCUSDT -> BTC

// Kraken calls Bitcoin XBT; everything else keeps its ticker.
const kraken = s => (BASE(s) === 'BTC' ? 'XBT' : BASE(s)) + 'USD';
const coinbase = s => `${BASE(s)}-USD`;

const MINUTES = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240, '1d': 1440 };

export const SOURCES = [
  {
    name: 'binance-fapi',
    // Perpetuals - the exact contract the levels were derived from. Blocked from US IPs.
    url: (sym, iv) => `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${iv}&limit=4`,
    parse: j => j.map(b => ({ openTime: b[0], open: +b[1], high: +b[2], low: +b[3], close: +b[4], closeTime: b[6] })),
  },
  {
    name: 'binance-data',
    // Binance's public data-only mirror. Spot, not perps, but usually less restricted.
    url: (sym, iv) => `https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=${iv}&limit=4`,
    parse: j => j.map(b => ({ openTime: b[0], open: +b[1], high: +b[2], low: +b[3], close: +b[4], closeTime: b[6] })),
  },
  {
    name: 'kraken',
    url: (sym, iv) => `https://api.kraken.com/0/public/OHLC?pair=${kraken(sym)}&interval=${MINUTES[iv]}`,
    parse: j => {
      if (j.error?.length) throw new Error(j.error.join(','));
      const key = Object.keys(j.result).find(k => k !== 'last');
      return j.result[key].map(b => ({
        openTime: b[0] * 1000, open: +b[1], high: +b[2], low: +b[3], close: +b[4],
        closeTime: b[0] * 1000 + 60000 * 0,   // filled in by the caller from interval
      })).slice(-4);
    },
  },
  {
    name: 'coinbase',
    // Coinbase only serves these granularities. 4h is NOT among them, so this
    // source returns null for 4h rules and is skipped rather than 400ing.
    url: (sym, iv) => {
      const g = MINUTES[iv] * 60;
      return [60, 300, 900, 3600, 21600, 86400].includes(g)
        ? `https://api.exchange.coinbase.com/products/${coinbase(sym)}/candles?granularity=${g}`
        : null;
    },
    // Coinbase returns [time, low, high, open, close, volume], newest first.
    parse: j => j.slice(0, 4).reverse().map(b => ({
      openTime: b[0] * 1000, low: +b[1], high: +b[2], open: +b[3], close: +b[4], closeTime: b[0] * 1000,
    })),
  },
];

// Try each source until one answers. Returns { bars, source }.
export async function fetchBars(symbol, interval) {
  const errors = [];
  for (const src of SOURCES) {
    try {
      const url = src.url(symbol, interval);
      if (!url) { errors.push(`${src.name} interval unsupported`); continue; }
      const res = await fetch(url, {
        headers: { 'User-Agent': 'alert-watcher/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) { errors.push(`${src.name} HTTP ${res.status}`); continue; }
      let bars = src.parse(await res.json());
      if (!bars?.length) { errors.push(`${src.name} empty`); continue; }

      // Normalise closeTime where the source doesn't give one.
      const ms = MINUTES[interval] * 60000;
      bars = bars.map(b => ({ ...b, closeTime: b.closeTime > b.openTime ? b.closeTime : b.openTime + ms - 1 }));
      bars.sort((a, b) => a.openTime - b.openTime);

      // Drop any bar that has not finished yet.
      const now = Date.now();
      const closed = bars.filter(b => b.closeTime < now);
      if (!closed.length) { errors.push(`${src.name} no closed bars`); continue; }

      return { bars: closed, source: src.name };
    } catch (e) {
      errors.push(`${src.name} ${e.message}`);
    }
  }
  throw new Error(`all sources failed: ${errors.join(' | ')}`);
}
