import { notFound } from "next/navigation";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { ArrowLeft, Globe } from "lucide-react";
import { db } from "@/lib/db";
import { chatMessages, chatThreads } from "@/lib/db/schema";
import { AGENTS, getAgent, type AgentKey } from "@/lib/ai/agents";
import { isConfigured } from "@/lib/env";
import { relativeDay } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import { BrainChat } from "@/components/brain-chat";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ agent: string }> }) {
  const agent = getAgent((await params).agent);
  return { title: agent ? `${agent.name} · ${agent.role}` : "Team" };
}

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ agent: string }>;
  searchParams: Promise<{ thread?: string }>;
}) {
  const agent = getAgent((await params).agent);
  if (!agent) notFound();

  const { thread: threadId } = await searchParams;

  const [threads, history] = await Promise.all([
    db
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.agentKey, agent.key))
      .orderBy(desc(chatThreads.updatedAt))
      .limit(12),
    threadId
      ? db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).orderBy(chatMessages.createdAt)
      : Promise.resolve([]),
  ]);

  return (
    <>
      <Link href="/team" className="btn btn-ghost btn-sm mb-3 -ml-2">
        <ArrowLeft size={14} />
        Team
      </Link>

      <PageHeader
        title={agent.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{agent.role}</span>
            {agent.web && (
              <span className="chip">
                <Globe size={10} />
                can search the web
              </span>
            )}
          </span>
        }
        actions={
          <Link href={`/team/${agent.key}`} className="btn btn-sm">
            New conversation
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_230px]">
        <BrainChat
          key={threadId ?? "new"}
          initial={history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))}
          threadId={threadId}
          agentKey={agent.key}
          suggestions={agent.examples}
          aiReady={isConfigured.anthropic()}
          placeholder={`Ask ${agent.name}…`}
          emptyTitle={`${agent.name} — ${agent.role.toLowerCase()}`}
          emptyHint={agent.blurb}
        />

        <aside className="hidden flex-col gap-2 lg:flex">
          <span className="section-title">With {agent.name}</span>
          {threads.length === 0 ? (
            <p className="text-[12px] text-muted">No conversations yet.</p>
          ) : (
            threads.map((thread) => (
              <Link
                key={thread.id}
                href={`/team/${agent.key}?thread=${thread.id}`}
                className="rounded-[10px] px-2.5 py-2 text-[12.5px] leading-snug transition-colors hover:bg-[var(--raised)]"
                style={threadId === thread.id ? { background: "var(--raised)" } : undefined}
              >
                <span className="line-clamp-2">{thread.title}</span>
                <span className="mt-0.5 block text-[11px] text-muted">{relativeDay(thread.updatedAt)}</span>
              </Link>
            ))
          )}

          <div className="mt-2 border-t pt-3">
            <span className="section-title">Rest of the team</span>
            <div className="mt-1.5 flex flex-col gap-1">
              {Object.values(AGENTS)
                .filter((a) => a.key !== agent.key)
                .map((a) => (
                  <Link
                    key={a.key}
                    href={`/team/${a.key}`}
                    className="flex items-center gap-2 rounded-[9px] px-2 py-1.5 text-[12.5px] hover:bg-[var(--raised)]"
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.colour }} />
                    {a.name}
                    <span className="ml-auto truncate text-[11px] text-muted">{a.role}</span>
                  </Link>
                ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
