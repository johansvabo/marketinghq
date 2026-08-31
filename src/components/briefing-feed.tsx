"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, BookmarkPlus, Check, Clock, Loader2, Pin } from "lucide-react";
import { clsx } from "clsx";
import type { Briefing } from "@/lib/db/schema";
import { AGENTS, type AgentKey } from "@/lib/ai/agents";
import { keepBriefing, markBriefingRead, toggleBriefingPin } from "@/server/actions";
import { Card, ClientBadge, Empty } from "./ui";
import { Markdown } from "./markdown";

type Row = { briefing: Briefing; clientName: string | null; clientColor: string | null };

export function BriefingFeed({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) {
    return (
      <Card>
        <Empty
          title="No briefings yet"
          hint="Turn the schedule on and the team goes to work on each active client at the times you set. You can also run a cycle now to see what they produce."
        />
      </Card>
    );
  }

  function open(row: Row) {
    const next = openId === row.briefing.id ? null : row.briefing.id;
    setOpenId(next);
    if (next && !row.briefing.readAt && row.briefing.status === "ready") {
      startTransition(async () => {
        await markBriefingRead(row.briefing.id);
        router.refresh();
      });
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((row) => {
        const { briefing } = row;
        const agent = AGENTS[briefing.agentKey as AgentKey];
        const isOpen = openId === briefing.id;
        const unread = briefing.status === "ready" && !briefing.readAt;
        const working = briefing.status === "pending" || briefing.status === "running";

        return (
          <div
            key={briefing.id}
            className={clsx("card p-4 md:p-5", briefing.status === "empty" && "opacity-60")}
            style={{ borderLeft: `3px solid ${agent?.colour ?? "var(--hairline)"}` }}
          >
            <div className="flex flex-wrap items-center gap-2">
              {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: agent?.colour }} />}

              <button onClick={() => open(row)} className="text-left text-[14px] font-semibold tracking-[-0.01em] hover:underline">
                {briefing.status === "error"
                  ? `${agent?.name ?? briefing.agentKey} couldn't finish`
                  : briefing.status === "running"
                    ? `${agent?.name ?? briefing.agentKey} is working…`
                    : working
                      ? `${agent?.name ?? briefing.agentKey} — queued`
                    : briefing.status === "empty"
                      ? `${agent?.name ?? briefing.agentKey}: nothing worth reporting`
                      : (briefing.title ?? `${agent?.role} briefing`)}
              </button>

              {row.clientName && <ClientBadge name={row.clientName} color={row.clientColor} />}

              <div className="ml-auto flex items-center gap-1.5">
                {briefing.status === "running" && <Loader2 size={13} className="animate-spin text-[var(--ink-muted)]" />}
                {briefing.status === "pending" && <Clock size={12} className="text-[var(--ink-muted)]" />}
                {briefing.status === "error" && <AlertTriangle size={13} style={{ color: "var(--color-urgent)" }} />}
                <span className="text-[11px] text-muted">{agent?.name}</span>
                <span className="text-[11px] text-muted">{briefing.slotKey.replace("T", " ")}:00</span>

                {briefing.status === "ready" && (
                  <>
                    <button
                      onClick={() => startTransition(async () => { await toggleBriefingPin(briefing.id); router.refresh(); })}
                      className="btn btn-ghost btn-sm"
                      title={briefing.pinnedAt ? "Unpin" : "Pin"}
                      style={briefing.pinnedAt ? { color: "var(--color-brand)" } : undefined}
                    >
                      <Pin size={12} fill={briefing.pinnedAt ? "currentColor" : "none"} />
                    </button>
                    <button
                      onClick={() => startTransition(async () => { await keepBriefing(briefing.id); router.refresh(); })}
                      className="btn btn-ghost btn-sm"
                      title="Save into this client's documents"
                      disabled={pending}
                    >
                      <BookmarkPlus size={12} />
                    </button>
                  </>
                )}
              </div>
            </div>

            {briefing.status === "error" && (
              <p className="mt-1.5 text-[12px]" style={{ color: "var(--color-urgent)" }}>
                {briefing.error}
              </p>
            )}

            {isOpen && briefing.body && (
              <div className="mt-3 border-t pt-3">
                <Markdown source={briefing.body} />
                <div className="mt-3 flex items-center gap-2 border-t pt-3">
                  <Link href={`/team/${briefing.agentKey}`} className="btn btn-sm">
                    Take it further with {agent?.name}
                  </Link>
                  <button onClick={() => setOpenId(null)} className="btn btn-ghost btn-sm">Close</button>
                  {briefing.readAt && (
                    <span className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-muted">
                      <Check size={11} />
                      read
                    </span>
                  )}
                </div>
              </div>
            )}

            {!isOpen && briefing.body && briefing.status === "ready" && (
              <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted">
                {briefing.body.replace(/[#*`>_-]/g, " ").replace(/\s+/g, " ").slice(0, 200)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
