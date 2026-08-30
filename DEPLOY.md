# Going live

Turning Marketing HQ into a real service: your own URL, on your phone, running
its nightly job, and updating itself whenever a change is pushed.

**This is a browser job.** No terminal. The app builds its own database schema on
first boot, so there is nothing to run by hand — not now, and not when the schema
changes later.

About 30 minutes, once. Three accounts: Turso (database), Vercel (hosting),
Anthropic (the brain).

---

## Step 1 — The database (Turso, ~5 min)

Vercel wipes its filesystem between requests, so the database has to live
somewhere else. Turso is SQLite hosted — the same engine the app already uses —
and the free tier is far bigger than this will ever need.

**Check Vercel first.** In your project, open **Storage**. If Turso appears in
the marketplace list, connecting it there creates the database *and* sets the
variables for you — no copying, and no chance of a paste error. If it is there,
use it and skip to Step 4.

Otherwise, do it directly:

1. Go to **[turso.tech](https://turso.tech)** → sign up (GitHub login is fine)
2. Create a database — name it `marketinghq`, take the region nearest you
3. Open the database and copy two things:
   - the **database URL**. It starts `libsql://` — if what you copied doesn't,
     you have the wrong string
   - an **auth token**, from the button that creates one. Read & write.

Paste both somewhere temporary; they go into Vercel in Step 3. The token is
usually shown once.

Without these two the app has no database at all, and every page will show an
error however green the build was.

That is the entire database setup. You will never run a migration by hand — the
app applies its own on boot.

---

## Step 2 — The brain's API key (~2 min)

1. Go to **[console.anthropic.com](https://console.anthropic.com)** → sign up
2. Add a little credit (there is no free tier; $5 goes a long way here)
3. **API keys** → create one → copy it (starts `sk-ant-`)

Skippable. Without it everything works except the chat, the report drafter, the
written daily brief, and import — those fall back or switch off cleanly.

---

## Step 3 — Deploy (Vercel, ~10 min)

1. Go to **[vercel.com](https://vercel.com)** → sign up **with GitHub**
2. **Add New… → Project**
3. Find **`marketinghq`** in the list → **Import**
   - If it isn't listed, click *Adjust GitHub App Permissions* and give Vercel
     access to that repository
4. Leave every build setting alone — Vercel detects Next.js correctly
5. **Environment Variables — before you click Deploy.**

   On the import screen there is a collapsed section called **Environment
   Variables**. Click to expand it and add them there. It is easy to miss, and
   the Deploy button sits right below it.

   *Added them afterwards, or missed them?* No harm done. Go to your project →
   **Settings → Environment Variables**, add them there, then **Deployments** →
   the latest one → **⋯ → Redeploy**. A deployment reads these at build and run
   time, so it needs a redeploy to pick up new ones. There is no way to get this
   permanently wrong.

   Add each as Name and Value, leaving all three environments ticked:

   | Name | Value |
   |---|---|
   | `TURSO_DATABASE_URL` | the `libsql://…` URL from Step 1 |
   | `TURSO_AUTH_TOKEN` | the token from Step 1 |
   | `AUTH_SECRET` | your generated passcode — this is what you log in with |
   | `ENCRYPTION_KEY` | your generated key |
   | `CRON_SECRET` | your generated secret |
   | `MCP_TOKEN` | your generated token |
   | `ANTHROPIC_API_KEY` | from Step 2 (skip if you skipped it) |
   | `OWNER_EMAIL` | your email address |
   | `APP_URL` | leave this out for now — Step 4 |

6. **Deploy**, and wait a couple of minutes

You'll get a URL like `marketinghq-abc123.vercel.app`. Open it. You should be
asked for a passcode — that's `AUTH_SECRET`. Sign in and you'll find it empty and
waiting, with its schema already built.

### If the deploy fails

Two different failures, two different places to look:

**"Build Failed"** — it never got as far as running. The red box on the
deployment page names the reason. This is a problem with the code, not with
anything you did: **copy the message and send it to me.** I fix it, push, and
Vercel rebuilds by itself.

> **After I push a fix, do not press Redeploy.** Redeploy rebuilds *the same
> commit* — the broken one — so you get the identical error and it looks like
> the fix did nothing. My push starts a new deployment on its own; wait about a
> minute and look at the **newest** entry in the Deployments list.
>
> **How to tell them apart:** each deployment shows the commit message it was
> built from, under Source. If it still shows the old message, you are looking
> at the old build. Redeploy is the right button for picking up new environment
> variables, and the wrong one for picking up new code.

**It deployed but pages error** — it is running but cannot reach the database.
Project → **Logs**, and look for a line starting `[marketinghq]`. It is almost
always a mistyped Turso URL or token. Fix the variable, then **Redeploy**.

Neither one can damage anything. A failed deploy simply leaves the previous
version serving, and on a first deploy there is nothing to lose. Redeploying is
always safe.

---

## Step 4 — Lock in the address

Some things (signing in with Google, the OAuth connections) need the app to know
its own address.

1. In Vercel: **Settings → Environment Variables**
2. Add `APP_URL` = your full URL **with `https://` and no trailing slash**,
   e.g. `https://marketinghq-abc123.vercel.app`
3. **Deployments** → the latest one → **⋯ → Redeploy**

**A custom domain is worth it** if you have a spare one — `hq.yourdomain.com`
reads better and, more usefully, never changes. Every OAuth connection you set up
is tied to this address, so changing it later means re-registering all of them.
Vercel → **Settings → Domains**. Do it now if you're going to do it at all, then
set `APP_URL` to the custom domain instead.

---

## Step 5 — Put it on your phone

Open the URL in Safari on your iPhone → **Share** → **Add to Home Screen**.

It launches without browser chrome, keeps you signed in for 30 days, and uses the
bottom tab bar. On Android, Chrome offers to install it.

---

## Step 6 — Make it yours

In the app:

1. **Settings → Clients.** Add your real clients. Fill in **email domains** — it
   is what files mail and meetings automatically — and add **stakeholders** with a
   contact cadence. The cadence is the field everyone skips and then regrets; it
   is what powers "Anna hasn't heard from you in 19 days".
2. **Reports → New cadence**, one per client. Fill in the *template* field
   properly — it is handed to the drafter, so "lead with cost per opportunity,
   not cost per lead" genuinely changes what gets written.
3. **Brain → Import.** Point it at what you already have. Do it per client — the
   review step is where the quality comes from, and it's easier to judge when
   everything on screen is about one account.
4. **Settings → Connections**, when you're ready. Each one is independent; see
   SETUP.md for the credentials. The nightly job is already scheduled and starts
   working the moment anything is connected.

---

## How updates work from here

This is the part that makes it a service rather than a project.

Vercel is watching the GitHub repository. **When a change is pushed, Vercel
rebuilds and deploys it automatically** — usually within two minutes. You refresh
the page.

So when you ask me for a new feature: I push, it appears. No downloading, no
terminal, no migration step even when the database structure changes. Your data
stays where it is.

If you ever want to see a change before it goes live, Vercel builds a separate
preview URL for every branch — ask me to put the work on a branch instead.

---

## What it costs

| | |
|---|---|
| Vercel | free (Hobby) |
| Turso | free tier, far beyond what this needs |
| Anthropic | usage-based — a brief is a fraction of a cent, a report draft a few cents |

A few dollars a month unless you talk to the brain constantly.

---

## Keeping it safe

- **`AUTH_SECRET` is the only thing between the internet and your client data.**
  Treat it like a password — it belongs in a password manager, not a note.
- **`ENCRYPTION_KEY` must not change** once accounts are connected: the stored
  tokens are encrypted with it, and rotating it means reconnecting everything.
- Back up before anything major: Turso's dashboard does this, or ask me.
- The repository is currently **public**. That exposes the code, never your data
  or your keys — but it costs nothing to switch it to private in GitHub →
  Settings → General → Danger Zone.
