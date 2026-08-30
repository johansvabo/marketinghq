import { isSignedIn } from "@/lib/auth";
import { describeAiError } from "@/lib/ai/client";
import { extractCandidates } from "@/lib/ai/import";
import { readUpload, type SourceDocument } from "@/lib/import/files";

export const runtime = "nodejs";
/**
 * 300s is the ceiling on Vercel's Hobby plan. The extractor is given a slightly
 * shorter budget so it can finish the section it is on and hand back what it
 * found, rather than being killed mid-request.
 */
export const maxDuration = 300;

const TIME_BUDGET_MS = 250_000;

/** Total characters accepted in one import. Beyond this, split it up. */
const MAX_TOTAL_CHARS = 200_000;

export async function POST(request: Request) {
  if (!(await isSignedIn())) return new Response("Unauthorized", { status: 401 });

  const form = await request.formData();
  const pasted = String(form.get("text") ?? "").trim();
  const hint = String(form.get("hint") ?? "").trim() || undefined;
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

  const sources: SourceDocument[] = [];
  const problems: string[] = [];

  if (pasted) sources.push({ kind: "text", name: "Pasted notes", text: pasted });

  for (const file of files) {
    try {
      sources.push(await readUpload(file));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (sources.length === 0) {
    return Response.json(
      { error: problems.length ? problems.join(" ") : "Nothing to import — paste some notes or pick a file." },
      { status: 400 },
    );
  }

  const totalChars = sources.reduce((sum, s) => sum + (s.kind === "text" ? s.text.length : 0), 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return Response.json(
      {
        error: `That's ${Math.round(totalChars / 1000)}k characters, and the limit is ${MAX_TOTAL_CHARS / 1000}k per import. Split it — a few smaller imports are easier to review honestly anyway.`,
      },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      for (const problem of problems) send("note", { message: problem });

      try {
        const started = Date.now();
        const result = await extractCandidates(sources, {
          hint,
          deadline: started + TIME_BUDGET_MS,
          onProgress: (event) => {
            if (event.type === "chunk") send("progress", { index: event.index, total: event.total, label: event.label });
            else if (event.type === "entries") send("entries", { entries: event.entries });
            else send("note", { message: event.message });
          },
        });

        send("done", { total: result.entries.length, entries: result.entries, stoppedEarly: result.stoppedEarly });
      } catch (error) {
        send("error", { message: describeAiError(error) });
      } finally {
        open = false;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
