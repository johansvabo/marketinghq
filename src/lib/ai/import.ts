import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import type { SourceDocument } from "@/lib/import/files";
import { chunkText } from "@/lib/import/files";
import { anthropic, MODEL } from "./client";

export const INSIGHT_KINDS = [
  "insight",
  "learning",
  "benchmark",
  "idea",
  "meeting_note",
  "decision",
  "reference",
] as const;

/**
 * Every field is required and blank-able rather than optional — structured
 * outputs are strictest and most reliable when the model never has to decide
 * whether to include a key.
 */
const CandidateSchema = z.object({
  title: z.string().describe("The conclusion in one line, not the topic. 'LinkedIn CPL is 3x Meta but closes 4x better', not 'LinkedIn performance'."),
  body: z.string().describe("The supporting detail, in the author's own words and numbers wherever possible."),
  kind: z.enum(INSIGHT_KINDS),
  clientName: z.string().describe("Exact client name from the provided list, or empty string if it is general knowledge or you cannot tell."),
  tags: z.array(z.string()).describe("2-4 lowercase topic tags, hyphenated."),
  confidence: z.number().describe("1 = a hunch stated once, 5 = proven repeatedly with numbers. Judge from how the source states it, not from how much you agree."),
  occurredAt: z.string().describe("YYYY-MM-DD if the source states or clearly implies when this happened, otherwise an empty string."),
  sourceQuote: z.string().describe("Up to 200 characters quoted verbatim from the source, so a human can check this against the original."),
});

const ExtractionSchema = z.object({
  entries: z.array(CandidateSchema),
});

export type Candidate = z.infer<typeof CandidateSchema>;

const SYSTEM = `You pull durable knowledge out of a marketing consultant's raw notes so it can be filed in their second brain.

The value of that brain depends entirely on what you refuse to put in it. A brain full of status updates is worse than an empty one, because they then stop trusting search results.

EXTRACT things that will still be worth knowing in a year:
- A finding with evidence behind it — a result, a number, a pattern that held
- A benchmark worth comparing against later
- A decision, and the reasoning that produced it
- A client's preference, constraint, or way of working
- A hypothesis worth testing, when stated as one
- What was concluded in a meeting

DO NOT EXTRACT:
- Action items, to-dos, next steps, or anything with an owner and a deadline — those are tasks, and they belong somewhere else
- Status updates, progress reports, scheduling, logistics
- Generic marketing advice that is true of every account and specific to none
- Restatements of a number with no interpretation ("spend was DKK 40,000")
- Anything you had to infer rather than read

Rules:
- Never invent. Every number, name and claim must be in the source. If the source is vague, extract a vaguer entry or none at all — do not sharpen it up.
- Write the title as the conclusion. Someone scanning 300 of these in a year should get the finding without opening it.
- Preserve their numbers, their framing, and their scepticism. If they said "possibly", keep the "possibly".
- Merge fragments about the same finding into one entry. Do not split one finding across several.
- Attribute to a client only when the source makes it clear. An empty clientName is much better than a wrong one.
- A source that contains nothing durable should produce an empty list. That is a correct and common answer — say nothing rather than padding.`;

export type ExtractionProgress =
  | { type: "chunk"; index: number; total: number; label: string }
  | { type: "entries"; entries: Candidate[] }
  | { type: "note"; message: string };

/** Everything found before the deadline, plus whether there is more to do. */
export type ExtractionResult = { entries: Candidate[]; stoppedEarly: boolean; remaining: number };

async function clientNames(): Promise<string[]> {
  const rows = await db.select({ name: clients.name }).from(clients);
  return rows.map((r) => r.name);
}

function contextBlock(names: string[], hint?: string): string {
  return [
    names.length ? `Known clients — attribute only to these exact names:\n${names.map((n) => `- ${n}`).join("\n")}` : "No clients are set up yet, so leave clientName empty on everything.",
    hint ? `\nThe person importing this says it is about: ${hint}. Prefer that attribution unless the source clearly contradicts it.` : "",
  ].join("\n");
}

