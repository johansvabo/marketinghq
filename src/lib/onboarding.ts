import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, connections, insights, reportSchedules, stakeholders, tasks } from "@/lib/db/schema";

export type Step = {
  key: string;
  title: string;
  /** Why this one is worth doing, in terms of what it buys you. */
  why: string;
  href: string;
  cta: string;
  done: boolean;
};

async function count(query: Promise<{ n: number }[]>): Promise<number> {
  const rows = await query;
  return Number(rows[0]?.n ?? 0);
}

/**
 * A new workspace is empty by definition, and an empty dashboard is honest but
 * useless — it shows that nothing needs you without saying what would make it
 * start working. These steps are ordered by what unlocks the most: everything
 * hangs off clients, and the proactive rules stay quiet until they have
 * something to watch.
 */
export async function onboardingSteps(): Promise<{ steps: Step[]; complete: boolean }> {
  const [clientCount, cadenceCount, reportCount, connectionCount, captureCount] = await Promise.all([
    count(db.select({ n: sql<number>`count(*)` }).from(clients)),
    count(db.select({ n: sql<number>`count(*)` }).from(stakeholders).where(gt(stakeholders.contactCadenceDays, 0))),
    count(db.select({ n: sql<number>`count(*)` }).from(reportSchedules).where(eq(reportSchedules.active, true))),
    count(db.select({ n: sql<number>`count(*)` }).from(connections)),
    count(db.select({ n: sql<number>`count(*)` }).from(insights)),
  ]);

  const steps: Step[] = [
    {
      key: "clients",
      title: "Add your clients",
      why: "Everything hangs off these. Fill in their email domains and inbound mail and meetings file themselves.",
      href: "/settings",
      cta: "Add a client",
      done: clientCount > 0,
    },
    {
      key: "stakeholders",
      title: "Add the people, with a contact cadence",
      why: "The field everyone skips. It is what produces “Anna hasn’t heard from you in 19 days” instead of you remembering.",
      href: "/settings",
      cta: "Add people",
      done: cadenceCount > 0,
    },
    {
      key: "reports",
      title: "Set a report cadence per client",
      why: "Reports then queue themselves and warn you ahead of the deadline, with the numbers already pulled.",
      href: "/reports",
      cta: "Set a cadence",
      done: reportCount > 0,
    },
    {
      key: "brain",
      title: "Put what you already know into the brain",
      why: "Import old notes and docs. This is what makes it worth asking questions of, rather than a to-do list.",
      href: "/brain/import",
      cta: "Import",
      done: captureCount > 0,
    },
    {
      key: "connections",
      title: "Connect your data",
      why: "Gmail, Calendar, GA4, Meta, LinkedIn, Google Ads. The nightly sync starts the moment anything is connected.",
      href: "/settings",
      cta: "Connect",
      done: connectionCount > 0,
    },
  ];

  return { steps, complete: steps.every((s) => s.done) };
}

/** True while the workspace has no clients — the point before anything works. */
export async function isBrandNew(): Promise<boolean> {
  return (await count(db.select({ n: sql<number>`count(*)` }).from(clients))) === 0;
}
