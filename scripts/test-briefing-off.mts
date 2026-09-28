/**
 * What "off" stops.
 *
 * The switch stopped new cycles being planned and nothing else: work already
 * queued kept being produced every night until the queue drained. The setting
 * said stop, the bill said otherwise, and nothing on screen distinguished the
 * two.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { briefings, clients, settings } from "../src/lib/db/schema";
import { getBriefingConfig, planCycle, processPending, saveBriefingConfig } from "../src/lib/ai/briefings";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

await db.delete(briefings);
await db.delete(settings).where(eq(settings.key, "briefings"));
const [client] = await db
  .insert(clients)
  .values({ name: `Kunde-${Date.now()}`, slug: `k-${Date.now()}`, status: "active" })
  .returning();

const pendingCount = async () =>
  (await db.select().from(briefings).where(eq(briefings.status, "pending"))).length;

// On, and a cycle planned.
await saveBriefingConfig({
  enabled: true,
  slots: [{ weekday: new Date().getDay(), hour: 0 }],
  agents: ["seo", "market"],
  timezone: "Europe/Oslo",
});
await planCycle(new Date(), { includePastSlots: true });
check("switching on queues work", (await pendingCount()) > 0, String(await pendingCount()));

// Off.
const config = await getBriefingConfig();
await saveBriefingConfig({ ...config, enabled: false });

check("switching off clears the queue", (await pendingCount()) === 0, `${await pendingCount()} left`);

const off = await processPending(2_000);
check("...and the nightly pass produces nothing", off.produced === 0 && off.remaining === 0, JSON.stringify(off));

// The real failure: a queue that survives the switch must still not be run.
await db.insert(briefings).values({ agentKey: "seo", clientId: client.id, slotKey: "leftover", status: "pending" });
check("a leftover row exists for the next part", (await pendingCount()) === 1);

const stillOff = await processPending(2_000);
check("work queued while off is not produced anyway", stillOff.produced === 0, JSON.stringify(stillOff));
check("...and is reported as nothing outstanding, not silently running", stillOff.remaining === 0);

// Planning is blocked too, so an off schedule cannot refill its own queue.
await db.delete(briefings);
const planned = await planCycle(new Date(), { includePastSlots: true });
check("an off schedule plans nothing", planned.planned === 0, JSON.stringify(planned));
check("...so the queue stays empty", (await pendingCount()) === 0);

// Turning it back on must not resurrect the old cycle.
await saveBriefingConfig({ ...config, enabled: true });
check("switching back on starts from empty", (await pendingCount()) === 0);

await db.delete(briefings);
await db.delete(settings).where(eq(settings.key, "briefings"));
await db.delete(clients).where(eq(clients.id, client.id));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
