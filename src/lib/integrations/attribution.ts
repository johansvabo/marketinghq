import { db } from "@/lib/db";
import { clients, type Client } from "@/lib/db/schema";

/**
 * Works out which client a message or meeting belongs to, from the email
 * domains on the participants. Falls back to a fuzzy name match on the subject
 * so "Acme kickoff" lands on Acme even when everyone in the room is internal.
 */
export class ClientMatcher {
  private byDomain = new Map<string, Client>();
  private byName: { needle: string; client: Client }[] = [];

  static async load(): Promise<ClientMatcher> {
    const matcher = new ClientMatcher();
    const rows = await db.select().from(clients);
    for (const client of rows) {
      for (const domain of client.emailDomains ?? []) {
        matcher.byDomain.set(domain.toLowerCase().replace(/^@/, ""), client);
      }
      matcher.byName.push({ needle: client.name.toLowerCase(), client });
    }
    return matcher;
  }

  fromEmails(emails: (string | null | undefined)[]): Client | null {
    for (const email of emails) {
      if (!email) continue;
      const domain = email.split("@")[1]?.toLowerCase();
      if (domain && this.byDomain.has(domain)) return this.byDomain.get(domain)!;
    }
    return null;
  }

  fromText(text: string | null | undefined): Client | null {
    if (!text) return null;
    const haystack = text.toLowerCase();
    for (const { needle, client } of this.byName) {
      if (needle.length >= 3 && haystack.includes(needle)) return client;
    }
    return null;
  }

  match(opts: { emails?: (string | null | undefined)[]; text?: string | null }): Client | null {
    return this.fromEmails(opts.emails ?? []) ?? this.fromText(opts.text);
  }
}

/** Domains that never identify a client — free mail and our own tooling. */
export const GENERIC_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
]);

export function isExternalAttendee(email: string, ownDomains: string[]): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return !ownDomains.includes(domain);
}
