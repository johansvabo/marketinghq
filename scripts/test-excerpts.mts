/**
 * An excerpt has to be able to become the whole document again.
 *
 * This failed in the worst possible way: a specialist was shown 2,000
 * characters of a long strategy document, with no id to ask for the rest and
 * nothing saying anything had been cut. He said outright that the chapter he
 * needed "is not available to me" — and he was right. The brief was answered
 * from a fragment of the source it named.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { clients, documents } from "../src/lib/db/schema";
import { runBrainTool } from "../src/lib/ai/tools";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const [client] = await db
  .insert(clients)
  .values({ name: `Dtablet-${Date.now()}`, slug: `d-${Date.now()}`, status: "active" })
  .returning();

// A document shaped like the one that caused this: the part that matters is
// well past where any excerpt stops.
const chapter = "KAPITTEL 03 BUDSKAP — uttak 0 til 24, nummerert og navngitt.";
const body = `Lanseringsplan forhandssalg.\n\n${"Fremdriftsplan med datoer og ansvarlige. ".repeat(220)}\n\n${chapter}`;

const [doc] = await db
  .insert(documents)
  .values({ clientId: client.id, title: "Dtablet — lanseringsplan", body, kind: "strategy" })
  .returning();

check("the document is long enough to be cut", body.length > 4000, `${body.length} chars`);
check("the chapter sits past any excerpt", body.indexOf(chapter) > 2000, String(body.indexOf(chapter)));
check("the whole document is stored, not a truncated copy", doc.body!.includes(chapter));

/* ------------------------------------------------------------- search_brain */

const found = await runBrainTool("search_brain", { query: "lanseringsplan" }, {});
check("searching finds it", found.text.includes("lanseringsplan"), found.text.slice(0, 120));
check("the excerpt carries the document id", found.text.includes(doc.id), "no id — read_document cannot be called");
check("it says it is only an excerpt", /excerpt, not the document/i.test(found.text));
check("...and how much was left out", /more characters/i.test(found.text));
check("...and names the tool that gets the rest", found.text.includes("read_document"));
check("the buried chapter is genuinely not in the excerpt", !found.text.includes(chapter));

/* -------------------------------------------------------- get_client_brief */

const brief = await runBrainTool("get_client_brief", { client: client.name }, {});
check("the brief lists the document with its id", brief.text.includes(doc.id), "no id in the client brief either");
check("...and marks it as an excerpt", /excerpt, not the document/i.test(brief.text));

/* --------------------------------------------------------- read_document */

const full = await runBrainTool("read_document", { id: doc.id }, {});
check("reading by id returns the whole thing", full.text.includes(chapter), "still truncated");
check("...including everything before it", full.text.includes("Fremdriftsplan"));
check("an unknown id is refused rather than faked", (await runBrainTool("read_document", { id: "nope" }, {})).text.includes("No document"));

// The id printed in the excerpt must be the one read_document accepts —
// a mismatch would look like it works and quietly return nothing.
const idInExcerpt = found.text.match(/id: ([0-9a-f-]{36})/)?.[1];
check("the id shown is the id that works", idInExcerpt === doc.id, `${idInExcerpt} vs ${doc.id}`);

/* ----------------------------------------------------- and it is instructed */

const toolSrc = readFileSync("src/lib/ai/tools.ts", "utf8");
check(
  "the tool description says an excerpt is not the document",
  /excerpt that stops mid-way is not the document/i.test(toolSrc),
);

const assignSrc = readFileSync("src/lib/ai/assignments.ts", "utf8");
check("specialists are told to read the source the brief names", /read that document before you write anything/i.test(assignSrc));
check("...and to declare a gap rather than work around it", /Do not quietly work around the gap/i.test(assignSrc));

const brainSrc = readFileSync("src/lib/ai/brain.ts", "utf8");
check("the Brain is told the same", /Excerpts are not documents/i.test(brainSrc));
check("...and to name the document when briefing the team", /say which one and name the part of it that matters/i.test(brainSrc));

await db.delete(documents).where(eq(documents.id, doc.id));
await db.delete(clients).where(eq(clients.id, client.id));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
