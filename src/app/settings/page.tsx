import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, connections, stakeholders, syncRuns } from "@/lib/db/schema";
import { env, isConfigured } from "@/lib/env";
import { PROVIDERS, type ProviderId } from "@/lib/integrations/oauth";
import { relativeDay } from "@/lib/dates";
import { Card, CardTitle, Chip, ClientDot, Empty, PageHeader } from "@/components/ui";
import { ConnectionRow } from "@/components/connection-row";
import { ClientManager } from "@/components/client-manager";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [connectionRows, clientRows, stakeholderRows, recentSyncs] = await Promise.all([
    db.select().from(connections),
    db.select().from(clients).orderBy(clients.name),
    db.select().from(stakeholders),
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(12),
  ]);

  const byProvider = new Map(connectionRows.map((c) => [c.provider, c]));

  const readiness = [
    { label: "Database", ok: true, hint: env.tursoUrl ? "Turso (hosted)" : "local SQLite file" },
    { label: "Claude", ok: isConfigured.anthropic(), hint: isConfigured.anthropic() ? env.anthropicModel : "set ANTHROPIC_API_KEY" },
    { label: "Token encryption", ok: Boolean(env.encryptionKey), hint: env.encryptionKey ? "AES-256-GCM at rest" : "set ENCRYPTION_KEY before connecting accounts" },
    { label: "Passcode lock", ok: Boolean(env.authSecret), hint: env.authSecret ? "on" : "set AUTH_SECRET before deploying" },
    { label: "Scheduled runs", ok: Boolean(env.cronSecret), hint: env.cronSecret ? "CRON_SECRET set" : "set CRON_SECRET to enable the nightly job" },
  ];

  return (
    <>
      <PageHeader title="Settings" subtitle="Connections, clients and the health of the machinery behind all of it" />

      <div className="mb-5 grid gap-3 md:grid-cols-2">
        <Card>
          <CardTitle>System</CardTitle>
          <ul className="flex flex-col gap-2">
            {readiness.map((item) => (
              <li key={item.label} className="flex items-center gap-2.5">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: item.ok ? "var(--color-good)" : "var(--color-warn)" }}
                />
                <span className="text-[13px] font-medium">{item.label}</span>
                <span className="ml-auto text-[11.5px] text-muted">{item.hint}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle>Recent syncs</CardTitle>
          {recentSyncs.length === 0 ? (
            <p className="text-[12.5px] text-muted">Nothing has run yet. Connect an account, then hit sync.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {recentSyncs.map((run) => (
                <li key={run.id} className="flex items-center gap-2.5 text-[12.5px]">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: run.status === "ok" ? "var(--color-good)" : run.status === "skipped" ? "var(--ink-muted)" : "var(--color-urgent)" }}
                  />
                  <span className="font-medium">{run.source}</span>
                  <span className="text-muted">{run.status === "ok" ? `${run.itemsWritten} rows` : run.message?.slice(0, 60)}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted">{relativeDay(run.startedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section className="mb-5">
        <CardTitle>Connections</CardTitle>
        <div className="grid gap-2.5 md:grid-cols-2">
          {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
            <ConnectionRow
              key={id}
              provider={id}
              label={PROVIDERS[id].label}
              blurb={PROVIDERS[id].blurb}
              configured={PROVIDERS[id].configured()}
              clients={clientRows.map((c) => ({ id: c.id, name: c.name }))}
              connection={
                byProvider.get(id)
                  ? {
                      id: byProvider.get(id)!.id,
                      displayName: byProvider.get(id)!.displayName,
                      status: byProvider.get(id)!.status,
                      lastSyncedAt: byProvider.get(id)!.lastSyncedAt?.toISOString() ?? null,
                      lastError: byProvider.get(id)!.lastError,
                      accounts: byProvider.get(id)!.config?.accounts ?? [],
                    }
                  : null
              }
            />
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          GA4 and Google Ads ride on the Google connection. Map each property and ad account to a client above — until you
          do, there is nothing for the sync to attribute and it writes nothing. See{" "}
          <code className="rounded bg-[var(--raised)] px-1">SETUP.md</code> for where to find each ID.
        </p>
      </section>

      <ClientManager
        clients={clientRows.map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          engagement: c.engagement,
          emailDomains: c.emailDomains ?? [],
          stakeholders: stakeholderRows
            .filter((s) => s.clientId === c.id)
            .map((s) => ({
              id: s.id,
              name: s.name,
              role: s.role,
              email: s.email,
              cadence: s.contactCadenceDays,
              receivesReports: s.receivesReports,
              lastContactAt: s.lastContactAt?.toISOString() ?? null,
            })),
        }))}
      />
    </>
  );
}
