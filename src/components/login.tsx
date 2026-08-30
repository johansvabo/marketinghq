"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";

export function LoginScreen({ configWarning }: { configWarning?: string | null }) {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode }),
    });

    setBusy(false);
    if (!response.ok) {
      setError("That passcode doesn't match.");
      setPasscode("");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-5">
      <div className="card w-full max-w-[360px] p-6 rise">
        <div className="mb-5 flex items-center gap-2.5">
          <span
            className="grid h-9 w-9 place-items-center rounded-[10px] text-[13px] font-black"
            style={{ background: "var(--color-brand)", color: "var(--color-brand-ink)" }}
          >
            HQ
          </span>
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">Marketing HQ</h1>
            <p className="text-[12px] text-muted">Private workspace</p>
          </div>
        </div>

        {configWarning && (
          <div
            className="mb-4 rounded-[10px] p-3"
            style={{
              background: "color-mix(in oklch, var(--color-urgent) 12%, var(--surface))",
              border: "1px solid color-mix(in oklch, var(--color-urgent) 30%, transparent)",
            }}
          >
            <p className="text-[12.5px] font-semibold" style={{ color: "var(--color-urgent)" }}>
              No passcode will work
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-soft">
              AUTH_SECRET {configWarning} Fix it where you set your environment variables, redeploy, and this notice
              will disappear.
            </p>
          </div>
        )}

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="label" htmlFor="passcode">Passcode</label>
            <input
              id="passcode"
              type="password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              className="input"
              autoFocus
              autoComplete="current-password"
            />
          </div>

          {error && <p className="text-[12.5px]" style={{ color: "var(--color-urgent)" }}>{error}</p>}

          <button type="submit" disabled={busy || !passcode} className="btn btn-primary w-full">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Lock size={14} />}
            Unlock
          </button>
        </form>
      </div>
    </div>
  );
}
