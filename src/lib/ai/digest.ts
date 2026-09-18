import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefings, clients, settings } from "@/lib/db/schema";
import { env, isConfigured } from "@/lib/env";
import { canSendEmail, sendEmail, type MailResult } from "@/lib/email";
import { AGENTS, type AgentKey } from "./agents";
import { generate } from "./brain";

/**
 * The weekly note about what the team did while you were not looking.
 *
 * Scheduled briefings were produced, filed on a page, and then waited to be
 * found. This turns them into something that arrives: one email, a line per
 * piece with who wrote it and what it says, and a short read on the week as
 * a whole.
 */

const SENT_KEY = "digest:last-sent";

const SUMMARY_SYSTEM = `You write the opening paragraph of a weekly digest for an independent marketing consultant.

You are given what his team of specialists produced this week. Write three to five sentences telling him what is worth his attention, in his own working language (Norwegian).

Lead with the thing that changes a decision. Name clients and specialists directly. If two pieces point the same way, say so. If the week produced nothing that matters, say that in one line rather than padding it — a digest that always sounds important teaches him to stop reading it.

No preamble, no headings, no bullet points, no sign-off. Just the paragraph.`;

export type DigestPiece = {
  id: string;
  title: string;
  agentKey: string;
  agentName: string;
  clientName: string | null;
  body: string;
};

export async function digestSince(since: Date): Promise<DigestPiece[]> {
  const rows = await db
    .select({ briefing: briefings, clientName: clients.name })
    .from(briefings)
    .leftJoin(clients, eq(briefings.clientId, clients.id))
    .where(and(eq(briefings.status, "ready"), gte(briefings.completedAt, since)))
    .orderBy(desc(briefings.completedAt))
    .limit(40);

  return rows
    .filter((r) => r.briefing.body)
    .map((r) => ({
      id: r.briefing.id,
      title: r.briefing.title ?? "Untitled",
      agentKey: r.briefing.agentKey,
      agentName: AGENTS[r.briefing.agentKey as AgentKey]?.name ?? r.briefing.agentKey,
      clientName: r.clientName,
      body: r.briefing.body!,
    }));
}

/**
 * Each piece's opening, as the line under its title. Taken from the text
 * rather than generated: forty extra model calls to paraphrase headings the
 * specialists already wrote would cost more than the digest is worth.
 */
function excerpt(body: string, limit = 240): string {
  const firstProse = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 40 && !line.startsWith("#") && !line.startsWith("|"));

  const text = (firstProse ?? body).replace(/[*_`#>]/g, "").trim();
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

async function executiveSummary(pieces: DigestPiece[]): Promise<string | null> {
  if (!isConfigured.anthropic() || pieces.length === 0) return null;

  const material = pieces
    .map((p) => `### ${p.agentName}${p.clientName ? ` — ${p.clientName}` : ""}: ${p.title}\n\n${p.body.slice(0, 2500)}`)
    .join("\n\n---\n\n");

  try {
    /*
     * Low effort and a tight ceiling on purpose. This is a paragraph over
     * material that has already been written and paid for once — running it
     * at full depth would make the summary of the week cost more than some of
     * the pieces it summarises.
     */
    return await generate({
      system: SUMMARY_SYSTEM,
      prompt: `Here is what the team produced this week.\n\n${material}`,
      effort: "low",
      maxTokens: 900,
      surface: "brief",
    });
  } catch {
    // A digest without its summary is still worth sending.
    return null;
  }
}

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderDigest(pieces: DigestPiece[], summary: string | null, appUrl: string) {
  const subject =
    pieces.length === 1
      ? `Teamet leverte 1 sak: ${pieces[0].title}`
      : `Teamet leverte ${pieces.length} saker denne uka`;

  const intro = summary ?? "Her er hva teamet produserte denne uka.";

  const items = pieces
    .map(
      (p) => `
      <tr>
        <td style="padding:14px 0;border-top:1px solid #e6e6e9;">
          <div style="font:600 15px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#17171a;">
            ${escape(p.title)}
          </div>
          <div style="font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#77777f;margin-top:3px;">
            ${escape(p.agentName)}${p.clientName ? ` · ${escape(p.clientName)}` : ""}
          </div>
          <div style="font:400 13.5px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#44444c;margin-top:7px;">
            ${escape(excerpt(p.body))}
          </div>
        </td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="no"><body style="margin:0;padding:24px 12px;background:#f4f4f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:26px 24px;">
    <tr><td>
      <div style="font:700 19px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#17171a;">
        ${escape(subject)}
      </div>
      <div style="font:400 14px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#44444c;margin-top:12px;white-space:pre-wrap;">
        ${escape(intro)}
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
        ${items}
      </table>
      <div style="margin-top:22px;">
        <a href="${escape(appUrl)}/team" style="display:inline-block;background:#17171a;color:#ffffff;text-decoration:none;font:600 13.5px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:10px 16px;border-radius:9px;">
          Les alt i Marketing HQ
        </a>
      </div>
      <div style="font:400 11.5px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#9a9aa2;margin-top:18px;">
        Dette er teamets planlagte arbeid. Slå det av eller ned under Innstillinger.
      </div>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    subject,
    "",
    intro,
    "",
    ...pieces.map((p) => `— ${p.title} (${p.agentName}${p.clientName ? `, ${p.clientName}` : ""})\n  ${excerpt(p.body)}`),
    "",
    `${appUrl}/team`,
  ].join("\n");

  return { subject, html, text };
}

/**
 * Sends the digest if there is anything to send and it has not gone out
 * already. The last-sent stamp is what stops three cron runs on the same day
 * mailing the same week three times.
 */
export async function sendWeeklyDigest(
  now = new Date(),
  opts: { force?: boolean } = {},
): Promise<{ sent: false; reason: string } | { sent: true; pieces: number; result: MailResult }> {
  if (!canSendEmail()) return { sent: false, reason: "Email is not configured." };

  const [row] = await db.select().from(settings).where(eq(settings.key, SENT_KEY)).limit(1);
  const lastSent = (row?.value as { at?: number } | null)?.at ?? 0;

  const weekMs = 7 * 24 * 60 * 60 * 1000;
  if (!opts.force && now.getTime() - lastSent < 6 * 24 * 60 * 60 * 1000) {
    return { sent: false, reason: "Already sent within the last six days." };
  }

  const since = new Date(Math.max(lastSent, now.getTime() - weekMs));
  const pieces = await digestSince(since);
  if (pieces.length === 0) return { sent: false, reason: "The team produced nothing this week." };

  const summary = await executiveSummary(pieces);
  const { subject, html, text } = renderDigest(pieces, summary, env.appUrl);
  const result = await sendEmail({ subject, html, text });

  if (result.ok) {
    await db
      .insert(settings)
      .values({ key: SENT_KEY, value: { at: now.getTime() } })
      .onConflictDoUpdate({ target: settings.key, set: { value: { at: now.getTime() } } });
  }

  return { sent: true, pieces: pieces.length, result };
}

/** Unread count, for the nudge on the front page. */
export async function unreadBriefingCount(): Promise<number> {
  const rows = await db
    .select({ id: briefings.id })
    .from(briefings)
    .where(and(eq(briefings.status, "ready"), isNull(briefings.readAt)));
  return rows.length;
}
