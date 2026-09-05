import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { assignments, clients, contributions, projects, type Assignment } from "@/lib/db/schema";
import { isConfigured } from "@/lib/env";
import { AGENTS, ORDERED_AGENTS, agentRank, getAgent, type AgentKey } from "./agents";
import { runBrain } from "./brain";
import { describeAiError } from "./client";

/*
 * A killed request would otherwise leave a contribution "running" forever.
 *
 * This window MUST stay comfortably longer than the route's maxDuration, or
 * work that is genuinely still running gets reclaimed and started a second
 * time in parallel — paying twice and racing to write the same row.
 */
const STALE_RUNNING_MS = 7 * 60 * 1000;

/** Given up on after this many starts that never reached a result. */
const MAX_ATTEMPTS = 3;

/** Exposed so the recovery tests assert against the real values. */
export const STALE_MS_FOR_TEST = STALE_RUNNING_MS;
export const MAX_ATTEMPTS_FOR_TEST = MAX_ATTEMPTS;

export const ASSIGNABLE = ORDERED_AGENTS.filter((a) => !a.runsLast);
export const REVIEWER = ORDERED_AGENTS.find((a) => a.runsLast) ?? null;

export async function createAssignment(input: {
  title: string;
  brief: string;
  clientId?: string | null;
  projectId?: string | null;
  agentKeys: AgentKey[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const title = input.title.trim();
  const brief = input.brief.trim();
  if (!brief) return { ok: false, error: "Say what you want the team to work on." };

  const chosen = input.agentKeys.filter((key) => key in AGENTS);
  if (chosen.length === 0) return { ok: false, error: "Pick at least one specialist." };

  const [row] = await db
    .insert(assignments)
    .values({
      title: title || brief.slice(0, 80),
      brief,
      clientId: input.clientId || null,
      projectId: input.projectId || null,
    })
    .returning();

  /*
   * The reviewer is always added, and always last: the point of briefing the
   * whole team is getting one answer back rather than six, and gathering them
   * is her job.
   */
  const keys = [...new Set([...chosen, ...(REVIEWER ? [REVIEWER.key] : [])])];

  await db.insert(contributions).values(keys.map((agentKey) => ({ assignmentId: row.id, agentKey })));

  return { ok: true, id: row.id };
}

/**
 * Work whose request died before it could record anything. Most of the time
 * that is a timeout, so it goes back in the queue — but only so many times.
 * A specialist that cannot finish inside the host's limit would otherwise be
 * picked up, killed and requeued indefinitely, which reads to the user as
 * "still working" forever.
 */
async function reclaimAbandoned(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - STALE_RUNNING_MS);
  const stale = and(eq(contributions.status, "running"), lt(contributions.startedAt, cutoff));

  await db
    .update(contributions)
    .set({
      status: "error",
      error: `Ran out of time ${MAX_ATTEMPTS} times without finishing. This brief is probably too big for one specialist to answer in a single run — try narrowing it, or run this one on a faster model.`,
      completedAt: now,
    })
    .where(and(stale, gte(contributions.attempts, MAX_ATTEMPTS)));

  await db
    .update(contributions)
    .set({ status: "pending", startedAt: null })
    .where(and(eq(contributions.status, "running"), lt(contributions.startedAt, cutoff)));
}

/**
 * The next piece of work on this assignment, in role order — but the reviewer
 * only becomes available once everyone else has finished, since she has
 * nothing to gather until then.
 */
export async function nextPending(assignmentId: string) {
  const rows = await db.select().from(contributions).where(eq(contributions.assignmentId, assignmentId));

  const outstanding = rows.filter((r) => r.status === "pending" || r.status === "running");
  const specialists = rows.filter((r) => agentRank(r.agentKey) < 2);
  const specialistsDone = specialists.every((r) => r.status !== "pending" && r.status !== "running");

  const available = outstanding
    .filter((r) => r.status === "pending")
    .filter((r) => agentRank(r.agentKey) < 2 || specialistsDone)
    .sort((a, b) => agentRank(a.agentKey) - agentRank(b.agentKey));

  return { next: available[0], outstanding: outstanding.length, rows };
}

function contextLine(client: { name: string } | null, project: { name: string } | null): string {
  if (client && project) return `This is for **${client.name}**, under the project **${project.name}**.`;
  if (client) return `This is for **${client.name}**.`;
  return "This is not tied to an existing client — treat it as a standing question for the consultancy to answer.";
}

async function assignmentContext(assignment: Assignment) {
  const [client] = assignment.clientId
    ? await db.select().from(clients).where(eq(clients.id, assignment.clientId)).limit(1)
    : [null];
  const [project] = assignment.projectId
    ? await db.select().from(projects).where(eq(projects.id, assignment.projectId)).limit(1)
    : [null];
  return { client: client ?? null, project: project ?? null };
}

/** What one specialist is asked, including whatever the team has said so far. */
async function buildPrompt(assignment: Assignment, agentKey: AgentKey): Promise<string> {
  const agent = AGENTS[agentKey];
  const { client, project } = await assignmentContext(assignment);

  const done = await db
    .select()
    .from(contributions)
    .where(and(eq(contributions.assignmentId, assignment.id), inArray(contributions.status, ["ready", "empty"])))
    .orderBy(asc(contributions.completedAt));

  const others = done
    .filter((c) => c.agentKey !== agentKey && c.body)
    .map((c) => `### ${AGENTS[c.agentKey as AgentKey]?.name ?? c.agentKey} — ${AGENTS[c.agentKey as AgentKey]?.role ?? ""}\n\n${c.body}`);

  const head = [
    `The team has been given one brief to work together on. Yours is the **${agent.role}** part of it.`,
    ``,
    contextLine(client, project),
    ``,
    `## The brief`,
    ``,
    assignment.brief,
    ``,
    `---`,
    ``,
    `Start by reading what the system already holds that bears on this${client ? ` — ${client.name}'s standing context, documents, captured insights, open work and numbers` : ""}.`,
  ].join("\n");

  if (agent.runsLast) {
    return [
      head,
      ``,
      `## What the team produced`,
      ``,
      others.length ? others.join("\n\n---\n\n") : "_Nobody else produced anything for this brief._",
      ``,
      `---`,
      ``,
      `## What to deliver`,
      ``,
      `Do not write a review of your colleagues. Write **the answer to the brief** — one document, in the client's language, that someone can act on without reading anything else.`,
      ``,
      `- Open with the recommendation and what it turns on. Someone reading only the first ten lines should get the decision and the reason.`,
      `- Build the body from the strongest material above, organised by the logic of the argument rather than by who wrote which part. Never label sections with colleagues' names.`,
      `- Where two of them disagree, say so plainly and say which view you would act on and why. A synthesis that hides a real disagreement is worth less than one that surfaces it.`,
      `- Cut what is weak, repeated or unsupported. Depth on the things that decide the answer beats coverage of everything raised.`,
      `- End with **What we would need to know** — the open questions and assumptions that would change the recommendation if they turned out differently.`,
      ``,
      `Do not save this as a document; it is stored with the assignment automatically.`,
    ].join("\n");
  }

  return [
    head,
    ``,
    others.length
      ? `## What the team has said so far\n\n${others.join("\n\n---\n\n")}\n\nBuild on this rather than repeating it. Where you disagree with a colleague, say so and say why.`
      : `You are first on this one. Set the frame the others will build on.`,
    ``,
    `---`,
    ``,
    `## What to deliver`,
    ``,
    `Your part of the answer, in full and in your own discipline. Deep on the thing you know rather than broad across the whole brief — someone else is covering the rest, and one of you gathers it all at the end.`,
    ``,
    `If the brief genuinely has nothing in it for your discipline, say so in one line and stop. Padding it costs the final document more than leaving it out.`,
    ``,
    `Do not save this as a document; it is stored with the assignment automatically.`,
  ].join("\n");
}

/**
 * Runs ONE specialist, then returns.
 *
 * It used to loop through as many as fitted a budget, which was the wrong
 * shape for a host that kills the request at a fixed limit: a specialist
 * started with seconds left got cut off mid-answer and left sitting at
 * "running" with nothing to show. One per request means the whole limit
 * belongs to one specialist, and the caller comes back for the next.
 */
export async function processAssignment(
  assignmentId: string,
  _budgetMs?: number,
  now = new Date(),
): Promise<{ produced: number; failed: number; remaining: number; done: boolean; retryAfterMs?: number }> {
  // Bookkeeping first: tidying up work abandoned by a killed request needs no
  // API key, and skipping it when the key is missing would strand those rows
  // at "running" for as long as it stayed missing.
  await reclaimAbandoned(now);

  if (!isConfigured.anthropic()) {
    const { outstanding } = await nextPending(assignmentId);
    return { produced: 0, failed: 0, remaining: outstanding, done: outstanding === 0 };
  }

  const [assignment] = await db.select().from(assignments).where(eq(assignments.id, assignmentId)).limit(1);
  if (!assignment) return { produced: 0, failed: 0, remaining: 0, done: true };

  let produced = 0;
  let failed = 0;

  const { next } = await nextPending(assignmentId);

  if (next) {
    const agent = getAgent(next.agentKey);
    if (!agent) {
      await db
        .update(contributions)
        .set({ status: "error", error: "That specialist no longer exists.", completedAt: new Date() })
        .where(eq(contributions.id, next.id));
      failed++;
    } else {
      // Recorded before the risky call, so a request killed mid-answer still
      // leaves evidence that this one was tried.
      await db
        .update(contributions)
        .set({ status: "running", startedAt: new Date(), attempts: next.attempts + 1 })
        .where(eq(contributions.id, next.id));

      try {
        const result = await runBrain({
          agent,
          messages: [{ role: "user", content: await buildPrompt(assignment, agent.key) }],
          maxTurns: 10,
        });

        const text = result.text.trim();
        const empty = text.length < 40;

        await db
          .update(contributions)
          .set({
            status: empty ? "empty" : "ready",
            body: text,
            sources: result.toolCalls.map((c) => c.name),
            completedAt: new Date(),
          })
          .where(eq(contributions.id, next.id));

        // The reviewer's piece is the assignment's answer, not just another part.
        if (agent.runsLast && !empty) {
          await db
            .update(assignments)
            .set({ synthesis: text, updatedAt: new Date() })
            .where(eq(assignments.id, assignmentId));
        }

        produced++;
      } catch (error) {
        await db
          .update(contributions)
          .set({
            status: "error",
            // Humanised, not the SDK's raw body — this text is shown as-is.
            error: describeAiError(error).slice(0, 300),
            completedAt: new Date(),
          })
          .where(eq(contributions.id, next.id));
        failed++;
      }
    }
  }

  const { outstanding, rows, next: stillAvailable } = await nextPending(assignmentId);
  const done = outstanding === 0;

  /*
   * Work outstanding but nothing to pick up means something is mid-flight —
   * either genuinely running, or orphaned by a killed request and not yet old
   * enough to reclaim. Say how long until it can be retried rather than
   * handing back a button that would do nothing.
   */
  let retryAfterMs: number | undefined;
  if (!done && !stillAvailable) {
    const oldest = rows
      .filter((r) => r.status === "running" && r.startedAt)
      .map((r) => r.startedAt!.getTime())
      .sort((a, b) => a - b)[0];
    if (oldest) retryAfterMs = Math.max(0, oldest + STALE_RUNNING_MS - Date.now());
  }

  if (done) {
    const allFailed = rows.every((r) => r.status === "error");
    await db
      .update(assignments)
      .set({
        status: allFailed ? "error" : "ready",
        error: allFailed ? "Every specialist failed on this brief." : null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(assignments.id, assignmentId));
  }

  return { produced, failed, remaining: outstanding, done, retryAfterMs };
}

export async function recentAssignments(limit = 20) {
  const rows = await db
    .select({ assignment: assignments, client: clients })
    .from(assignments)
    .leftJoin(clients, eq(assignments.clientId, clients.id))
    .orderBy(desc(assignments.createdAt))
    .limit(limit);

  const counts = await db
    .select({
      assignmentId: contributions.assignmentId,
      total: sql<number>`count(*)`,
      done: sql<number>`sum(case when ${contributions.status} in ('ready','empty','error') then 1 else 0 end)`,
    })
    .from(contributions)
    .groupBy(contributions.assignmentId);

  const byId = new Map(counts.map((c) => [c.assignmentId, c]));
  return rows.map((r) => ({
    ...r,
    total: Number(byId.get(r.assignment.id)?.total ?? 0),
    done: Number(byId.get(r.assignment.id)?.done ?? 0),
  }));
}

export async function assignmentWithWork(id: string) {
  const [row] = await db
    .select({ assignment: assignments, client: clients, project: projects })
    .from(assignments)
    .leftJoin(clients, eq(assignments.clientId, clients.id))
    .leftJoin(projects, eq(assignments.projectId, projects.id))
    .where(eq(assignments.id, id))
    .limit(1);

  if (!row) return null;

  const work = await db.select().from(contributions).where(eq(contributions.assignmentId, id));
  return { ...row, work: work.sort((a, b) => agentRank(a.agentKey) - agentRank(b.agentKey)) };
}
