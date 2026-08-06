# Cloud alert watcher

Runs on GitHub Actions every 5 minutes, checks whether a **closed** 4H bar finished
past one of your levels, and sends a Telegram message if it did. No server to rent,
no credit card, works whether your PC is on or not.

## Why GitHub Actions

| | |
|---|---|
| Cost | Free. Public repos get unlimited Actions minutes |
| Card required | No |
| Secrets | Encrypted, never visible in code or logs, not exposed to forks |
| State | `state.json` is committed back, so alerts don't repeat |

## Setup

### 1. Create the Telegram bot

In Telegram, message **@BotFather** → `/newbot` → follow prompts. It gives you a token
like `1234567890:AAG...`.

Then message **@userinfobot** to get your numeric chat id.

Send your new bot a `/start` — Telegram blocks bots from messaging you first.

### 2. Create a GitHub repo

On github.com, create a **new public repository**. Empty, no README.

> Public is what makes the minutes unlimited. Your token is *not* in the code —
> it lives in encrypted secrets — so a public repo does not expose it. If you would
> rather go private, that works too, but you get 2,000 minutes/month and a 5-minute
> cron will exceed it. Use a 15-minute cron on a private repo.

### 3. Push this folder

From `Trading/alerts/cloud`:

```
git init
git add .
git commit -m "alert watcher"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 4. Add the secrets

In the repo: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|---|---|
| `TELEGRAM_TOKEN` | the BotFather token |
| `TELEGRAM_CHAT_ID` | your numeric id |

Paste them into GitHub directly. They are write-only once saved — nobody, including
you, can read them back out.

### 5. Test it

**Actions** tab → **alerts** → **Run workflow**. It runs immediately. Check the log:
you should see one `ok` line per rule. To prove the Telegram path works, temporarily
edit a level in `config.json` to something price is already past, run it, confirm the
message arrives, then set it back.

## Changing levels

Edit `config.json`, commit, push. Takes effect on the next run.

To re-arm a rule that already fired, delete its entry from `state.json` (or set the
whole file back to `{}`), commit and push.

## Caveats — read these

**Cron is best-effort.** GitHub delays scheduled runs under load, sometimes 10–15
minutes. Fine for a 4H setup where you are waiting for a retrace; useless for scalping.

**Scheduled workflows are disabled after 60 days of repository inactivity.** The
state commits count as activity, but only when an alert actually fires. If nothing
triggers for two months, the schedule silently stops. Any manual commit, or one
**Run workflow** click, resets the clock.

**Binance perps only.** Rules read `BTCUSDT` / `SUIUSDT` USDⓈ-M perpetuals. If your
chart is on `SUIUSD.P` or a spot pair, levels will sit a few ticks off.

**Bar closes are UTC.** 4H bars end at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00.

**No retry queue.** If Telegram is unreachable at the moment a run fires, state is not
marked, so the next run retries — but only while the same bar is still the most
recent closed one.
