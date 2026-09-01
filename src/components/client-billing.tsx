"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Client } from "@/lib/db/schema";
import { updateClient } from "@/server/actions";
import { Card, CardTitle } from "./ui";

const CURRENCIES = ["NOK", "SEK", "DKK", "EUR", "USD", "GBP"];

/** How this client is billed, which is what makes the value figure mean anything. */
export function ClientBilling({ client }: { client: Client }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [model, setModel] = useState(client.billingModel);
  const [pending, startTransition] = useTransition();

  function save(fd: FormData) {
    startTransition(async () => {
      await updateClient(client.id, {
        billingModel: model,
        currency: String(fd.get("currency") ?? "NOK"),
        monthlyValue: Number(fd.get("monthlyValue") ?? 0) || null,
        hourlyRate: Number(fd.get("hourlyRate") ?? 0) || null,
      });
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <Card>
        <CardTitle action={<button onClick={() => setEditing(true)} className="btn btn-ghost btn-sm">Edit</button>}>
          Billing
        </CardTitle>
        <p className="text-[13px] text-soft">
          {client.billingModel === "hourly"
            ? client.hourlyRate
              ? `${client.currency} ${client.hourlyRate.toLocaleString("nb-NO")} per hour`
              : "Hourly — no rate set yet"
            : client.monthlyValue
              ? `${client.currency} ${client.monthlyValue.toLocaleString("nb-NO")} a month`
              : "Retainer — no amount set yet"}
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>Billing</CardTitle>
      <form action={save} className="flex flex-col gap-3">
        <div>
          <span className="label">How they pay</span>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setModel("retainer")} className={`btn btn-sm ${model === "retainer" ? "btn-primary" : ""}`}>
              Retainer
            </button>
            <button type="button" onClick={() => setModel("hourly")} className={`btn btn-sm ${model === "hourly" ? "btn-primary" : ""}`}>
              By the hour
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="currency">Currency</label>
            <select id="currency" name="currency" className="input" defaultValue={client.currency}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          {model === "hourly" ? (
            <div>
              <label className="label" htmlFor="hourlyRate">Hourly rate</label>
              <input id="hourlyRate" name="hourlyRate" type="number" defaultValue={client.hourlyRate ?? ""} className="input" placeholder="1500" />
            </div>
          ) : (
            <div>
              <label className="label" htmlFor="monthlyValue">Per month</label>
              <input id="monthlyValue" name="monthlyValue" type="number" defaultValue={client.monthlyValue ?? ""} className="input" placeholder="45000" />
            </div>
          )}
        </div>

        <p className="text-[11.5px] leading-relaxed text-muted">
          {model === "hourly"
            ? "Monthly value is calculated from the billable hours you log, so it only ever shows work actually done."
            : "Monthly value is the retainer. Hours are still tracked, so you can see whether it is being earned."}
        </p>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(false)} className="btn btn-sm">Cancel</button>
          <button type="submit" disabled={pending} className="btn btn-sm btn-primary">Save</button>
        </div>
      </form>
    </Card>
  );
}
