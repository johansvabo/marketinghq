/**
 * Seeds a realistic working set so the app is worth looking at on first run and
 * every feature has something to show. Safe to re-run: it clears its own data
 * first. Delete this file once your real data is in.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  briefs,
  calendarEvents,
  chatMessages,
  chatThreads,
  clients,
  insights,
  messages,
  metrics,
  milestones,
  projects,
  reportRuns,
  reportSchedules,
  signals,
  stakeholders,
  tasks,
} from "../src/lib/db/schema";
import { nextDueDate, reportingPeriod } from "../src/lib/reporting/schedule";

const DAY = 86_400_000;
const now = new Date();
const day = (offset: number, hour = 9) => {
  const d = new Date(now.getTime() + offset * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function reset() {
  // Order matters only where cascades don't cover it.
  for (const table of [signals, briefs, chatMessages, chatThreads, reportRuns, reportSchedules, metrics, messages, calendarEvents, insights, milestones, tasks, stakeholders, projects, clients]) {
    await db.delete(table as never);
  }
}

async function main() {
  console.log("Clearing existing seed data…");
  await reset();

  console.log("Creating clients…");
  const [nordic, veloce, hallberg, ownBrand] = await db
    .insert(clients)
    .values([
      {
        name: "Nordic Supply",
        slug: "nordic-supply",
        color: "#6366f1",
        engagement: "retainer",
        monthlyValue: 48_000,
        emailDomains: ["nordicsupply.com"],
        notes: "B2B industrial distributor. Long sales cycle, lead gen is the whole game. CMO is data-literate and will check your maths.",
      },
      {
        name: "Veloce",
        slug: "veloce",
        color: "#ec4899",
        engagement: "retainer",
        monthlyValue: 35_000,
        emailDomains: ["veloce.dk"],
        notes: "DTC cycling apparel. Meta-heavy. Founder-led, moves fast, wants creative volume over analysis.",
      },
      {
        name: "Hallberg Legal",
        slug: "hallberg-legal",
        color: "#14b8a6",
        engagement: "advisory",
        monthlyValue: 22_000,
        emailDomains: ["hallberglegal.dk"],
        notes: "Fractional CMO days, two per month. Building the function from nothing — mostly org and positioning work, not campaigns.",
      },
      { name: "Own practice", slug: "own-practice", color: "#f59e0b", engagement: "internal", notes: "Business development and the things that never get urgent." },
    ])
    .returning();

  console.log("Creating stakeholders…");
  await db.insert(stakeholders).values([
    { clientId: nordic.id, name: "Anna Lindqvist", email: "anna@nordicsupply.com", role: "CMO", contactCadenceDays: 7, receivesReports: true, lastContactAt: day(-3) },
    { clientId: nordic.id, name: "Marcus Reed", email: "marcus@nordicsupply.com", role: "Head of Sales", contactCadenceDays: 21, receivesReports: true, lastContactAt: day(-26) },
    { clientId: veloce.id, name: "Sofie Mikkelsen", email: "sofie@veloce.dk", role: "Founder", contactCadenceDays: 7, receivesReports: true, lastContactAt: day(-2) },
    { clientId: hallberg.id, name: "Peter Hallberg", email: "peter@hallberglegal.dk", role: "Managing Partner", contactCadenceDays: 14, receivesReports: true, lastContactAt: day(-19) },
  ]);

  console.log("Creating projects…");
  const [q3Pipeline, creativeRefresh, positioning, brandSite, ownPipeline] = await db
    .insert(projects)
    .values([
      { clientId: nordic.id, name: "Q3 pipeline push", goal: "Raise paid-sourced SQLs 40% by end of quarter without letting cost per SQL climb past DKK 2,400.", status: "active", health: "at_risk", startDate: day(-52), dueDate: day(19) },
      { clientId: veloce.id, name: "Autumn creative refresh", goal: "Ship 12 new concepts and find two that beat the current control on 7-day ROAS.", status: "active", health: "on_track", startDate: day(-21), dueDate: day(12) },
      { clientId: hallberg.id, name: "Positioning & messaging", goal: "One page the whole firm agrees on: who we are for, what we are better at, and what we say no to.", status: "active", health: "on_track", startDate: day(-34), dueDate: day(26) },
      { clientId: nordic.id, name: "Site conversion audit", goal: "Find and fix the three biggest drop-offs between landing and enquiry.", status: "active", health: "off_track", startDate: day(-40), dueDate: day(-4) },
      { clientId: ownBrand.id, name: "Practice pipeline", goal: "Two qualified conversations a month without doing outbound.", status: "active", health: "on_track", startDate: day(-90) },
    ])
    .returning();

  console.log("Creating milestones…");
  await db.insert(milestones).values([
    { projectId: q3Pipeline.id, name: "New audience structure live", dueDate: day(-30), completedAt: day(-31) },
    { projectId: q3Pipeline.id, name: "Lead scoring agreed with sales", dueDate: day(-10), completedAt: day(-8) },
    { projectId: q3Pipeline.id, name: "Mid-quarter review with Anna", dueDate: day(2) },
    { projectId: q3Pipeline.id, name: "Quarter close readout", dueDate: day(19) },
    { projectId: creativeRefresh.id, name: "Concepts approved", dueDate: day(-6), completedAt: day(-6) },
    { projectId: creativeRefresh.id, name: "First batch live", dueDate: day(1) },
    { projectId: creativeRefresh.id, name: "Winner declared", dueDate: day(12) },
    { projectId: positioning.id, name: "Partner interviews done", dueDate: day(-12), completedAt: day(-11) },
    { projectId: positioning.id, name: "Draft positioning circulated", dueDate: day(5) },
    { projectId: brandSite.id, name: "Analytics audit complete", dueDate: day(-22), completedAt: day(-20) },
    { projectId: brandSite.id, name: "Fix list handed to dev", dueDate: day(-6) },
  ]);

  console.log("Creating tasks…");
  await db.insert(tasks).values([
    { projectId: q3Pipeline.id, clientId: nordic.id, title: "Rebuild the prospecting audience around the new ICP list", status: "doing", priority: 1, dueDate: day(1), lastTouchedAt: day(-1) },
    { projectId: q3Pipeline.id, clientId: nordic.id, title: "Pull cost per SQL by campaign for the mid-quarter review", status: "todo", priority: 1, dueDate: day(0) },
    { projectId: q3Pipeline.id, clientId: nordic.id, title: "Get final sign-off from Marcus on the lead definition", status: "waiting", priority: 2, dueDate: day(-5), waitingOn: "Marcus Reed", lastTouchedAt: day(-11) },
    { projectId: q3Pipeline.id, clientId: nordic.id, title: "Kill the two campaigns below 0.4% CTR", status: "todo", priority: 2, dueDate: day(-2) },
    { projectId: q3Pipeline.id, clientId: nordic.id, title: "Write the mid-quarter narrative before pulling any charts", status: "todo", priority: 2, dueDate: day(2) },
    { projectId: q3Pipeline.id, clientId: nordic.id, title: "Set up the LinkedIn conversions API properly", status: "done", priority: 3, completedAt: day(-9) },
    { projectId: q3Pipeline.id, clientId: nordic.id, title: "Agree lead scoring model with sales", status: "done", priority: 1, completedAt: day(-8) },

    { projectId: creativeRefresh.id, clientId: veloce.id, title: "Brief the editor on the six hero cuts", status: "doing", priority: 1, dueDate: day(0), lastTouchedAt: day(0) },
    { projectId: creativeRefresh.id, clientId: veloce.id, title: "Set up the creative test structure so results are readable", status: "todo", priority: 1, dueDate: day(1) },
    { projectId: creativeRefresh.id, clientId: veloce.id, title: "Ask Sofie which three products get the autumn push", status: "waiting", priority: 2, waitingOn: "Sofie Mikkelsen", dueDate: day(-1), lastTouchedAt: day(-9) },
    { projectId: creativeRefresh.id, clientId: veloce.id, title: "Storyboard the UGC concepts", status: "done", priority: 2, completedAt: day(-6) },
    { projectId: creativeRefresh.id, clientId: veloce.id, title: "Audit which of last autumn's creatives still perform", status: "done", priority: 3, completedAt: day(-13) },

    { projectId: positioning.id, clientId: hallberg.id, title: "Write the first positioning draft", status: "doing", priority: 1, dueDate: day(3), lastTouchedAt: day(-2) },
    { projectId: positioning.id, clientId: hallberg.id, title: "Send Peter the competitor teardown before Thursday", status: "todo", priority: 2, dueDate: day(2) },
    { projectId: positioning.id, clientId: hallberg.id, title: "Synthesise the six partner interviews", status: "done", priority: 1, completedAt: day(-11) },

    { projectId: brandSite.id, clientId: nordic.id, title: "Hand the fix list to their dev team", status: "todo", priority: 1, dueDate: day(-6) },
    { projectId: brandSite.id, clientId: nordic.id, title: "Re-run the funnel report once fixes ship", status: "todo", priority: 3 },

    { projectId: ownPipeline.id, clientId: ownBrand.id, title: "Write the piece on why most B2B attribution is theatre", status: "todo", priority: 3 },
    { projectId: ownPipeline.id, clientId: ownBrand.id, title: "Follow up with the fintech intro from the conference", status: "todo", priority: 2, dueDate: day(4) },
    { clientId: ownBrand.id, title: "Send September invoices", status: "todo", priority: 1, dueDate: day(3) },
    { clientId: ownBrand.id, title: "Move accounting to the new tool", status: "todo", priority: 4 },
  ]);

  console.log("Creating captured insights…");
  await db.insert(insights).values([
    {
      clientId: nordic.id,
      projectId: q3Pipeline.id,
      title: "LinkedIn leads cost 3.2x Meta but close at 4x the rate",
      body: "Ran the full quarter through their CRM rather than trusting platform conversions. LinkedIn CPL was DKK 890 against Meta at DKK 280, but 19% of LinkedIn leads reached opportunity versus 4.5% from Meta. Cost per opportunity actually favours LinkedIn: DKK 4,680 vs DKK 6,220.\n\nThe implication is that the CPL target Anna inherited is the wrong number to manage against, and every optimisation made against it has quietly been making the pipeline worse.",
      kind: "learning",
      confidence: 5,
      tags: ["paid-social", "b2b", "attribution"],
      occurredAt: day(-14),
    },
    {
      clientId: nordic.id,
      title: "Anna needs the narrative before the numbers",
      body: "Every review where I opened with the dashboard went badly. Every one where I opened with two sentences on what happened and what I'm doing about it went fine — and she asked for the numbers herself, which meant she was reading them as evidence rather than as an audit.",
      kind: "insight",
      confidence: 4,
      tags: ["client-management", "reporting"],
      occurredAt: day(-31),
    },
    {
      clientId: veloce.id,
      projectId: creativeRefresh.id,
      title: "Creative fatigue hits Veloce at roughly 2.1M impressions",
      body: "Across nine creatives over eight months, CTR falls below 60% of its launch peak somewhere between 1.9M and 2.4M impressions. Frequency is a worse predictor than raw impressions for this account.\n\nPractical version: budget one new concept for every 2M impressions of planned delivery, and start the next batch when a creative crosses 1.5M.",
      kind: "benchmark",
      confidence: 4,
      tags: ["creative", "meta", "dtc"],
      occurredAt: day(-24),
    },
    {
      clientId: veloce.id,
      title: "UGC beats studio on cold, loses on retargeting",
      body: "Consistent across three tests now. Cold prospecting: UGC wins on CTR and CPA by 25-40%. Retargeting: studio product shots convert better, likely because the buyer already knows the brand and wants to see the garment properly.\n\nStop running one creative pool across both.",
      kind: "learning",
      confidence: 4,
      tags: ["creative", "meta"],
      occurredAt: day(-40),
    },
    {
      clientId: hallberg.id,
      projectId: positioning.id,
      title: "The partners disagree about who the firm is for — and don't know it",
      body: "Six interviews. Three described the ideal client as founder-led scale-ups, two as established mid-market, one as 'whoever pays'. Every one of them believed the others agreed with them.\n\nThis is the actual project. The messaging work is downstream of getting them in a room to make one choice.",
      kind: "insight",
      confidence: 5,
      tags: ["positioning", "professional-services"],
      occurredAt: day(-11),
    },
    {
      title: "Retainer scope creep always starts with 'quick question'",
      body: "Pattern across four clients now. The scope doesn't get renegotiated, it erodes — a quick question becomes a deck becomes a workstream. The fix that worked: a standing line in the weekly note listing what I did that wasn't in scope. Not a complaint, just visible. Two clients upgraded rather than have that list keep growing.",
      kind: "learning",
      confidence: 4,
      tags: ["practice", "commercial"],
      occurredAt: day(-60),
      pinned: true,
    },
    {
      clientId: nordic.id,
      title: "Decision: report on cost per opportunity, not cost per lead",
      body: "Agreed with Anna on the 4th. Changes the mid-quarter review and every report after it. Marcus needs to keep the CRM stages clean for this to hold — that dependency is the risk.",
      kind: "decision",
      confidence: 5,
      tags: ["reporting"],
      occurredAt: day(-13),
    },
  ]);

  console.log("Creating calendar and mail…");
  await db.insert(calendarEvents).values([
    { provider: "google", externalId: "seed-1", clientId: nordic.id, projectId: q3Pipeline.id, title: "Nordic Supply — weekly sync", startsAt: day(0, 10), endsAt: day(0, 11), isExternal: true, attendees: [{ name: "Anna Lindqvist", email: "anna@nordicsupply.com" }] },
    { provider: "google", externalId: "seed-2", title: "Deep work — positioning draft", startsAt: day(0, 13), endsAt: day(0, 15), isExternal: false, attendees: [] },
    { provider: "google", externalId: "seed-3", clientId: veloce.id, title: "Veloce creative review", startsAt: day(0, 15, ), endsAt: day(0, 16), isExternal: true, attendees: [{ name: "Sofie Mikkelsen", email: "sofie@veloce.dk" }] },
    { provider: "google", externalId: "seed-4", clientId: nordic.id, projectId: q3Pipeline.id, title: "Mid-quarter review — Nordic Supply", startsAt: day(2, 9), endsAt: day(2, 10, ), isExternal: true, attendees: [{ name: "Anna Lindqvist", email: "anna@nordicsupply.com" }, { name: "Marcus Reed", email: "marcus@nordicsupply.com" }] },
    { provider: "google", externalId: "seed-5", clientId: hallberg.id, projectId: positioning.id, title: "Hallberg — positioning workshop", startsAt: day(4, 13), endsAt: day(4, 16), isExternal: true, attendees: [{ name: "Peter Hallberg", email: "peter@hallberglegal.dk" }] },
    { provider: "google", externalId: "seed-6", clientId: veloce.id, title: "Veloce — autumn planning", startsAt: day(-2, 11), endsAt: day(-2, 12), isExternal: true, attendees: [{ name: "Sofie Mikkelsen", email: "sofie@veloce.dk" }] },
  ]);

  await db.insert(messages).values([
    { provider: "gmail", externalId: "m1", clientId: nordic.id, threadId: "t1", subject: "Re: cost per lead is up again?", fromName: "Anna Lindqvist", fromEmail: "anna@nordicsupply.com", snippet: "The board asked about this in yesterday's meeting and I didn't have a good answer. Can you send me something I can forward before Thursday?", receivedAt: day(-4, 16), awaitingReply: true },
    { provider: "gmail", externalId: "m2", clientId: veloce.id, threadId: "t2", subject: "Which products for autumn?", fromName: "Sofie Mikkelsen", fromEmail: "sofie@veloce.dk", snippet: "Sorry for the slow reply — we're still arguing about it internally. Will confirm this week.", receivedAt: day(-9, 11), awaitingReply: false, isFromMe: false },
    { provider: "gmail", externalId: "m3", clientId: hallberg.id, threadId: "t3", subject: "Availability for a second workshop", fromName: "Peter Hallberg", fromEmail: "peter@hallberglegal.dk", snippet: "Two of the partners want another session before we lock the positioning. Does the week of the 20th work for you?", receivedAt: day(-3, 9), awaitingReply: true },
  ]);

  console.log("Creating 90 days of marketing data…");
  const metricRows: (typeof metrics.$inferInsert)[] = [];

  // A plausible shape: gentle trend, weekday seasonality, one deliberate late-period
  // deterioration on Nordic's Meta account so the anomaly rule has something real to find.
  for (let back = 90; back >= 1; back--) {
    const date = iso(new Date(now.getTime() - back * DAY));
    const dow = new Date(now.getTime() - back * DAY).getDay();
    const weekend = dow === 0 || dow === 6 ? 0.55 : 1;
    const wobble = () => 0.85 + Math.random() * 0.3;

    const plans = [
      { client: nordic, source: "meta", spend: 1650, ctr: 0.011, cvr: 0.028, decay: back < 10 ? 0.55 : 1 },
      { client: nordic, source: "linkedin", spend: 2400, ctr: 0.006, cvr: 0.041 },
      { client: nordic, source: "google_ads", spend: 1900, ctr: 0.052, cvr: 0.036 },
      { client: veloce, source: "meta", spend: 4200, ctr: 0.017, cvr: 0.019, revenuePerConv: 780 },
      { client: veloce, source: "google_ads", spend: 1100, ctr: 0.061, cvr: 0.031, revenuePerConv: 810 },
      { client: hallberg, source: "linkedin", spend: 600, ctr: 0.008, cvr: 0.022 },
    ];

    for (const plan of plans) {
      const spend = plan.spend * weekend * wobble();
      const impressions = Math.round((spend / 0.09) * wobble());
      const clicks = Math.round(impressions * plan.ctr * wobble());
      const conversions = Math.max(0, Math.round(clicks * plan.cvr * (plan.decay ?? 1) * wobble()));

      const base = { clientId: plan.client.id, source: plan.source, date, entityType: "account", entityId: `${plan.client.slug}:${plan.source}`, entityName: plan.client.name };
      metricRows.push(
        { ...base, metric: "spend", value: Math.round(spend) },
        { ...base, metric: "impressions", value: impressions },
        { ...base, metric: "clicks", value: clicks },
        { ...base, metric: "conversions", value: conversions },
      );
      if (plan.revenuePerConv) {
        metricRows.push({ ...base, metric: "revenue", value: Math.round(conversions * plan.revenuePerConv * wobble()) });
      }
    }

    for (const client of [nordic, veloce, hallberg]) {
      const scale = client.id === veloce.id ? 3.4 : client.id === nordic.id ? 1 : 0.35;
      const sessions = Math.round(820 * scale * weekend * wobble());
      const base = { clientId: client.id, source: "ga4", date, entityType: "channel", entityId: `${client.slug}:ga4`, entityName: "All traffic" };
      metricRows.push(
        { ...base, metric: "sessions", value: sessions },
        { ...base, metric: "users", value: Math.round(sessions * 0.78) },
        { ...base, metric: "conversions", value: Math.round(sessions * 0.021 * wobble()) },
      );
    }
  }

  for (let i = 0; i < metricRows.length; i += 400) {
    await db.insert(metrics).values(metricRows.slice(i, i + 400));
  }
  console.log(`  ${metricRows.length} metric rows`);

  console.log("Creating report cadences…");
  const scheduleSpecs = [
    { clientId: nordic.id, name: "Monthly performance report", cadence: "monthly" as const, dayOf: 3, leadDays: 4, sources: ["ga4", "meta", "linkedin", "google_ads"], recipients: ["anna@nordicsupply.com", "marcus@nordicsupply.com"], template: "Always lead with cost per opportunity, not cost per lead. Anna forwards this to the board, so it has to stand on its own without me in the room." },
    { clientId: veloce.id, name: "Weekly performance note", cadence: "weekly" as const, dayOf: 1, leadDays: 1, sources: ["meta", "google_ads", "ga4"], recipients: ["sofie@veloce.dk"], template: "Short. ROAS, spend, what creative is winning, what ships next. Sofie reads it on her phone." },
    { clientId: hallberg.id, name: "Monthly advisory summary", cadence: "monthly" as const, dayOf: 25, leadDays: 5, sources: [], recipients: ["peter@hallberglegal.dk"], template: "Not a numbers report. What we decided, what is still open, what I need from the partners." },
  ];

  for (const spec of scheduleSpecs) {
    const [schedule] = await db.insert(reportSchedules).values({ ...spec, nextDueAt: nextDueDate(spec) }).returning();
    const dueAt = nextDueDate(spec);
    const period = reportingPeriod(spec.cadence, dueAt);
    await db.insert(reportRuns).values({ scheduleId: schedule.id, clientId: spec.clientId, periodStart: period.start, periodEnd: period.end, dueAt, status: "pending" });
  }

  // One that is already late, because that is the state this feature exists for.
  await db.insert(reportRuns).values({
    clientId: nordic.id,
    periodStart: iso(new Date(now.getTime() - 34 * DAY)),
    periodEnd: iso(new Date(now.getTime() - 4 * DAY)),
    dueAt: day(-2),
    status: "pending",
  });

  console.log("Recomputing project progress…");
  const allProjects = await db.select().from(projects);
  for (const project of allProjects) {
    const rows = await db.select().from(tasks).where(eq(tasks.projectId, project.id));
    const counted = rows.filter((t) => t.status !== "dropped");
    const done = counted.filter((t) => t.status === "done");
    await db
      .update(projects)
      .set({ progress: counted.length === 0 ? 0 : Math.round((done.length / counted.length) * 100) })
      .where(eq(projects.id, project.id));
  }

  console.log("Running the proactive engine…");
  const { runProactiveEngine } = await import("../src/lib/proactive/engine");
  const result = await runProactiveEngine();
  console.log(`  ${result.raised} signals raised across ${result.ran} rules`);
  if (result.errors.length) console.log("  rule errors:", result.errors);

  console.log("\nDone. Run `npm run dev` and open http://localhost:3000");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
