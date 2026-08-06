// Cloud watcher - runs on GitHub Actions, sends to Telegram.
//
// Differences from the local version:
//   - credentials come from environment variables (GitHub encrypted secrets),
//     never from a file, so nothing sensitive is ever committed
//   - no desktop channel (there is no desktop)
//   - always --once: the workflow schedule provides the loop
//
// Exits 0 even when nothing fires, so a quiet run is not a red X in the UI.

import fs from 'fs';

const TOKEN   = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  console.error('TELEGRAM_TOKEN / TELEGRAM_CHAT_ID not set. Add them as repository secrets.');
  process.exit(1);
}

// Strip a UTF-8 BOM if an editor added one - JSON.parse rejects it outright.
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));

const cfg   = readJson('config.json');
const state = fs.existsSync('state.json') ? readJson('state.json') : {};

async function send(text) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) {
    // Log the status only. The token is in the URL, so the URL is never printed.
    console.error(`telegram send failed: HTTP ${res.status}`);
    return false;
  }
  return true;
}

async function closedBars(symbol, interval) {
  const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=3`);
  if (!r.ok) throw new Error(`binance HTTP ${r.status}`);
  const k = await r.json();
  return k.slice(0, -1).map(b => ({
    openTime: b[0], open: +b[1], high: +b[2], low: +b[3], close: +b[4], closeTime: b[6],
  }));
}

let changed = false;

for (const rule of cfg.rules || []) {
  try {
    const bars = await closedBars(rule.symbol, rule.interval);
    const last = bars.at(-1);
    if (!last) continue;

    const key = rule.id;
    if (state[key]?.firedAt === last.openTime) { console.log(`skip   ${key} (already handled this bar)`); continue; }
    if (state[key]?.done && !rule.repeat)      { console.log(`skip   ${key} (one-shot already fired)`); continue; }

    const hit = rule.direction === 'above' ? last.close > rule.level : last.close < rule.level;
    const wickOnly = rule.direction === 'above'
      ? last.high > rule.level && last.close <= rule.level
      : last.low  < rule.level && last.close >= rule.level;

    if (hit) {
      const when = new Date(last.closeTime).toISOString().slice(0, 16).replace('T', ' ');
      const ok = await send(
        `<b>${rule.title}</b>\n` +
        `${rule.symbol} ${rule.interval} CLOSED ${rule.direction} ${rule.level}\n` +
        `close <b>${last.close}</b>  (bar ended ${when} UTC)\n\n${rule.note || ''}`);
      if (ok) { state[key] = { firedAt: last.openTime, done: true }; changed = true; console.log(`FIRED  ${key} @ ${last.close}`); }
    } else if (wickOnly && rule.notify_wick) {
      const ok = await send(
        `<b>${rule.title} - WICK ONLY</b>\n` +
        `${rule.symbol} ${rule.interval} pierced ${rule.level} but closed back at ${last.close}\n\n` +
        `Not confirmation - this is a sweep in the opposite direction.`);
      if (ok) { state[key] = { ...(state[key] || {}), firedAt: last.openTime }; changed = true; console.log(`wick   ${key} @ ${last.close}`); }
    } else {
      console.log(`ok     ${key} close ${last.close} (level ${rule.level})`);
    }
  } catch (e) {
    console.error(`${rule.id}: ${e.message}`);
  }
}

if (changed) fs.writeFileSync('state.json', JSON.stringify(state, null, 2) + '\n');
console.log(changed ? 'state changed' : 'no state change');
