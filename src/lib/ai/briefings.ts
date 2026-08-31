import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefings, clients, settings } from "@/lib/db/schema";
import { lastOccurrence } from "@/lib/timezone";
import { AGENT_LIST, AGENTS, getAgent, type AgentKey } from "./agents";
import { runBrain } from "./brain";
import { isConfigured } from "@/lib/env";

/**
 * Scheduled, unprompted work: twice a week each specialist studies each client
 * and produces something usable in their speciality.
 *
 * Two stages on purpose. The schedule *plans* the work as pending rows, and a
 * time-budgeted worker produces them across as many passes as it takes — one
 * cycle can be twenty model sessions with web searches inside them, which is
 * far more than a single request may spend.
 */

export type BriefingConfig = {
  enabled: boolean;
  /** Local weekday (0 = Sunday) and hour, in the user's timezone. */
  slots: { weekday: number; hour: number }[];
  agents: AgentKey[];
  timezone: string;
  /** When the schedule was last switched on, as epoch ms. */
  enabledAt?: number;
};

export const DEFAULT_CONFIG: BriefingConfig = {
  enabled: false,
  slots: [
    { weekday: 0, hour: 19 },
    { weekday: 3, hour: 6 },
  ],
  agents: ["linkedin", "seo", "market", "pipeline", "editor"],
  timezone: "Europe/Oslo",
};

const SETTINGS_KEY = "briefings";

export async function getBriefingConfig(): Promise<BriefingConfig> {
  const [row] = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);
  return { ...DEFAULT_CONFIG, ...((row?.value as Partial<BriefingConfig>) ?? {}) };
}

export async function saveBriefingConfig(config: BriefingConfig): Promise<void> {
  const previous = await getBriefingConfig();

  // Stamp the moment it was switched on. Slots that came round before then are
  // history, not work — turning this on should never retroactively run, and
  // charge for, last week's cycles.
  const enabledAt = config.enabled ? (previous.enabled ? previous.enabledAt : Date.now()) : undefined;

  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value: { ...config, enabledAt } })
    .onConflictDoUpdate({ target: settings.key, set: { value: { ...config, enabledAt } } });
}

/**
 * Creates the pending work for any slot that has come round and not yet run.
 * Idempotent: the unique index on (agent, client, slot) means a second call
 * within the same occurrence adds nothing.
 */
export async function planCycle(
  now = new Date(),
  opts: { includePastSlots?: boolean } = {},
): Promise<{ planned: number; slot: string | null }> {
  const config = await getBriefingConfig();
  if (!config.enabled || config.agents.length === 0) return { planned: 0, slot: null };

  const activeClients = await db.select().from(clients).where(eq(clients.status, "active"));
  if (activeClients.length === 0) return { planned: 0, slot: null };

  let planned = 0;
  let slot: string | null = null;

  for (const { weekday, hour } of config.slots) {
    const occurrence = lastOccurrence(now, config.timezone, weekday, hour);
    if (!occurrence) continue;

    // "Run now" deliberately ignores this so a cycle can be tried on demand.
    if (!opts.includePastSlots && config.enabledAt && occurrence.at.getTime() < config.enabledAt) continue;

    for (const agentKey of config.agents) {
      if (!AGENTS[agentKey]) continue;

      for (const client of activeClients) {
        const inserted = await db
          .insert(briefings)
          .values({ agentKey, clientId: client.id, slotKey: occurrence.slotKey, status: "pending" })
          .onConflictDoNothing()
          .returning();

        if (inserted.length > 0) {
          planned++;
          slot = occurrence.slotKey;
        }
      }
    }
  }

  return { planned, slot };
}

/**
 * A run marks its row `running` before calling the model. If that request is
 * then killed — a serverless timeout, a deploy mid-flight — the row stays
 * `running` for ever and no later pass ever picks it up: the work silently
 * disappears. Anything that has been "running" longer than a request could
 * possibly last is treated as abandoned and put back.
 */
const STALE_RUNNING_MS = 15 * 60 * 1000;

async function reclaimAbandoned(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_RUNNING_MS);
  const rows = await db
    .update(briefings)
    .set({ status: "pending", startedAt: null })
    .where(and(eq(briefings.status, "running"), lt(briefings.startedAt, cutoff)))
    .returning();
  return rows.length;
}

/** Waiting work, with the reviewer last so she can read the others' output. */
async function nextPending() {
  const rows = await db
    .select({ briefing: briefings, client: clients })
    .from(briefings)
    .leftJoin(clients, eq(briefings.clientId, clients.id))
    .where(eq(briefings.status, "pending"))
    .orderBy(asc(briefings.createdAt))
    .limit(50);

  const reviewers = new Set(AGENT_LIST.filter((a) => a.runsLast).map((a) => a.key));
  return [...rows].sort((a, b) => Number(reviewers.has(a.briefing.agentKey as AgentKey)) - Number(reviewers.has(b.briefing.agentKey as AgentKey)))[0];
}

