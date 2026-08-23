"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { createReportSchedule } from "@/server/actions";
import type { Cadence } from "@/lib/reporting/schedule";

const SOURCES = [
  { value: "ga4", label: "GA4" },
  { value: "meta", label: "Meta" },
  { value: "google_ads", label: "Google Ads" },
  { value: "linkedin", label: "LinkedIn" },
];

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function NewScheduleDialog({ clients }: { clients: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [sources, setSources] = useState<string[]>(["ga4", "meta"]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const weekly = cadence === "weekly" || cadence === "biweekly";

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createReportSchedule({
        clientId: String(formData.get("clientId") ?? ""),
        name: String(formData.get("name") ?? ""),
        cadence,
        dayOf: Number(formData.get("dayOf") ?? 1),
        leadDays: Number(formData.get("leadDays") ?? 3),
        sources,
        template: String(formData.get("template") ?? ""),
        recipients: String(formData.get("recipients") ?? ""),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary">
        <CalendarClock size={15} />
        New cadence
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-3 md:items-center" style={{ background: "oklch(0 0 0 / 0.55)" }}>
      <div className="card my-auto w-full max-w-[480px] p-5 rise">
        <h2 className="mb-1 text-[15px] font-semibold">New report cadence</h2>
        <p className="mb-4 text-[12.5px] text-muted">
          Marketing HQ will queue each report, remind you ahead of the deadline, and pull the numbers into a draft.
        </p>

        <form action={submit} className="flex flex-col gap-3">
          <div>
            <label className="label" htmlFor="clientId">Client</label>
            <select id="clientId" name="clientId" className="input" required>
              <option value="">Choose…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="name">What is it called?</label>
            <input id="name" name="name" className="input" placeholder="Monthly performance report" defaultValue="Monthly performance report" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="cadence">Cadence</label>
              <select id="cadence" className="input" value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every two weeks</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="dayOf">{weekly ? "Day of week" : "Day of month"}</label>
              {weekly ? (
                <select id="dayOf" name="dayOf" className="input" defaultValue="1">
                  {WEEKDAYS.map((day, index) => (
                    <option key={day} value={index + 1}>{day}</option>
                  ))}
                </select>
              ) : (
                <input id="dayOf" name="dayOf" type="number" min={1} max={28} defaultValue={3} className="input" />
              )}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="leadDays">Remind me this many days ahead</label>
            <input id="leadDays" name="leadDays" type="number" min={0} max={14} defaultValue={3} className="input" />
          </div>

          <div>
            <span className="label">Pull numbers from</span>
            <div className="flex flex-wrap gap-1.5">
              {SOURCES.map((source) => (
                <button
                  key={source.value}
                  type="button"
                  onClick={() =>
                    setSources((prev) => (prev.includes(source.value) ? prev.filter((s) => s !== source.value) : [...prev, source.value]))
                  }
                  className={`btn btn-sm ${sources.includes(source.value) ? "btn-primary" : ""}`}
                >
                  {source.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="recipients">Who gets it</label>
            <input id="recipients" name="recipients" className="input" placeholder="anna@client.com, cmo@client.com" />
          </div>

          <div>
            <label className="label" htmlFor="template">What must this report always cover?</label>
            <textarea
              id="template"
              name="template"
              className="input"
              rows={3}
              placeholder="Pipeline contribution by channel. Always compare against the quarterly target. They care about cost per SQL, not CPL."
            />
          </div>

          {error && <p className="text-[12.5px]" style={{ color: "var(--color-urgent)" }}>{error}</p>}

          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn">Cancel</button>
            <button type="submit" disabled={pending} className="btn btn-primary">Create cadence</button>
          </div>
        </form>
      </div>
    </div>
  );
}
