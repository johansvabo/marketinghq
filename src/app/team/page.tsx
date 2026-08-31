import Link from "next/link";
import { desc, isNotNull, sql } from "drizzle-orm";
import { Globe } from "lucide-react";
import { db } from "@/lib/db";
import { chatThreads } from "@/lib/db/schema";
import { AGENT_LIST } from "@/lib/ai/agents";
import { isConfigured } from "@/lib/env";
import { relativeDay } from "@/lib/dates";
import { getBriefingConfig, recentBriefings } from "@/lib/ai/briefings";
import { Card, Empty, PageHeader } from "@/components/ui";
import { BriefingFeed } from "@/components/briefing-feed";
import { BriefingSchedule } from "@/components/briefing-schedule";
import { clients } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team" };

export default async function TeamPage() {
  const [threads, counts, config, feed, activeClients] = await Promise.all([
    db.select().from(chatThreads).where(isNotNull(chatThreads.agentKey)).orderBy(desc(chatThreads.updatedAt)).limit(8),
    db
      .select({ agentKey: chatThreads.agentKey, n: sql<number>`count(*)` })
      .from(chatThreads)
      .where(isNotNull(chatThreads.agentKey))
      .groupBy(chatThreads.agentKey),
    getBriefingConfig(),
    recentBriefings(30),
    db.select({ id: clients.id }).from(clients).where(eq(clients.status, "active")),
  ]);

  const countFor = new Map(counts.map((c) => [c.agentKey, Number(c.n)]));

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Specialists who read the same clients, documents and numbers you do — and disagree with you when they should"
      />

      {!isConfigured.anthropic() && (
        <Card tone="warn" className="mb-4">
          <p className="text-[13px] leading-relaxed">
            The team needs an <code className="rounded bg-[var(--raised)] px-1">ANTHROPIC_API_KEY</code>. Everything else
            in Marketing HQ works without one.
          </p>
        </Card>
      )}

      <div className="grid gap-2.5 md:grid-cols-2">
        {AGENT_LIST.map((agent) => (
          <Link
            key={agent.key}
            href={`/team/${agent.key}`}
            className="card p-4 transition-colors hover:border-[var(--ink-muted)]"
            style={{ borderLeft: `3px solid ${agent.colour}` }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="grid h-8 w-8 place-items-center rounded-full text-[13px] font-bold"
                style={{ background: `color-mix(in oklch, ${agent.colour} 20%, var(--surface))`, color: agent.colour }}
              >
                {agent.name[0]}
              </span>
              <div className="min-w-0">
                <h2 className="text-[14.5px] font-semibold tracking-[-0.01em]">{agent.name}</h2>
                <p className="text-[11.5px] text-muted">{agent.role}</p>
              </div>
              {agent.web && (
                <span className="chip ml-auto" title="Can search the web for current information">
                  <Globe size={10} />
                  web
                </span>
              )}
            </div>

            <p className="mt-2.5 text-[12.5px] leading-relaxed text-soft">{agent.blurb}</p>

            {countFor.get(agent.key) ? (
              <p className="mt-2 text-[11.5px] text-muted">
                {countFor.get(agent.key)} conversation{countFor.get(agent.key) === 1 ? "" : "s"}
              </p>
            ) : null}
          </Link>
        ))}
      </div>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <h2 className="section-title mb-2">Briefings</h2>
          <BriefingFeed rows={feed} />
        </div>
        <div>
          <h2 className="section-title mb-2">Working on their own</h2>
          <BriefingSchedule config={config} clientCount={activeClients.length} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="section-title mb-2">Recent conversations</h2>
        {threads.length === 0 ? (
          <Card>
            <Empty
              title="Nothing yet"
              hint="Pick a specialist above. They work across every client, so you can bring them a question about one account or all of them."
            />
          </Card>
        ) : (
          <Card>
            <ul className="flex flex-col gap-1">
              {threads.map((thread) => {
                const agent = AGENT_LIST.find((a) => a.key === thread.agentKey);
                return (
                  <li key={thread.id}>
                    <Link
                      href={`/team/${thread.agentKey}?thread=${thread.id}`}
                      className="flex items-center gap-2.5 rounded-[9px] px-2 py-2 hover:bg-[var(--raised)]"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: agent?.colour }} />
                      <span className="flex-1 truncate text-[13px]">{thread.title}</span>
                      <span className="shrink-0 text-[11.5px] text-muted">{agent?.name}</span>
                      <span className="shrink-0 text-[11px] text-muted">{relativeDay(thread.updatedAt)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </>
  );
}
