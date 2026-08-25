# Marketing HQ

A single private workspace for an independent marketing consultant / fractional CMO:
client work, marketing data, captured thinking, and a system that tells you what
needs to happen next instead of waiting to be asked.

It runs on your own infrastructure, holds your own data, and costs a few dollars
a month to operate.

---

## What it does

**Today** — the page you open in the morning. A written two-line orientation, how
much of the day is already booked, what is overdue, and a ranked feed of things
the system noticed. Every item has an action attached: mark done, draft the
report, chase the person, add the next step.

**The proactive engine** — eleven rules that run nightly against your real data
and raise a *signal* when something needs you:

| Rule | Fires when |
|---|---|
| `report_due` | A client report is approaching or already late |
| `task_overdue` | An open task passed its due date |
| `task_stalled` | Something is "in progress" or "waiting" and hasn't moved in a week |
| `project_no_next_action` | An active project has nothing open on it |
| `project_deadline_risk` | The deadline is closer than the work is |
| `email_awaiting_reply` | Someone asked you something two or more days ago |
| `meeting_prep` | An external meeting is coming and nothing is prepared |
| `meeting_follow_up` | A meeting happened and nothing came out of it |
| `stakeholder_quiet` | A relationship you set a cadence for has gone cold |
| `metric_shift` | Spend, conversions or cost per conversion moved 20%+ week over week |
| `insight_drought` | An active client you have captured nothing about in a month |

Signals are deduped, scored, and get slightly more insistent the longer they
survive. You can act on them, snooze them, or dismiss them — and one that stops
firing resolves itself.

**Projects and tasks** — projects with goals, health, milestones on a timeline,
and progress derived from the tasks rather than typed in. Tasks work across
projects and clients, bucketed by when they actually need attention. Quick
capture parses `!1` priority, `@client`, `#project` and `^fri` inline.

**Import** — the on-ramp. Paste a pile of old notes, or hand it markdown, Word
documents and PDFs, and Claude reads them, pulls out what will still matter in a
year, and proposes tagged entries with the client already matched and a quoted
snippet from the source so you can check it. You review, edit and drop before
anything is saved. It deliberately refuses to extract action items, status
updates and generic advice — a brain full of noise is worse than an empty one.

**The brain** — a chat that answers from *your* record, not the open web. It has
tools to search everything you've captured, read your tasks and projects, pull
the marketing numbers, check your calendar, and load a full client brief. It can
also write back: capture an insight, add a task. Alongside it is the library —
every insight, learning, benchmark, decision and meeting note you've filed,
searchable and filterable.

**Insights** — GA4, Meta, LinkedIn and Google Ads in one view, per client, with
period-over-period movement and the anomalies the engine flagged.

**Reports** — a cadence per client (weekly, biweekly, monthly, quarterly). Each
one gets queued, reminds you ahead of the deadline, and can draft itself from the
period's real numbers, the work actually completed, and the learnings captured
in that window. Marking one sent logs contact with everyone on its distribution
list, so the stakeholder cadence stays honest.

**Connected to Claude twice over** — in-app chat, and an MCP endpoint so Claude
Desktop or Claude Code can query the same brain with the same tools.

**Mac and phone** — one responsive app, installable as a PWA. Add to Home Screen
on iOS and it behaves like a native app, with a thumb-reachable tab bar.

---

## Quick start

```bash
npm install
npm run db:push        # create the database
npm run seed           # optional: realistic demo data to look at
npm run dev            # http://localhost:3000
npm run test:import    # checks the file readers and chunking
```

That's it — no accounts, no keys, no cloud. The demo data gives you three
clients, five projects, 90 days of marketing metrics, captured insights, a
calendar and a report that is deliberately overdue, so every feature has
something to show.

When you're ready for your own data: clear the seed (`npm run db:push --force`
after deleting `data/marketinghq.db`), then add your clients in **Settings**.

