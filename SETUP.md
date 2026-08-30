# Connecting your platforms

> **Deploying?** Start with **[DEPLOY.md](./DEPLOY.md)** — it gets you live in the
> browser in about half an hour. This document is about connecting the data
> platforms afterwards, and the credentials each one needs.

Work through it in order. Steps 1–3 take about twenty minutes; the platform
connections in step 4 are independent of each other, so do them as you need
them rather than all at once.

---

## 1. Database

Local development uses a SQLite file at `data/marketinghq.db` and needs no
setup. For a deployed app you want that database hosted — [Turso](https://turso.tech)
is the same SQLite engine over HTTP, with a free tier far larger than this app
will ever need.

```bash
brew install tursodatabase/tap/turso
turso auth login
turso db create marketinghq
turso db show marketinghq --url          # → TURSO_DATABASE_URL
turso db tokens create marketinghq       # → TURSO_AUTH_TOKEN
```

Set both in your environment, then push the schema:

```bash
TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run db:push
```

Re-run `npm run db:push` any time you change `src/lib/db/schema.ts`.

---

## 2. Deploy

```bash
npm i -g vercel
vercel deploy
```

Then set these in the Vercel project's environment variables:

| Variable | Value |
|---|---|
| `APP_URL` | Your deployment URL, exactly — `https://hq.yourdomain.com` |
| `AUTH_SECRET` | A long random string. This is your passcode. |
| `ENCRYPTION_KEY` | Another long random string. Set this **before** connecting any account. |
| `OWNER_EMAIL` | Your email |
| `CRON_SECRET` | A third random string. Vercel Cron sends it automatically. |
| `TURSO_DATABASE_URL` | From step 1 |
| `TURSO_AUTH_TOKEN` | From step 1 |
| `ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com) |

Generate secrets with `openssl rand -base64 32`.

A custom domain is worth it — you will type this URL a lot, and OAuth redirect
URIs have to be re-registered if the domain changes later.

`vercel.json` already schedules the nightly pass at 05:00 UTC. To run it
somewhere else instead, just hit the endpoint:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron
```

It is safe to run more often than daily.

---

## 3. Add your clients first

Everything else hangs off clients, so do this before connecting any data source.

In **Settings → Clients**, for each client set:

- **Email domains** (`acme.com, acme.dk`) — inbound mail and meetings from these
  domains get filed to the client automatically. This is what makes the inbox
  and calendar rules useful rather than noise.
- **Stakeholders** — name, role, email, and a *contact cadence*. The cadence is
  the one field people skip and then regret: it is what powers "Anna hasn't
  heard from you in 19 days". Tick **gets the reports** for anyone on the
  distribution list.

Once the clients exist, **Brain → Import** is the fastest way to make the thing
useful. Point it at whatever you already have — a Notion export (unzip it and
select the markdown files), old client notes, a quarterly review deck exported to
PDF — and it proposes entries for you to review. Do this per client rather than
all at once; the review step is where the quality comes from, and it is easier to
judge when everything on screen is about one account.

Then set a report cadence per client in **Reports → New cadence**. The
*template* field is worth filling in properly — it is passed to the drafter, so
"lead with cost per opportunity, not cost per lead; Anna forwards this to the
board" genuinely changes what gets written.

---

## 4. Connect the platforms

Each connection is independent. Connect what you have; the app degrades cleanly
around anything missing.

### Google — Gmail, Calendar, GA4 and Google Ads

One OAuth client covers all four.

1. [console.cloud.google.com](https://console.cloud.google.com) → new project
2. **APIs & Services → Library**, enable: Gmail API, Google Calendar API,
   Google Analytics Data API, Google Ads API
3. **OAuth consent screen** → External → add yourself as a test user. You do not
   need Google verification for a single-user app; test-user mode is fine, though
   refresh tokens expire every 7 days until you publish. Publishing to production
   without verification still works for personal use and stops that expiry.
4. **Credentials → Create OAuth client ID → Web application**
   - Authorised redirect URI: `https://your-app/api/connect/google/callback`
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
6. Connect from **Settings**

**GA4 and Google Ads need one more step.** They ride on the same connection but
need to know *which* property and account belong to *which* client. After
connecting, the Google card in Settings gains an **Accounts → clients** section:
add a row per GA4 property and per Ads account, paste the ID, pick the client,
save. One Google login can serve as many clients as you manage.

Until at least one account is mapped, those syncs write nothing — there is no
honest way to attribute the numbers.

Your GA4 property ID is in GA4 → Admin → Property Settings. Your Google Ads
customer ID is at the top right of the Ads UI.

For Google Ads you also need a **developer token** from your MCC account
(Tools → API Center), set as `GOOGLE_ADS_DEVELOPER_TOKEN`, plus
`GOOGLE_ADS_LOGIN_CUSTOMER_ID` if you access client accounts through a manager
account. A basic-access token is enough for reporting.

### Microsoft — Outlook mail and calendar

1. [entra.microsoft.com](https://entra.microsoft.com) → App registrations → New
2. Redirect URI (Web): `https://your-app/api/connect/microsoft/callback`
3. **API permissions** → Microsoft Graph → Delegated: `Mail.Read`,
   `Calendars.Read`, `User.Read`, `offline_access`
4. **Certificates & secrets** → New client secret
5. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_TENANT`
   (`common` unless you are locking it to one tenant)

### Meta Ads

1. [developers.facebook.com](https://developers.facebook.com) → Create App →
   **Business**
2. Add the **Marketing API** product
3. Redirect URI: `https://your-app/api/connect/meta/callback`
4. Permissions needed: `ads_read`, `business_management`. For your own ad
   accounts, development mode is enough — no App Review.
5. Set `META_APP_ID` and `META_APP_SECRET`
6. After connecting, map each ad account (`act_…`) to a client in the Meta card

### LinkedIn Ads

1. [linkedin.com/developers](https://www.linkedin.com/developers/) → Create app,
   linked to a Company Page you administer
2. Request the **Advertising API** product. This one takes a few days to be
   approved — start it early.
3. Redirect URI: `https://your-app/api/connect/linkedin/callback`
4. Scopes: `r_ads`, `r_ads_reporting`
5. Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`
6. After connecting, map each ad account to a client in the LinkedIn card

---

## 5. Connect Claude Desktop to your brain

The same tools the in-app chat uses are exposed over MCP, so Claude Desktop and
Claude Code can query your record directly.

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "marketing-hq": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://your-app/api/mcp",
        "--header", "Authorization: Bearer YOUR_MCP_TOKEN"
      ]
    }
  }
}
```

`YOUR_MCP_TOKEN` is `MCP_TOKEN` if you set it, otherwise `AUTH_SECRET`. Restart
Claude Desktop; you should see the Marketing HQ tools available.

For Claude Code:

```bash
claude mcp add --transport http marketing-hq https://your-app/api/mcp \
  --header "Authorization: Bearer YOUR_MCP_TOKEN"
```

---

## 6. Put it on your phone

Open the app in Safari on iOS → Share → **Add to Home Screen**. It launches
without browser chrome, keeps you signed in for 30 days, and uses the bottom tab
bar. On Android, Chrome will offer to install it.

---

## Operating notes

**The nightly pass** (`/api/cron`) does four things in order: pulls from every
connected account, queues any report that has come due, re-runs the rules and
reconciles the signal feed, and writes tomorrow's brief so Today loads instantly.
Each step is isolated — one failing provider never stops the rest. Check
**Settings → Recent syncs** to see what ran.

**When a connection breaks**, it is marked `needs_reauth` and skipped rather than
retried into a rate limit. Settings shows you the error; reconnect from there.

**Backups.** `turso db shell marketinghq .dump > backup.sql`, or just copy
`data/marketinghq.db` if you are running locally. Worth doing before any schema
change.

**Costs.** Vercel Hobby covers this. Turso's free tier covers this. Anthropic is
usage-based: the daily brief is a few hundred tokens, a report draft a few
thousand, and chat is whatever you use. Expect a few dollars a month.

**Privacy.** Your data lives in your database. The only thing that leaves it is
what you send to Anthropic when you use the brain or draft a report, and what
you pull from the platforms you connected. There is no third party in the middle.
