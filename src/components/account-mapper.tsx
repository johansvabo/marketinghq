"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import type { DataAccount } from "@/lib/db/schema";
import { setConnectionAccounts } from "@/server/actions";

/** What each provider's connection can carry, and what the ID actually is. */
const KINDS: Record<string, { kind: DataAccount["kind"]; label: string; placeholder: string; help: string }[]> = {
  google: [
    { kind: "ga4", label: "GA4 property", placeholder: "123456789", help: "GA4 → Admin → Property Settings → Property ID" },
    { kind: "google_ads", label: "Google Ads account", placeholder: "123-456-7890", help: "The customer ID at the top right of the Ads UI" },
  ],
  meta: [{ kind: "meta", label: "Ad account", placeholder: "act_123456789", help: "Ads Manager → the act_… in the URL" }],
  linkedin: [{ kind: "linkedin", label: "Ad account", placeholder: "512345678", help: "Campaign Manager → account ID in the URL" }],
  microsoft: [],
};

export function AccountMapper({
  connectionId,
  provider,
  accounts,
  clients,
}: {
  connectionId: string;
  provider: string;
  accounts: DataAccount[];
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<DataAccount[]>(accounts);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const kinds = KINDS[provider] ?? [];
  if (kinds.length === 0) return null;

  function update(index: number, patch: Partial<DataAccount>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setSaved(false);
  }

  function save() {
    startTransition(async () => {
      await setConnectionAccounts(connectionId, rows);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="mt-3 border-t pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="section-title">Accounts → clients</span>
        {rows.length > 0 && (
          <button onClick={save} disabled={pending} className="btn btn-sm btn-primary">
            {saved ? "Saved" : "Save mapping"}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="mb-2 text-[11.5px] leading-relaxed text-muted">
          Nothing mapped yet, so nothing syncs. Tell it which account belongs to which client.
        </p>
      ) : (
        <div className="mb-2 flex flex-col gap-1.5">
          {rows.map((row, index) => (
            <div key={index} className="flex flex-wrap items-center gap-1.5">
              <select
                value={row.kind}
                onChange={(event) => update(index, { kind: event.target.value as DataAccount["kind"] })}
                className="input w-auto py-1.5 text-[12px]"
                aria-label="Account type"
              >
                {kinds.map((k) => (
                  <option key={k.kind} value={k.kind}>{k.label}</option>
                ))}
              </select>

              <input
                value={row.accountId}
                onChange={(event) => update(index, { accountId: event.target.value })}
                className="input w-[150px] py-1.5 text-[12px]"
                placeholder={kinds.find((k) => k.kind === row.kind)?.placeholder}
                aria-label="Account ID"
              />

              <select
                value={row.clientId}
                onChange={(event) => update(index, { clientId: event.target.value })}
                className="input w-auto flex-1 py-1.5 text-[12px]"
                aria-label="Client"
              >
                <option value="">Choose client…</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>

              <button
                onClick={() => { setRows((prev) => prev.filter((_, i) => i !== index)); setSaved(false); }}
                className="btn btn-ghost btn-sm"
                aria-label="Remove mapping"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => { setRows((prev) => [...prev, { kind: kinds[0].kind, accountId: "", clientId: "" }]); setSaved(false); }}
        className="btn btn-ghost btn-sm -ml-2"
      >
        <Plus size={13} />
        Add account
      </button>

      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        {kinds.map((k) => `${k.label}: ${k.help}`).join(" · ")}
      </p>
    </div>
  );
}