Add an `ANTHROPIC_API_KEY` to turn on the brain, the report drafter, and the
written daily brief. Everything else works without it.

---

## Making it real

See **[SETUP.md](./SETUP.md)** for the full walkthrough: deploying to Vercel with
a Turso database, getting credentials for each of the four data platforms,
scheduling the nightly run, and connecting Claude Desktop to your brain over MCP.

The short version:

1. `vercel deploy`, set `AUTH_SECRET`, `ENCRYPTION_KEY`, `APP_URL`, `CRON_SECRET`
2. Point `TURSO_DATABASE_URL` at a hosted database
3. Add `ANTHROPIC_API_KEY`
4. Connect Google, Microsoft, Meta and LinkedIn from **Settings**, then map each
   GA4 property and ad account to a client in the same place
5. Open it on your phone and Add to Home Screen

Running cost is roughly: Vercel Hobby free, Turso free tier, Anthropic usage —
call it a few dollars a month unless you talk to the brain constantly.

---

## Architecture

```
src/
  app/                     Next.js App Router — every page and API route
    api/chat               streaming chat with the brain (SSE)
    api/cron               the nightly pass: sync → queue reports → run rules → write the brief
    api/mcp                MCP server, so Claude Desktop can use the same tools
    api/connect/[provider] OAuth start and callback for all four platforms
  lib/
    db/schema.ts           the whole data model in one file
    proactive/rules.ts     the eleven rules — this is where the product's opinion lives
    proactive/engine.ts    runs them, dedupes, scores, reconciles
    reporting/             cadence maths, data gathering, draft generation
    integrations/          GA4, Google Ads, Gmail, Calendar, Graph, Meta, LinkedIn
    ai/                    Anthropic client, the brain's tools, the agentic loop
    ai/import.ts           bulk import: extraction schema, prompt, chunking
    import/files.ts        reading .md / .txt / .docx, passing PDFs through
    brief.ts               the Today picture and the written headline
    metrics.ts             aggregation, comparison, formatting
  server/actions.ts        every write the UI can make
  components/              UI, with a small design system in app/globals.css
```

**Stack:** Next.js 16 (App Router, React 19), TypeScript, Tailwind v4,
Drizzle ORM over SQLite (local file in dev, Turso in production), the Anthropic
TypeScript SDK. No chart library — the sparklines are hand-rolled SVG.

**Design decisions worth knowing:**

- *SQLite everywhere.* Same driver and same SQL in dev and production. For a
  single-user workspace this is faster than Postgres and costs nothing.
- *Rules are pure reads.* A rule returns draft signals; the engine alone writes.
  That makes rules trivial to add — one function, one array entry.
- *Project progress is derived, never entered.* A number you have to maintain by
  hand is a number that lies.
- *The AI is additive, never load-bearing.* Every page works with no API key.
  The brief falls back to a computed one, the report drafter to a structured
  template built from the same data.
- *Tokens are encrypted at rest* with AES-256-GCM under `ENCRYPTION_KEY`.

---

## Adding your own proactive rule

Rules are the point of this thing, and yours will be better than mine because
you know what you keep dropping. Add a function to `src/lib/proactive/rules.ts`:

```ts
const retainerBurnRate: Rule = {
  name: "retainer_burn",
  description: "More hours logged than the retainer covers, before month end.",
  run: async ({ now }) => {
    // read whatever you need
    return [{
      key: `retainer_burn:${client.id}`,
      rule: "retainer_burn",
      severity: "important",
      title: `${client.name} is over retainer with ${daysLeft} days left`,
      body: "Either flag it now or absorb it. Flagging it now is cheaper.",
      clientId: client.id,
      actions: [{ kind: "create_task", label: "Draft the conversation", payload: { title: `Scope conversation: ${client.name}` } }],
      score: 55,
    }];
  },
};
```

Add it to the `RULES` array at the bottom of the file. That's the whole
extension point.
