import Link from "next/link";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { Plus, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { chatMessages, chatThreads, clients, insights } from "@/lib/db/schema";
import { isConfigured } from "@/lib/env";
import { iso, relativeDay } from "@/lib/dates";
import { Card, Chip, ClientDot, Empty, PageHeader } from "@/components/ui";
import { BrainChat } from "@/components/brain-chat";
import { InsightRow } from "@/components/insight-row";

export const dynamic = "force-dynamic";

const SUGGESTIONS = [
  "What needs my attention today that isn't already on the list?",
  "Summarise what's happened across all clients in the last two weeks.",
  "What have I learned about LinkedIn ads that I should reuse?",
  "Which client relationship is most at risk right now, and why?",
];

export default async function BrainPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; thread?: string; q?: string; client?: string; kind?: string }>;
}) {
  const params = await searchParams;
  const tab = params.tab ?? "ask";

  if (tab === "library") return <Library params={params} />;

  const [threads, history] = await Promise.all([
    db.select().from(chatThreads).orderBy(desc(chatThreads.updatedAt)).limit(12),
    params.thread
      ? db.select().from(chatMessages).where(eq(chatMessages.threadId, params.thread)).orderBy(chatMessages.createdAt)
      : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title="Brain" subtitle="Ask your own record. It reads your work, not the web." actions={<Tabs tab={tab} />} />

      <div className="grid gap-4 lg:grid-cols-[1fr_230px]">
        <BrainChat
          key={params.thread ?? "new"}
          initial={history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))}
          threadId={params.thread}
          suggestions={SUGGESTIONS}
          aiReady={isConfigured.anthropic()}
        />

        <aside className="hidden flex-col gap-2 lg:flex">
          <div className="flex items-center justify-between">
            <span className="section-title">Recent</span>
            <Link href="/brain" className="btn btn-ghost btn-sm">New</Link>
          </div>
          {threads.length === 0 ? (
            <p className="text-[12px] text-muted">No conversations yet.</p>
          ) : (
            threads.map((thread) => (
              <Link
                key={thread.id}
                href={`/brain?thread=${thread.id}`}
                className="rounded-[10px] px-2.5 py-2 text-[12.5px] leading-snug transition-colors hover:bg-[var(--raised)]"
                style={params.thread === thread.id ? { background: "var(--raised)" } : undefined}
              >
                <span className="line-clamp-2">{thread.title}</span>
                <span className="mt-0.5 block text-[11px] text-muted">{relativeDay(thread.updatedAt)}</span>
              </Link>
            ))
          )}
        </aside>
      </div>
    </>
  );
}

function Tabs({ tab }: { tab: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Link href="/brain?tab=ask" className={`btn btn-sm ${tab === "ask" ? "btn-primary" : ""}`}>Ask</Link>
      <Link href="/brain?tab=library" className={`btn btn-sm ${tab === "library" ? "btn-primary" : ""}`}>Library</Link>
      <Link href="/brain/new" className="btn btn-sm">
        <Plus size={14} />
        Capture
      </Link>
      <Link href="/brain/import" className="btn btn-sm">
        <Upload size={14} />
        Import
      </Link>
    </div>
  );
}

const KINDS = ["insight", "learning", "benchmark", "idea", "meeting_note", "decision", "reference"];

async function Library({ params }: { params: { q?: string; client?: string; kind?: string } }) {
  const where = [];
  if (params.q) {
    const needle = `%${params.q.toLowerCase()}%`;
    where.push(or(like(sql`lower(${insights.title})`, needle), like(sql`lower(${insights.body})`, needle)));
  }
  if (params.client) where.push(eq(insights.clientId, params.client));
  if (params.kind) where.push(eq(insights.kind, params.kind));

  const [rows, clientRows, counts] = await Promise.all([
    db
      .select({ insight: insights, clientName: clients.name, clientColor: clients.color })
      .from(insights)
      .leftJoin(clients, eq(insights.clientId, clients.id))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(insights.pinned), desc(insights.occurredAt))
      .limit(200),
    db.select().from(clients).where(eq(clients.status, "active")),
    db.select({ kind: insights.kind, n: sql<number>`count(*)` }).from(insights).groupBy(insights.kind),
  ]);

  const countByKind = new Map(counts.map((c) => [c.kind, Number(c.n)]));
  const total = counts.reduce((sum, c) => sum + Number(c.n), 0);

  return (
    <>
      <PageHeader
        title="Brain"
        subtitle={`${total} captured ${total === 1 ? "entry" : "entries"} — the part that makes the next project faster`}
        actions={<Tabs tab="library" />}
      />

      <form className="mb-4 flex gap-2">
        <input type="hidden" name="tab" value="library" />
        {params.client && <input type="hidden" name="client" value={params.client} />}
        {params.kind && <input type="hidden" name="kind" value={params.kind} />}
        <input name="q" defaultValue={params.q ?? ""} className="input" placeholder="Search everything you've captured…" />
        <button type="submit" className="btn">Search</button>
      </form>

      <div className="scroll-x no-scrollbar mb-4 flex gap-1.5 pb-1">
        <Link href="/brain?tab=library" className={`btn btn-sm ${!params.kind && !params.client ? "btn-primary" : ""}`}>All</Link>
        {KINDS.filter((k) => countByKind.has(k)).map((kind) => (
          <Link key={kind} href={`/brain?tab=library&kind=${kind}`} className={`btn btn-sm ${params.kind === kind ? "btn-primary" : ""}`}>
            {kind.replace("_", " ")} <span className="opacity-60">{countByKind.get(kind)}</span>
          </Link>
        ))}
        <span className="mx-1 w-px" style={{ background: "var(--hairline)" }} />
        {clientRows.map((client) => (
          <Link
            key={client.id}
            href={`/brain?tab=library&client=${client.id}`}
            className={`btn btn-sm ${params.client === client.id ? "btn-primary" : ""}`}
          >
            <ClientDot color={client.color} />
            {client.name}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <Empty
            title={params.q ? `Nothing matches "${params.q}"` : "The library is empty"}
            hint="Every result you notice, every client preference, every thing that worked — put it here once and it stays available to you and to the brain forever."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/brain/import" className="btn btn-primary btn-sm">
                  <Upload size={14} />
                  Import what you already have
                </Link>
                <Link href="/brain/new" className="btn btn-sm">
                  <Plus size={14} />
                  Capture one by hand
                </Link>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map(({ insight, clientName, clientColor }) => (
            <InsightRow key={insight.id} insight={insight} clientName={clientName} clientColor={clientColor} />
          ))}
        </div>
      )}
    </>
  );
}
