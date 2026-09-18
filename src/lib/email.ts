import { env } from "@/lib/env";

/**
 * Sending mail, over Resend's HTTP API.
 *
 * Nothing in the app could send anything before this: the Gmail and Outlook
 * connections are read-only, and asking for send scopes means another consent
 * round that cannot happen while APP_URL still points at localhost. A
 * transactional provider sidesteps all of it — one key, one POST, no OAuth.
 */
const ENDPOINT = "https://api.resend.com/emails";

/** Resend's shared sender, which works without verifying a domain first. */
const DEFAULT_FROM = "Marketing HQ <onboarding@resend.dev>";

export type MailResult = { ok: true; id: string } | { ok: false; error: string };

export function canSendEmail(): boolean {
  return Boolean(env.resendKey && env.ownerEmail);
}

/** Why it cannot send, in words worth putting on a settings page. */
export function emailBlocker(): string | null {
  if (!env.resendKey) return "RESEND_API_KEY is not set, so nothing can be sent.";
  if (!env.ownerEmail) return "OWNER_EMAIL is not set, so there is nowhere to send it.";
  return null;
}

export async function sendEmail(input: {
  subject: string;
  html: string;
  text: string;
  to?: string;
}): Promise<MailResult> {
  const blocker = emailBlocker();
  if (blocker) return { ok: false, error: blocker };

  const to = input.to ?? env.ownerEmail!;

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.emailFrom || DEFAULT_FROM,
        to: [to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!response.ok) {
      // Resend answers with a JSON body describing the refusal; the status
      // alone ("422") tells you nothing about which field it disliked.
      const body = await response.text();
      let detail = body.slice(0, 200);
      try {
        const parsed = JSON.parse(body) as { message?: string; error?: string };
        detail = parsed.message ?? parsed.error ?? detail;
      } catch {
        /* not JSON — the raw body is the best we have */
      }
      return { ok: false, error: `Resend rejected it (${response.status}): ${detail}` };
    }

    const { id } = (await response.json()) as { id: string };
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
