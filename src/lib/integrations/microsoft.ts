import { db } from "@/lib/db";
import { calendarEvents, messages, type Connection } from "@/lib/db/schema";
import { addDays, subDays } from "@/lib/dates";
import { accessTokenFor } from "./oauth";
import { ClientMatcher, GENERIC_DOMAINS } from "./attribution";

async function graph<T>(connection: Connection, path: string): Promise<T> {
  const token = await accessTokenFor(connection);
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Microsoft Graph ${res.status} on ${path.split("?")[0]}: ${(await res.text()).slice(0, 400)}`);
  return res.json() as Promise<T>;
}

type GraphMessage = {
  id: string;
  conversationId: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime: string;
  from?: { emailAddress: { name?: string; address: string } };
  toRecipients?: { emailAddress: { address: string } }[];
  isDraft: boolean;
};

export async function syncOutlookMail(connection: Connection, opts: { days?: number } = {}): Promise<number> {
  const days = opts.days ?? 14;
  const since = subDays(new Date(), days).toISOString();
  const matcher = await ClientMatcher.load();
  const ownEmail = connection.externalId.toLowerCase();

  const inbox = await graph<{ value: GraphMessage[] }>(
    connection,
    `/me/mailFolders/inbox/messages?$top=80&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${since}&$select=id,conversationId,subject,bodyPreview,receivedDateTime,from,toRecipients,isDraft`,
  );

  const sent = await graph<{ value: GraphMessage[] }>(
    connection,
    `/me/mailFolders/sentitems/messages?$top=80&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${since}&$select=id,conversationId`,
  );
  const repliedThreads = new Set(sent.value.map((m) => m.conversationId));

  let written = 0;

  for (const item of inbox.value) {
    if (item.isDraft) continue;

    const fromEmail = item.from?.emailAddress.address?.toLowerCase();
    const to = (item.toRecipients ?? []).map((r) => r.emailAddress.address.toLowerCase());
    const isFromMe = fromEmail === ownEmail;

    const client = matcher.match({
      emails: [fromEmail, ...to].filter((e) => e && !GENERIC_DOMAINS.has(e.split("@")[1] ?? "")),
      text: item.subject,
    });

    const awaitingReply = !isFromMe && !repliedThreads.has(item.conversationId);

    await db
      .insert(messages)
      .values({
        connectionId: connection.id,
        clientId: client?.id ?? null,
        provider: "outlook",
        externalId: item.id,
        threadId: item.conversationId,
        subject: item.subject ?? "(no subject)",
        fromName: item.from?.emailAddress.name,
        fromEmail,
        toEmails: to,
        snippet: item.bodyPreview,
        receivedAt: new Date(item.receivedDateTime),
        isFromMe,
        awaitingReply,
      })
      .onConflictDoUpdate({
        target: [messages.provider, messages.externalId],
        set: { awaitingReply, clientId: client?.id ?? null },
      });

    written++;
  }

  return written;
}

type GraphEvent = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  location?: { displayName?: string };
  isAllDay: boolean;
  isCancelled: boolean;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  organizer?: { emailAddress: { address: string } };
  attendees?: { emailAddress: { name?: string; address: string }; type: string }[];
};

export async function syncOutlookCalendar(connection: Connection, opts: { past?: number; ahead?: number } = {}): Promise<number> {
  const matcher = await ClientMatcher.load();
  const ownDomain = connection.externalId.split("@")[1]?.toLowerCase() ?? "";
  const start = subDays(new Date(), opts.past ?? 14).toISOString();
  const end = addDays(new Date(), opts.ahead ?? 45).toISOString();

  const data = await graph<{ value: GraphEvent[] }>(
    connection,
    `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$top=250&$orderby=start/dateTime&$select=id,subject,bodyPreview,location,isAllDay,isCancelled,start,end,organizer,attendees`,
  );

  let written = 0;

  for (const item of data.value) {
    if (item.isCancelled) continue;

    const attendees = (item.attendees ?? [])
      .map((a) => ({ name: a.emailAddress.name, email: a.emailAddress.address.toLowerCase() }))
      .filter((a) => a.email !== connection.externalId.toLowerCase());

    const isExternal = attendees.some((a) => {
      const domain = a.email.split("@")[1] ?? "";
      return domain !== ownDomain && !GENERIC_DOMAINS.has(domain);
    });

    const client = matcher.match({ emails: attendees.map((a) => a.email), text: item.subject });

    // Graph returns naive local times with a separate zone; treat them as UTC-marked ISO.
    const startsAt = new Date(`${item.start.dateTime}Z`);
    const endsAt = new Date(`${item.end.dateTime}Z`);

    await db
      .insert(calendarEvents)
      .values({
        connectionId: connection.id,
        clientId: client?.id ?? null,
        provider: "microsoft",
        externalId: item.id,
        title: item.subject ?? "(untitled)",
        description: item.bodyPreview?.slice(0, 2000),
        location: item.location?.displayName,
        startsAt,
        endsAt,
        isAllDay: item.isAllDay,
        attendees,
        organizerEmail: item.organizer?.emailAddress.address?.toLowerCase(),
        isExternal,
      })
      .onConflictDoUpdate({
        target: [calendarEvents.provider, calendarEvents.externalId],
        set: { title: item.subject ?? "(untitled)", startsAt, endsAt, attendees, isExternal, clientId: client?.id ?? null },
      });

    written++;
  }

  return written;
}

export async function microsoftIdentity(accessToken: string): Promise<{ email: string; name?: string }> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Could not read Microsoft profile (${res.status}).`);
  const data = (await res.json()) as { mail?: string; userPrincipalName: string; displayName?: string };
  return { email: (data.mail ?? data.userPrincipalName).toLowerCase(), name: data.displayName };
}
