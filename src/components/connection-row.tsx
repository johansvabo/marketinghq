"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import type { DataAccount } from "@/lib/db/schema";
import { syncNow } from "@/server/actions";
import { AccountMapper } from "./account-mapper";
import { Chip } from "./ui";

type ConnectionInfo = {
  id: string;
  displayName: string | null;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  accounts: DataAccount[];
};

export function ConnectionRow({
  provider,
  label,
  blurb,
  configured,
  connection,
  clients,
}: {
  provider: string;
  label: string;
  blurb: string;
  configured: boolean;
  connection: ConnectionInfo | null;
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const state = !configured ? "unconfigured" : !connection ? "disconnected" : connection.status;

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold tracking-tight">{label}</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{blurb}</p>
        </div>
        <Chip
          tone={state === "connected" ? "good" : state === "needs_reauth" || state === "error" ? "urgent" : "neutral"}
          solid={state === "connected"}
        >
          {state === "unconfigured" ? "no credentials" : state === "disconnected" ? "not connected" : state.replace("_", " ")}
        </Chip>
      </div>

      {connection && (
        <p className="mt-2 text-[11.5px] text-muted">
          {connection.displayName}
          {connection.lastSyncedAt && ` · last synced ${new Date(connection.lastSyncedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`}
        </p>
      )}

      {connection?.lastError && (
        <p className="mt-2 line-clamp-2 text-[11.5px]" style={{ color: "var(--color-urgent)" }}>
          {connection.lastError}
        </p>
      )}

      {note && <p className="mt-2 text-[11.5px] text-muted">{note}</p>}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {configured ? (
          <a href={`/api/connect/${provider}`} className={connection ? "btn btn-sm" : "btn btn-sm btn-primary"}>
            <Link2 size={13} />
            {connection ? "Reconnect" : "Connect"}
          </a>
        ) : (
          <span className="text-[11.5px] text-muted">
            Add its client ID and secret to your environment, then restart.
          </span>
        )}

        {connection && (
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const { outcomes } = await syncNow(provider);
                const written = outcomes.reduce((sum, o) => sum + o.itemsWritten, 0);
                const failed = outcomes.filter((o) => o.status === "error");
                setNote(failed.length ? `${failed[0].source}: ${failed[0].message?.slice(0, 90)}` : `Pulled ${written} rows.`);
                router.refresh();
              })
            }
            className="btn btn-sm"
          >
            <RefreshCw size={13} className={clsx(pending && "animate-spin")} />
            Sync now
          </button>
        )}
      </div>

      {connection && (
        <AccountMapper
          connectionId={connection.id}
          provider={provider}
          accounts={connection.accounts}
          clients={clients}
        />
      )}
    </div>
  );
}
