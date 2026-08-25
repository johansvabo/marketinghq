import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { calendarEvents, clients, projects } from "@/lib/db/schema";
import { format } from "@/lib/dates";
import { Card, PageHeader } from "@/components/ui";
import { CaptureForm } from "@/components/capture-form";

export const dynamic = "force-dynamic";

export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; project?: string; eventId?: string }>;
}) {
  const params = await searchParams;

  const [clientRows, projectRows, event] = await Promise.all([
    db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(asc(clients.name)),
    db.select({ id: projects.id, name: projects.name, clientId: projects.clientId }).from(projects).where(eq(projects.status, "active")),
    params.eventId
      ? db.select().from(calendarEvents).where(eq(calendarEvents.id, params.eventId)).limit(1).then((r) => r[0])
      : Promise.resolve(undefined),
  ]);

  // Coming from a meeting follow-up nudge: prefill it as a meeting note.
  const prefill = event
    ? {
        title: `${event.title} — notes`,
        kind: "meeting_note",
        clientId: event.clientId ?? params.client ?? "",
        projectId: event.projectId ?? params.project ?? "",
        body: `Met ${format(event.startsAt, "d MMMM")}${
          (event.attendees?.length ?? 0) > 0 ? ` with ${event.attendees!.map((a) => a.name ?? a.email).join(", ")}` : ""
        }.\n\nWhat was decided:\n- \n\nWhat they're worried about:\n- \n\nWhat I owe them:\n- `,
        sourceRef: event.id,
      }
    : { clientId: params.client ?? "", projectId: params.project ?? "" };

  return (
    <>
      <Link href="/brain?tab=library" className="btn btn-ghost btn-sm mb-3 -ml-2">
        <ArrowLeft size={14} />
        Brain
      </Link>

      <PageHeader
        title="Capture"
        subtitle="Write it down once, badly, now — rather than perfectly, later, never."
        actions={
          <Link href="/brain/import" className="btn btn-sm">
            Import a document instead
          </Link>
        }
      />

      <Card className="max-w-[720px]">
        <CaptureForm clients={clientRows} projects={projectRows} prefill={prefill} />
      </Card>
    </>
  );
}
