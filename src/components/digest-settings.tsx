"use client";

import { useState, useTransition } from "react";
import { Mail } from "lucide-react";
import { sendDigestNow } from "@/server/actions";
import { Card, CardTitle } from "./ui";

export function DigestSettings({ to, blocker }: { to: string | null; blocker: string | null }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  return (
    <Card>
      <CardTitle
        action={
          !blocker && (
            <button
              onClick={() => {
                setMessage(null);
                startTransition(async () => {
                  const result = await sendDigestNow();
                  setOk(result.ok);
                  setMessage(
                    result.ok
                      ? `Sent — ${result.pieces} ${result.pieces === 1 ? "piece" : "pieces"} in it. Check your inbox.`
                      : result.error,
                  );
                });
              }}
              disabled={pending}
              className="btn btn-ghost btn-sm"
            >
              {pending ? "Sending…" : "Send one now"}
            </button>
          )
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <Mail size={12} />
          Weekly email
        </span>
      </CardTitle>

      {blocker ? (
        <>
          <p className="text-[12.5px] leading-relaxed text-soft">
            The team&apos;s scheduled work is not being emailed to you. {blocker}
          </p>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
            Add <code>RESEND_API_KEY</code> (a free key from resend.com) and <code>OWNER_EMAIL</code> to the
            environment variables in Vercel, then redeploy. Nothing sends until both are set.
          </p>
        </>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-soft">
          Once a week, everything the team produced goes to <strong>{to}</strong> — a short read on the week, then a
          line per piece with who wrote it and what it says. It only sends when there is something to send.
        </p>
      )}

      {message && (
        <p className="mt-2 text-[12px]" style={{ color: ok ? "var(--color-good)" : "var(--color-urgent)" }}>
          {message}
        </p>
      )}
    </Card>
  );
}