async function extractOne(content: Anthropic.ContentBlockParam[], names: string[], hint?: string): Promise<Candidate[]> {
  const client = anthropic();

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16_000,
    system: [
      // Stable prefix first so repeated chunks hit the cache.
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: contextBlock(names, hint) },
    ],
    messages: [{ role: "user", content }],
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(ExtractionSchema) },
  });

  return (response.parsed_output?.entries ?? []).map(normalize);
}

/**
 * The schema helper renders a zod enum into the field description rather than a
 * JSON Schema `enum`, so `kind` is a hint to the model, not a constraint. Same
 * goes for the numeric and date ranges. Everything gets clamped here so nothing
 * unexpected can reach the review screen, let alone the database.
 */
function normalize(entry: Candidate): Candidate {
  const kind = (INSIGHT_KINDS as readonly string[]).includes(entry.kind) ? entry.kind : "insight";
  const occurredAt = /^\d{4}-\d{2}-\d{2}$/.test(entry.occurredAt) ? entry.occurredAt : "";

  return {
    ...entry,
    title: entry.title.trim(),
    body: entry.body.trim(),
    kind: kind as Candidate["kind"],
    clientName: entry.clientName.trim(),
    tags: (entry.tags ?? [])
      .map((tag) => tag.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-"))
      .filter(Boolean)
      .slice(0, 6),
    confidence: Math.min(Math.max(Math.round(entry.confidence) || 3, 1), 5),
    occurredAt,
    sourceQuote: entry.sourceQuote.trim().slice(0, 240),
  };
}

/**
 * Walks every source, chunking long text so each pass stays small enough to be
 * accurate, and reports progress as it goes — a 40-page import takes minutes,
 * and a silent wait reads as a hang.
 */
export async function extractCandidates(
  sources: SourceDocument[],
  opts: {
    hint?: string;
    onProgress?: (event: ExtractionProgress) => void;
    /** Stop starting new work after this time and return what was found. */
    deadline?: number;
  } = {},
): Promise<ExtractionResult> {
  const names = await clientNames();
  const all: Candidate[] = [];

  type Unit = { label: string; content: Anthropic.ContentBlockParam[] };
  const units: Unit[] = [];

  for (const source of sources) {
    if (source.kind === "pdf") {
      units.push({
        label: source.name,
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: source.base64 },
          },
          { type: "text", text: `Pull the durable knowledge out of ${source.name}.` },
        ],
      });
      continue;
    }

    const chunks = chunkText(source.text);
    chunks.forEach((chunk, index) => {
      units.push({
        label: chunks.length > 1 ? `${source.name} (part ${index + 1} of ${chunks.length})` : source.name,
        content: [{ type: "text", text: `Source: ${source.name}\n\n${chunk}` }],
      });
    });
  }

  for (const [index, unit] of units.entries()) {
    // The host caps how long a request may run, so stop cleanly rather than
    // being killed mid-flight: a partial import you can act on beats losing the
    // whole run and every entry already extracted.
    if (opts.deadline && Date.now() > opts.deadline) {
      const remaining = units.length - index;
      opts.onProgress?.({
        type: "note",
        message: `Stopped after ${index} of ${units.length} sections to stay inside the time limit. Everything found so far is below — review and save it, then import the rest separately.`,
      });
      return { entries: dedupe(all.filter((e) => e.title && e.body)), stoppedEarly: true, remaining };
    }

    opts.onProgress?.({ type: "chunk", index: index + 1, total: units.length, label: unit.label });

    try {
      const entries = await extractOne(unit.content, names, opts.hint);
      if (entries.length) {
        all.push(...entries);
        opts.onProgress?.({ type: "entries", entries });
      }
    } catch (error) {
      // One bad chunk must not lose the work already done on the others.
      opts.onProgress?.({
        type: "note",
        message: `Couldn't read ${unit.label}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return { entries: dedupe(all.filter((entry) => entry.title && entry.body)), stoppedEarly: false, remaining: 0 };
}

/**
 * The same finding often appears in several documents. Near-identical titles
 * collapse into the one with the most supporting detail.
 */
function dedupe(entries: Candidate[]): Candidate[] {
  const seen = new Map<string, Candidate>();

  for (const entry of entries) {
    const key = entry.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 8).join(" ");
    const existing = seen.get(key);
    if (!existing || entry.body.length > existing.body.length) seen.set(key, entry);
  }

  return [...seen.values()];
}
