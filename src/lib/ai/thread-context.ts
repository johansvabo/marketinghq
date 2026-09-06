import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { assignments, clients, contributions, projects, type ChatThread } from "@/lib/db/schema";
import { AGENTS, type AgentKey } from "./agents";

/**
 * What a conversation is about, assembled on the server from what the thread
 * is linked to.
 *
 * Built fresh on every turn rather than carried in the request: the browser
 * would be sending back the team's own output for the model to trust, and it
 * would go stale the moment anything changed. The link is the only thing the
 * client supplies.
 */
export async function threadContext(thread: ChatThread): Promise<string | undefined> {
  const parts: string[] = [];

  if (thread.clientId) {
    const [client] = await db.select().from(clients).where(eq(clients.id, thread.clientId)).limit(1);
    if (client) {
      parts.push(
        `This conversation is about **${client.name}**. Read their standing context, documents, captured insights and numbers before answering, and assume any unqualified "they" or "the client" means them.`,
      );
    }
  }

  if (thread.projectId) {
    const [project] = await db.select().from(projects).where(eq(projects.id, thread.projectId)).limit(1);
    if (project) parts.push(`It concerns the project **${project.name}**${project.goal ? ` — ${project.goal}` : ""}.`);
  }

  if (thread.assignmentId) {
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, thread.assignmentId))
      .limit(1);

    if (assignment) {
      parts.push(
        `## The brief this follows up on\n\n${assignment.brief}`,
        `They are picking up on work the team already delivered, so do not start from scratch or re-run the whole analysis. Answer what they actually ask, defend or revise your position on its merits, and change your mind out loud when they make a better argument. Agreeing to be agreeable is worthless to them.`,
      );

      const agentKey = thread.agentKey as AgentKey | null;

      if (agentKey) {
        const [own] = await db
          .select()
          .from(contributions)
          .where(and(eq(contributions.assignmentId, assignment.id), eq(contributions.agentKey, agentKey)))
          .limit(1);
        if (own?.body) parts.push(`## What you delivered\n\n${own.body}`);
      }

      // The reviewer already holds everyone's work; anyone else gets the
      // gathered answer so they can see how their part was used.
      const isReviewer = agentKey ? AGENTS[agentKey]?.runsLast : false;

      if (isReviewer) {
        const others = await db
          .select()
          .from(contributions)
          .where(and(eq(contributions.assignmentId, assignment.id), ne(contributions.agentKey, agentKey!)));
        const bodies = others
          .filter((c) => c.body)
          .map((c) => `### ${AGENTS[c.agentKey as AgentKey]?.name ?? c.agentKey}\n\n${c.body}`);
        if (bodies.length) parts.push(`## What the team gave you\n\n${bodies.join("\n\n")}`);
      }

      if (assignment.synthesis) {
        parts.push(`## The gathered answer they are reading\n\n${assignment.synthesis}`);
      }
    }
  }

  return parts.length ? parts.join("\n\n") : undefined;
}
