"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, UserPlus } from "lucide-react";
import { createClient, createStakeholder, logStakeholderContact } from "@/server/actions";
import { Card, CardTitle, Chip, ClientBadge, Empty } from "./ui";

type Person = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  cadence: number;
  receivesReports: boolean;
  lastContactAt: string | null;
};

type ClientInfo = {
  id: string;
  name: string;
  color: string;
  engagement: string;
  emailDomains: string[];
  stakeholders: Person[];
};

/**
 * Client colour is the one place hue carries identity, so these are not picked
 * by eye. This is a validated categorical order — every adjacent pair clears the
 * colour-blind separation floor in both themes (checked with the dataviz
 * validator). Client names always appear alongside, so hue never works alone.
 */
const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

export function ClientManager({ clients }: { clients: ClientInfo[] }) {
  const router = useRouter();
  const [addingClient, setAddingClient] = useState(false);
  const [addingPersonTo, setAddingPersonTo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submitClient(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createClient({
        name: String(formData.get("name") ?? ""),
        engagement: String(formData.get("engagement") ?? "retainer"),
        color: String(formData.get("color") ?? PALETTE[0]),
        emailDomains: String(formData.get("emailDomains") ?? ""),
        billingModel: String(formData.get("billingModel") ?? "retainer"),
        currency: String(formData.get("currency") ?? "NOK"),
        monthlyValue: Number(formData.get("monthlyValue") ?? 0) || undefined,
        hourlyRate: Number(formData.get("hourlyRate") ?? 0) || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAddingClient(false);
      router.refresh();
    });
  }

  function submitPerson(clientId: string, formData: FormData) {
    startTransition(async () => {
      await createStakeholder({
        clientId,
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        role: String(formData.get("role") ?? ""),
        contactCadenceDays: Number(formData.get("cadence") ?? 0),
        receivesReports: formData.get("receivesReports") === "on",
      });
      setAddingPersonTo(null);
      router.refresh();
    });
  }

  return (
    <section>
      <CardTitle
        action={
          <button onClick={() => setAddingClient(!addingClient)} className="btn btn-sm btn-primary">
            <Plus size={13} />
            New client
          </button>
        }
      >
        Clients
      </CardTitle>

      {addingClient && (
        <Card className="mb-3">
          <form action={submitClient} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="name">Name</label>
              <input id="name" name="name" className="input" required autoFocus />
            </div>
            <div>
              <label className="label" htmlFor="engagement">Engagement</label>
              <select id="engagement" name="engagement" className="input">
                <option value="retainer">Retainer</option>
                <option value="project">Project</option>
                <option value="advisory">Advisory / fractional</option>
                <option value="internal">Internal</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="emailDomains">Email domains</label>
              <input id="emailDomains" name="emailDomains" className="input" placeholder="acme.com, acme.dk" />
              <p className="mt-1.5 text-[11.5px] text-muted">Mail and meetings from these domains get filed under this client automatically.</p>
            </div>
            <div>
              <label className="label" htmlFor="currency">Currency</label>
              <select id="currency" name="currency" className="input" defaultValue="NOK">
                {["NOK", "SEK", "DKK", "EUR", "USD", "GBP"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="billingModel">They pay</label>
              <select id="billingModel" name="billingModel" className="input" defaultValue="retainer">
                <option value="retainer">A fixed amount</option>
                <option value="hourly">By the hour</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="monthlyValue">Per month</label>
              <input id="monthlyValue" name="monthlyValue" type="number" className="input" placeholder="45000" />
            </div>
            <div>
              <label className="label" htmlFor="hourlyRate">Hourly rate</label>
              <input id="hourlyRate" name="hourlyRate" type="number" className="input" placeholder="1500" />
              <p className="mt-1.5 text-[11.5px] text-muted">Fill in whichever matches how they pay. You can change it later on the client page.</p>
            </div>
            <div className="sm:col-span-2">
              <span className="label">Colour</span>
              <div className="flex flex-wrap gap-1.5">
                {PALETTE.map((color, index) => (
                  <label key={color} className="cursor-pointer">
                    <input type="radio" name="color" value={color} defaultChecked={index === 0} className="peer sr-only" />
                    <span
                      className="block h-7 w-7 rounded-full ring-offset-2 peer-checked:ring-2"
                      style={{ background: color, "--tw-ring-color": color, "--tw-ring-offset-color": "var(--surface)" } as React.CSSProperties}
                    />
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="text-[12.5px] sm:col-span-2" style={{ color: "var(--color-urgent)" }}>{error}</p>}

            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" onClick={() => setAddingClient(false)} className="btn">Cancel</button>
              <button type="submit" disabled={pending} className="btn btn-primary">Add client</button>
            </div>
          </form>
        </Card>
      )}

      {clients.length === 0 && !addingClient ? (
        <Card>
          <Empty title="No clients yet" hint="Add your clients first — everything else in Marketing HQ hangs off them." />
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {clients.map((client) => (
            <Card key={client.id}>
              <div className="flex flex-wrap items-center gap-2">
                <ClientBadge name={client.name} color={client.color} size="md" />
                <Chip tone="neutral">{client.engagement}</Chip>
                {client.emailDomains.length > 0 && (
                  <span className="text-[11.5px] text-muted">{client.emailDomains.join(", ")}</span>
                )}
                <button
                  onClick={() => setAddingPersonTo(addingPersonTo === client.id ? null : client.id)}
                  className="btn btn-ghost btn-sm ml-auto"
                >
                  <UserPlus size={13} />
                  Add person
                </button>
              </div>

              {client.stakeholders.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5 border-t pt-3">
                  {client.stakeholders.map((person) => {
                    const since = person.lastContactAt
                      ? Math.floor((Date.now() - new Date(person.lastContactAt).getTime()) / 86_400_000)
                      : null;
                    const overdue = person.cadence > 0 && (since === null || since > person.cadence);

                    return (
                      <li key={person.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                        <span className="font-medium">{person.name}</span>
                        {person.role && <span className="text-muted">{person.role}</span>}
                        {person.receivesReports && <Chip tone="brand">reports</Chip>}
                        {person.cadence > 0 && (
                          <Chip tone={overdue ? "warn" : "neutral"}>
                            every {person.cadence}d
                            {since !== null ? ` · ${since}d ago` : " · never"}
                          </Chip>
                        )}
                        <button
                          onClick={() => startTransition(async () => { await logStakeholderContact(person.id); router.refresh(); })}
                          className="btn btn-ghost btn-sm ml-auto"
                          title="Reset the clock — I spoke to them today"
                        >
                          log contact
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {addingPersonTo === client.id && (
                <form action={(fd) => submitPerson(client.id, fd)} className="mt-3 grid gap-2.5 border-t pt-3 sm:grid-cols-2">
                  <input name="name" className="input" placeholder="Name" required autoFocus />
                  <input name="role" className="input" placeholder="Role — e.g. CMO" />
                  <input name="email" type="email" className="input" placeholder="Email" />
                  <input name="cadence" type="number" min={0} className="input" placeholder="Contact every N days (0 = off)" />
                  <label className="flex items-center gap-2 text-[12.5px]">
                    <input type="checkbox" name="receivesReports" className="h-4 w-4" />
                    Gets the reports
                  </label>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setAddingPersonTo(null)} className="btn btn-sm">Cancel</button>
                    <button type="submit" disabled={pending} className="btn btn-sm btn-primary">Add</button>
                  </div>
                </form>
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