export async function processPending(
  budgetMs = 200_000,
  now = new Date(),
): Promise<{ produced: number; failed: number; remaining: number; reclaimed: number }> {
  if (!isConfigured.anthropic()) return { produced: 0, failed: 0, remaining: 0, reclaimed: 0 };

  const reclaimed = await reclaimAbandoned(now);
  const deadline = Date.now() + budgetMs;
  let produced = 0;
  let failed = 0;

  while (Date.now() < deadline) {
    const next = await nextPending();
    if (!next) break;

    const { briefing, client } = next;
    const agent = getAgent(briefing.agentKey);
    if (!agent || !client) {
      await db.update(briefings).set({ status: "error", error: "Agent or client no longer exists." }).where(eq(briefings.id, briefing.id));
      failed++;
      continue;
    }

    await db.update(briefings).set({ status: "running", startedAt: new Date() }).where(eq(briefings.id, briefing.id));

    try {
      const prompt = await buildPrompt(agent.key, client.name, briefing.slotKey);
      const result = await runBrain({
        agent,
        messages: [{ role: "user", content: prompt }],
        maxTurns: 10,
      });

      const text = result.text.trim();
      // "Nothing to report" is a legitimate and valuable answer — recording it
      // as empty keeps the feed honest instead of padding it with filler.
      const empty = text.length < 40 || /^\s*(nothing (new|to report|meaningful))/i.test(text);

      await db
        .update(briefings)
        .set({
          status: empty ? "empty" : "ready",
          title: firstHeading(text) ?? `${agent.role} — ${client.name}`,
          body: text,
          sources: result.toolCalls.map((c) => c.name),
          completedAt: new Date(),
        })
        .where(eq(briefings.id, briefing.id));

      produced++;
    } catch (error) {
      await db
        .update(briefings)
        .set({
          status: "error",
          error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
          completedAt: new Date(),
        })
        .where(eq(briefings.id, briefing.id));
      failed++;
    }
  }

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(briefings)
    .where(eq(briefings.status, "pending"));

  return { produced, failed, remaining: Number(n), reclaimed };
}

/** The reviewer needs this cycle's other briefings; everyone else needs the brief. */
async function buildPrompt(agentKey: AgentKey, clientName: string, slotKey: string): Promise<string> {
  const agent = AGENTS[agentKey];
  const base = `This is your scheduled briefing for **${clientName}**.\n\nStart by reading everything the system holds on them — their standing context, documents, captured insights, open work and numbers. Then:\n\n${agent.briefing}`;

  if (!agent.runsLast) return base;

  const others = await db
    .select({ b: briefings, c: clients })
    .from(briefings)
    .leftJoin(clients, eq(briefings.clientId, clients.id))
    .where(and(eq(briefings.slotKey, slotKey), inArray(briefings.status, ["ready", "empty"])));

  const forThisClient = others.filter((o) => o.c?.name === clientName && o.b.agentKey !== agentKey);

  if (forThisClient.length === 0) {
    return `${base}\n\n---\n\nThe rest of the team produced nothing for ${clientName} this cycle. Say so in one line, then give the single most valuable thing to do for this client this week from what is in the system.`;
  }

  const bodies = forThisClient
    .map((o) => `### ${AGENTS[o.b.agentKey as AgentKey]?.name ?? o.b.agentKey} — ${AGENTS[o.b.agentKey as AgentKey]?.role ?? ""}\n\n${o.b.body ?? "(nothing to report)"}`)
    .join("\n\n---\n\n");

  return `${base}\n\n---\n\n## What the team produced for ${clientName} this cycle\n\n${bodies}`;
}

function firstHeading(text: string): string | null {
  const match = text.match(/^#{1,3}\s+(.+)$/m);
  return match ? match[1].trim().slice(0, 120) : null;
}

export async function unreadBriefingCount(): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(briefings)
    .where(and(eq(briefings.status, "ready"), isNull(briefings.readAt)));
  return Number(n);
}

export async function recentBriefings(limit = 40) {
  return db
    .select({ briefing: briefings, clientName: clients.name, clientColor: clients.color })
    .from(briefings)
    .leftJoin(clients, eq(briefings.clientId, clients.id))
    .where(inArray(briefings.status, ["ready", "empty", "error", "pending", "running"]))
    .orderBy(desc(briefings.createdAt))
    .limit(limit);
}
