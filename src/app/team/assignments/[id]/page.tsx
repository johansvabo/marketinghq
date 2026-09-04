import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { assignmentWithWork } from "@/lib/ai/assignments";
import { AGENTS, type AgentKey } from "@/lib/ai/agents";
import { Card, CardTitle, Chip, Empty, PageHeader } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { AssignmentRunner } from "@/components/assignment-runner";
import { FileAssignment } from "@/components/file-assignment";
import { relativeDay } from "@/lib/dates";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const row = await assignmentWithWork((await params).id);
  return { title: row ? row.assignment.title : "Assignment" };
}

const STATUS_TONE = {
  pending: "neutral",
  running: "info",
  ready: "good",
  empty: "neutral",
  error: "urgent",
} as const;

export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const row = await assignmentWithWork((await params).id);
  if (!row) notFound();

  const { assignment, client, project, work } = row;
  const outstanding = work.filter((w) => w.status === "pending" || w.status === "running").length;
  const reviewer = work.find((w) => AGENTS[w.agentKey as AgentKey]?.runsLast);
  const specialists = work.filter((w) => !AGENTS[w.agentKey as AgentKey]?.runsLast);

  return (
    <>
      <Link href="/team" className="btn btn-ghost btn-sm mb-3 -ml-2">
        <ArrowLeft size={14} />
        Team
      </Link>

      <PageHeader
        title={assignment.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {client && <span>{client.name}</span>}
            {project && (
              <>
                <span>·</span>
                <Link href={`/projects/${project.id}`} className="underline">{project.name}</Link>
              </>
            )}
            <span>·</span>
            <span>{relativeDay(assignment.createdAt)}</span>
            <span>·</span>
            <span>
              {work.length - outstanding} of {work.length} reported
            </span>
          </span>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <AssignmentRunner assignmentId={assignment.id} outstanding={outstanding} />

        <Card tone="info">
          <CardTitle>The brief</CardTitle>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{assignment.brief}</p>
        </Card>
      </div>

      {/* The gathered answer is the point of the exercise, so it comes first. */}
      {assignment.synthesis ? (
        <Card className="mb-4" tone="good">
          <CardTitle
            action={<FileAssignment assignmentId={assignment.id} clientId={assignment.clientId} />}
          >
            <span className="inline-flex items-center gap-2">
              The answer
              {reviewer && (
                <span className="text-[11.5px] font-normal text-muted">
                  gathered by {AGENTS[reviewer.agentKey as AgentKey]?.name}
                </span>
              )}
            </span>
          </CardTitle>
          <Markdown source={assignment.synthesis} />
        </Card>
      ) : (
        <Card className="mb-4">
          <Empty
            title={outstanding > 0 ? "Still being worked" : "Nothing gathered yet"}
            hint={
              outstanding > 0
                ? "Each specialist works in turn and can read what the others said. The gathered answer appears here once the last one is done."
                : "Nobody produced anything that could be gathered. The individual contributions are below."
            }
          />
        </Card>
      )}

      <h2 className="section-title mb-2 px-1">What each of them said</h2>
      <div className="flex flex-col gap-3">
        {specialists.map((item) => {
          const agent = AGENTS[item.agentKey as AgentKey];
          return (
            <Card key={item.id}>
              <CardTitle
                action={
                  <Chip tone={STATUS_TONE[item.status as keyof typeof STATUS_TONE] ?? "neutral"}>
                    {item.status === "empty" ? "nothing to add" : item.status}
                  </Chip>
                }
              >
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: agent?.colour ?? "var(--ink-muted)" }} />
                  {agent?.name ?? item.agentKey}
                  <span className="text-[11.5px] font-normal text-muted">{agent?.role}</span>
                </span>
              </CardTitle>

              {item.body ? (
                <Markdown source={item.body} />
              ) : item.status === "error" ? (
                <p className="text-[12.5px]" style={{ color: "var(--color-urgent)" }}>{item.error}</p>
              ) : (
                <p className="text-[12.5px] text-muted">
                  {item.status === "running" ? "Working on it now." : "Waiting their turn."}
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
