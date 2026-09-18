/**
 * The weekly email. Three things fail quietly here: sending the same week
 * twice because three cron runs a day each think they are the first, leaking
 * raw HTML out of a specialist's text into the message body, and sending an
 * empty digest that trains you to ignore the next one.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { briefings, clients, settings } from "../src/lib/db/schema";
import { digestSince, renderDigest, sendWeeklyDigest, type DigestPiece } from "../src/lib/ai/digest";
import { canSendEmail, emailBlocker } from "../src/lib/email";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

// ---- Configuration is a precondition, and it must say which half is missing.
const blocker = emailBlocker();
check("without a key it refuses rather than pretending to send", !canSendEmail() ? blocker !== null : true);
if (blocker) check("...and names the variable to set", /RESEND_API_KEY|OWNER_EMAIL/.test(blocker), blocker);

// ---- Rendering.
const pieces: DigestPiece[] = [
  {
    id: "1",
    title: "Kanalstrategi for kommunesegmentet",
    agentKey: "strategy",
    agentName: "Odin",
    clientName: "Nattugla",
    body: "# Overskrift\n\nKommunene kjøper ikke teknologi, de kjøper trygghet for at noen tar ansvar når det svikter. Det endrer hele innsalget.",
  },
  {
    id: "2",
    title: "Meta-tekster",
    agentKey: "performance",
    agentName: "Aksel",
    clientName: null,
    body: "Kort.",
  },
];

const { subject, html, text } = renderDigest(pieces, "Odin fant noe som endrer innsalget.", "https://example.test");

check("the subject says how much there is", subject.includes("2"), subject);
check("the summary leads the email", html.indexOf("endrer innsalget") < html.indexOf("Kanalstrategi"), "summary is not first");
check("every piece is listed", pieces.every((p) => html.includes(p.title)));
check("each piece names who wrote it", html.includes("Odin") && html.includes("Aksel"));
check("the client is shown when there is one", html.includes("Nattugla"));
check("there is a way back into the app", html.includes("https://example.test/team"));

// APP_URL defaults to localhost. A button pointing at the reader's own
// machine reads as a broken product, so it must not be rendered at all.
const local = renderDigest(pieces, null, "http://localhost:3000");
check("a localhost link is never put in an email", !local.html.includes("localhost"), "dead link shipped");
check("...and the text version leaves it out too", !local.text.includes("localhost"));
check("...but the email still says where to look", local.html.includes("Åpne Marketing HQ"));
check("...and names the variable to fix it", local.html.includes("APP_URL"));
check("the pieces are all still there without the link", pieces.every((p) => local.html.includes(p.title)));

// The excerpt must be prose, not the markdown heading above it.
check("the excerpt skips the heading", html.includes("Kommunene kjøper ikke teknologi"), "heading leaked in");
check("...and strips markdown from it", !html.includes("# Overskrift"));

// A plain-text alternative, because some clients show only that.
check("a text version exists", text.includes("Kanalstrategi") && text.includes("Odin"));
check("...and carries the summary too", text.includes("endrer innsalget"));

// ---- Escaping. A specialist writing about an <input> must not break the email.
const hostile: DigestPiece[] = [
  {
    id: "3",
    title: '<script>alert("x")</script> & more',
    agentKey: "seo",
    agentName: "Marit",
    clientName: null,
    body: "A body long enough to be used as the excerpt, mentioning <b>bold</b> tags & ampersands directly.",
  },
];
const nasty = renderDigest(hostile, null, "https://example.test");
check("a script tag in a title cannot reach the markup", !nasty.html.includes("<script>"), "script tag survived");
check("...and is escaped instead", nasty.html.includes("&lt;script&gt;"));
check("ampersands are escaped", nasty.html.includes("&amp;"));
check("tags inside the body are escaped too", !nasty.html.includes("<b>bold</b>"));
check("with no summary it still says something", nasty.html.includes("teamet produserte") || nasty.html.includes("Teamet"));

// ---- What goes in the window.
await db.delete(briefings);
const [client] = await db.insert(clients).values({ name: "Testkunde", slug: `t-${Date.now()}`, status: "active" }).returning();

const hour = 60 * 60 * 1000;
await db.insert(briefings).values([
  { agentKey: "seo", clientId: client.id, slotKey: "a", status: "ready", title: "Inside", body: "x".repeat(60), completedAt: new Date(Date.now() - hour) },
  { agentKey: "seo", clientId: client.id, slotKey: "b", status: "ready", title: "Too old", body: "x".repeat(60), completedAt: new Date(Date.now() - 400 * hour) },
  { agentKey: "seo", clientId: client.id, slotKey: "c", status: "empty", title: "Nothing to report", body: "x".repeat(60), completedAt: new Date(Date.now() - hour) },
  { agentKey: "seo", clientId: client.id, slotKey: "d", status: "error", title: "Broke", body: null, completedAt: new Date(Date.now() - hour) },
]);

const window = await digestSince(new Date(Date.now() - 24 * hour));
check("only the last week is included", !window.some((p) => p.title === "Too old"), window.map((p) => p.title).join(","));
check("a briefing that said nothing is left out", !window.some((p) => p.title === "Nothing to report"));
check("a failed one is left out", !window.some((p) => p.title === "Broke"));
check("the real one is in", window.some((p) => p.title === "Inside"), String(window.length));
check("it carries the client name", window[0]?.clientName === "Testkunde", String(window[0]?.clientName));

// ---- Not sending twice, and not sending nothing.
await db.delete(settings).where(eq(settings.key, "digest:last-sent"));
const first = await sendWeeklyDigest();
check(
  "with no email configured it declines and says why",
  first.sent === false && /not configured/i.test(first.reason),
  JSON.stringify(first),
);

await db.insert(settings).values({ key: "digest:last-sent", value: { at: Date.now() } });
const tooSoon = await sendWeeklyDigest();
check("a second run in the same week does not send again", tooSoon.sent === false, JSON.stringify(tooSoon));

await db.delete(briefings);
await db.delete(settings).where(eq(settings.key, "digest:last-sent"));
await db.delete(clients).where(eq(clients.id, client.id));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
