import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, connections, stakeholders, syncRuns } from "@/lib/db/schema";
import { env, isConfigured } from "@/lib/env";
import { systemHealth, type HealthState } from "@/lib/health";
import { modelStatus } from "@/lib/ai/client";
import { ModelPicker } from "@/components/model-picker";
import { PROVIDERS, type ProviderId } from "@/lib/integrations/oauth";
import { relativeDay } from "@/lib/dates";
import { Card, CardTitle, Chip, ClientDot, Empty, PageHeader } from "@/components/ui";
import { ConnectionRow } from "@/components/connection-row";
import { ClientManager } from "@/components/client-manager";

export const dynamic = "force-dynamic";

const STATE_COLOR: Record<HealthState, string> = {
  ok: "var(--color-good)",
  warn: "var(--color-warn)",
  error: "var(--color-urgent)",
};

type SettingsData = {
  connectionRows: (typeof connections.$inferSelect)[];
  clientRows: (typeof clients.$inferSelect)[];
  stakeholderRows: (typeof stakeholders.$inferSelect)[];
  recentSyncs: (typeof syncRuns.$inferSelect)[];
  failed: boolean;
};

const EMPTY: SettingsData = {
  connectionRows: [],
  clientRows: [],
  stakeholderRows: [],
  recentSyncs: [],
  failed: true,
};

async function loadSettingsData(): Promise<SettingsData> {
  try {
    const [connectionRows, clientRows, stakeholderRows, recentSyncs] = await Promise.all([
      db.select().from(connections),
      db.select().from(clients).orderBy(clients.name),
      db.select().from(stakeholders),
      db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(12),
    ]);
    return { connectionRows, clientRows, stakeholderRows, recentSyncs, failed: false };
  } catch {
    // The health panel above already says why, in terms you can act on.
    return EMPTY;
  }
}

export default async function SettingsPage() {
  // This is the page you come to when things are broken, so it must not need a
  // working database to render. The health panel is computed defensively and
  // everything else degrades to empty rather than throwing the whole page away.
  const health = await systemHealth();
  const problems = health.filter((c) => c.state !== "ok");
  const model = isConfigured.anthropic() ? await modelStatus() : null;

  const data = await loadSettingsData();
  const { connectionRows, clientRows, stakeholderRows, recentSyncs } = data;

  const byProvider = new Map(connectionRows.map((c) => [c.provider, c]));


  return (
    <>
      <PageHeader title="Settings" subtitle="Connections, clients and the health of the machinery behind all of it" />

      {data.failed && (
        <Card tone="urgent" className="mb-4">
          <p className="text-[13px] font-semibold">The database could not be read</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-soft">
            The rest of this page is empty because of it, and other pages will show an error. The System panel below says
            what to fix. Nothing has been lost — this is a connection problem, not a data one.
          </p>
        </Card>
      )}

      <div className="mb-5 grid gap-3 md:grid-cols-2">
        <Card tone={problems.some((c) => c.state === "error") ? "urgent" : undefined}>
          <CardTitle
            action={
              <span className="text-[11.5px]" style={{ color: problems.length ? "var(--color-warn)" : "var(--color-good)" }}>
                {problems.length === 0 ? "all good" : `${problems.length} to look at`}
              </span>
            }
          >
            System
          </CardTitle>
          <ul className="flex flex-col gap-2">
            {health.map((item) => (
              <li key={item.label}>
                <div className="flex items-center gap-2.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATE_COLOR[item.state] }} />
                  <span className="text-[13px] font-medium">{item.label}</span>
                  {item.label === "Claude" && model ? (
                    <span className="ml-auto">
                      <ModelPicker current={model.id} isOverride={model.isOverride} />
                    </span>
                  ) : (
                    <span className="ml-auto truncate pl-2 text-[11.5px] text-muted">{item.hint}</span>
                  )}
                </div>
                {item.label === "Claude" && model?.isOverride && (
                  <p className="mt-1 pl-4 text-[11.5px] text-muted">
                    Overridden from the default. Worth switching back once things are normal again.
                  </p>
                )}
                {item.fix && (
                  <p className="mt-1 pl-4 text-[11.5px] leading-relaxed" style={{ color: STATE_COLOR[item.state] }}>
                    {item.fix}
                  </p>
                )}
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
