"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/server/actions";

/** The validated categorical order — see the note in client-manager.tsx. */
const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

export function NewClientDialog({ label = "New client" }: { label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [billingModel, setBillingModel] = useState("retainer");

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createClient({
        name: String(formData.get("name") ?? ""),
        engagement: String(formData.get("engagement") ?? "retainer"),
        color: String(formData.get("color") ?? PALETTE[0]),
        emailDomains: String(formData.get("emailDomains") ?? ""),
        billingModel,
        currency: String(formData.get("currency") ?? "NOK"),
        monthlyValue: Number(formData.get("monthlyValue") ?? 0) || undefined,
        hourlyRate: Number(formData.get("hourlyRate") ?? 0) || undefined,
        notes: String(formData.get("notes") ?? ""),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
      router.push(`/clients/${result.id}`);
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary">
        <Plus size={15} />
        {label}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-3 md:items-center" style={{ background: "oklch(0 0 0 / 0.55)" }}>
      <div className="card my-auto w-full max-w-[460px] p-5 rise">
        <h2 className="mb-4 text-[15px] font-semibold">New client</h2>
        <form action={submit} className="flex flex-col gap-3">
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" name="name" className="input" required autoFocus placeholder="Nattugla" />
          </div>

          <div className="grid grid-cols-2 gap-3">
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
              <label className="label" htmlFor="currency">Currency</label>
              <select id="currency" name="currency" className="input" defaultValue="NOK">
                {["NOK", "SEK", "DKK", "EUR", "USD", "GBP"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="billingModel">They pay</label>
              <select
                id="billingModel"
                name="billingModel"
                className="input"
                value={billingModel}
                onChange={(e) => setBillingModel(e.target.value)}
              >
                <option value="retainer">A fixed amount</option>
                <option value="hourly">By the hour</option>
              </select>
            </div>
            {billingModel === "hourly" ? (
              <div>
                <label className="label" htmlFor="hourlyRate">Hourly rate</label>
                <input id="hourlyRate" name="hourlyRate" type="number" className="input" placeholder="1500" />
              </div>
            ) : (
              <div>
                <label className="label" htmlFor="monthlyValue">Per month</label>
                <input id="monthlyValue" name="monthlyValue" type="number" className="input" placeholder="optional" />
              </div>
            )}
          </div>

          <div>
            <label className="label" htmlFor="emailDomains">Email domains</label>
            <input id="emailDomains" name="emailDomains" className="input" placeholder="nattugla.no" />
            <p className="mt-1.5 text-[11.5px] text-muted">
              Mail and meetings from these domains get filed here automatically.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="notes">What should you never forget about them?</label>
            <textarea id="notes" name="notes" className="input" rows={3} placeholder="What they sell, who decides, how they like to be talked to." />
          </div>

          <div>
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

          {error && <p className="text-[12.5px]" style={{ color: "var(--color-urgent)" }}>{error}</p>}

          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn">Cancel</button>
            <button type="submit" disabled={pending} className="btn btn-primary">Create client</button>
          </div>
        </form>
      </div>
    </div>
  );
}
