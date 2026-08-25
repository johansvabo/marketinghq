import { isSignedIn } from "@/lib/auth";
import { describeAiError } from "@/lib/ai/client";
import { extractCandidates } from "@/lib/ai/import";
import { readUpload, type SourceDocument } from "@/lib/import/files";

export const runtime = "nodejs";
export const maxDuration = 800;

/** Total characters of pasted or uploaded text accepted in one import. */
const MAX_TOTAL_CHARS = 400_000;

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
      { error: `That's ${Math.round(totalChars / 1000)}k characters. Import up to ${MAX_TOTAL_CHARS / 1000}k at a time so you can actually review the results.` },
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
        const entries = await extractCandidates(sources, {
          hint,
          onProgress: (event) => {
            if (event.type === "chunk") send("progress", { index: event.index, total: event.total, label: event.label });
            else if (event.type === "entries") send("entries", { entries: event.entries });
            else send("note", { message: event.message });
          },
        });

        send("done", { total: entries.length, entries });
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
