import Link from "next/link";
import { AlertTriangle, Diamond } from "lucide-react";
import type { PlanRow, Span, WeekLoad } from "@/lib/plan";
import { placeInWindow } from "@/lib/plan";
import { Empty } from "./ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmt = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const hours = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

/** Month bands across the window, for the header and the background rhythm. */
function monthsIn(window: Span) {
  const out: { label: string; left: number; width: number }[] = [];
  let cursor = new Date(window.start.getFullYear(), window.start.getMonth(), 1);
  while (cursor <= window.end) {
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const placed = placeInWindow({ start: cursor, end }, window);
    if (placed) out.push({ label: MONTHS[cursor.getMonth()], left: placed.left, width: placed.width });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return out;
}

/** A bar, with its own hover card. Identity is carried by the row label too. */
function Bar({
  placed,
  title,
  detail,
  colour,
  height,
  muted,
  label,
}: {
  placed: { left: number; width: number; clippedStart: boolean; clippedEnd: boolean };
  title: string;
  detail: string;
  colour: string;
  height: number;
  muted?: boolean;
  label?: string;
}) {
  return (
    <div
      className="group/bar absolute top-1/2 -translate-y-1/2"
      style={{ left: `${placed.left}%`, width: `${placed.width}%` }}
    >
      <div
        className="flex items-center overflow-hidden rounded-[4px] px-1.5"
        style={{
          height,
          background: colour,
          opacity: muted ? 0.4 : 1,
          // Square off an end that runs past the window, so a clipped bar does
          // not read as work that finishes inside it.
          borderTopLeftRadius: placed.clippedStart ? 0 : undefined,
          borderBottomLeftRadius: placed.clippedStart ? 0 : undefined,
          borderTopRightRadius: placed.clippedEnd ? 0 : undefined,
          borderBottomRightRadius: placed.clippedEnd ? 0 : undefined,
        }}
      >
        {label && height >= 14 && (
          <span className="truncate text-[10.5px] font-medium leading-none text-white">{label}</span>
        )}
      </div>

      <div
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-max max-w-[240px] rounded-[8px] border px-2 py-1.5 text-[11.5px] leading-snug shadow-sm group-hover/bar:block"
        style={{ background: "var(--surface)", borderColor: "var(--hairline)" }}
      >
        <span className="block font-medium">{title}</span>
        <span className="block text-muted">{detail}</span>
      </div>
    </div>
  );
}

export function Gantt({
  window,
  rows,
  load,
  undated,
}: {
  window: Span;
  rows: PlanRow[];
  load: WeekLoad[];
  undated: number;
}) {
  const months = monthsIn(window);
  const today = placeInWindow({ start: new Date(), end: new Date() }, window);
  const peak = Math.max(1, ...load.map((w) => w.logged + w.committed));

  if (rows.length === 0) {
    return (
      <Empty
        title="Nothing scheduled in this window"
        hint={
          undated > 0
            ? `${undated} open task${undated === 1 ? "" : "s"} have no dates, so they cannot be placed on a timeline. Give them a due date and they will appear here.`
            : "Give projects a start and due date, and tasks a due date, and the quarter fills in."
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Workload first: the question is "how busy", and spans alone do not answer it. */}
      <div className="card p-4">
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="section-title">Hours per week</h2>
          <div className="flex items-center gap-3 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: "var(--color-brand)" }} />
              logged
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: "var(--ink-muted)", opacity: 0.45 }} />
              estimated, still open
            </span>
          </div>
        </div>

        <div className="relative">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed"
            style={{ borderColor: "var(--hairline)" }}
          />
          <span className="absolute -top-0.5 right-0 text-[10px] tabular-nums text-muted">
            {hours(peak)}t
          </span>
        </div>

        <div className="flex h-[86px] items-end gap-[3px]">
          {load.map((w, index) => {
            const total = w.logged + w.committed;
            const isNow = today !== null && new Date() >= w.week.start && new Date() <= w.week.end;
            return (
              <div key={w.week.start.toISOString()} className="group/col relative flex flex-1 flex-col justify-end gap-[2px]">
                {w.committed > 0 && (
                  <div
                    className="rounded-t-[4px]"
                    style={{ height: `${(w.committed / peak) * 64}px`, background: "var(--ink-muted)", opacity: 0.45 }}
                  />
                )}
                {w.logged > 0 && (
                  <div
                    className={w.committed > 0 ? "" : "rounded-t-[4px]"}
                    style={{ height: `${(w.logged / peak) * 64}px`, background: "var(--color-brand)" }}
                  />
                )}
                <span
                  className="mt-1 block text-center text-[9.5px] tabular-nums"
                  style={{ color: isNow ? "var(--ink)" : "var(--ink-muted)", fontWeight: isNow ? 600 : 400 }}
                >
                  {load.length > 14 && index % 2 === 1 && !isNow ? "" : w.label}
                </span>

                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden w-max -translate-x-1/2 rounded-[8px] border px-2 py-1.5 text-[11.5px] leading-snug shadow-sm group-hover/col:block"
                  style={{ background: "var(--surface)", borderColor: "var(--hairline)" }}
                >
                  <span className="block font-medium">Week of {fmt(w.week.start)}</span>
                  <span className="block text-muted">
                    {hours(w.logged)}t logged · {hours(w.committed)}t estimated
                  </span>
                  <span className="block text-muted">{w.taskCount} open task{w.taskCount === 1 ? "" : "s"}</span>
                </div>
              </div>
            );
          })}
        </div>
        {total(load) === 0 && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
            No hours yet. This fills in from time you log and from estimates on tasks — a task with no estimate still
            counts in the task total, but cannot add hours.
          </p>
        )}
      </div>

      {/* The Gantt itself */}
      <div className="card overflow-x-auto">
        <div className="min-w-[680px]">
        <div className="flex border-b" style={{ background: "var(--raised)" }}>
          <div className="w-[150px] shrink-0 px-3 py-1.5 text-[11px] font-medium text-muted sm:w-[230px]">
            {rows.length} client{rows.length === 1 ? "" : "s"}
          </div>
          <div className="relative flex-1 py-1.5 pr-3">
            {months.map((m) => (
              <span
                key={m.label + m.left}
                className="absolute text-[11px] font-medium text-muted"
                style={{ left: `${m.left}%`, paddingLeft: 6 }}
              >
                {m.label}
              </span>
            ))}
            <div className="h-[14px]" />
          </div>
        </div>

        <div>
          {rows.map((row) => (
            <section key={row.client?.id ?? "unassigned"}>
              <div className="flex items-center border-b" style={{ background: "var(--raised)" }}>
                <div className="flex w-[150px] shrink-0 items-center gap-2 px-3 py-1.5 sm:w-[230px]">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: row.client?.color ?? "var(--ink-muted)" }}
                  />
                  <span className="truncate text-[12.5px] font-semibold">{row.client?.name ?? "No client"}</span>
                </div>
                <div className="flex-1" />
              </div>

              {row.projects.map((group) => (
                <div key={group.project?.id ?? "loose"}>
                  {group.project && (
                    <Row
                      window={window}
                      label={
                        <Link href={`/projects/${group.project.id}`} className="truncate hover:underline">
                          {group.project.name}
                        </Link>
                      }
                      indent={1}
                      strong
                      today={today}
                    >
                      {group.span && (
                        <Bar
                          placed={placeInWindow(group.span, window)!}
                          colour={row.client?.color ?? "var(--ink-muted)"}
                          height={16}
                          title={group.project.name}
                          detail={`${fmt(group.span.start)} – ${fmt(group.span.end)} · ${group.project.status}`}
                          muted={group.project.status === "done"}
                        />
                      )}
                      {group.milestones.map((m) => {
                        const placed = placeInWindow({ start: m.dueDate, end: m.dueDate }, window)!;
                        return (
                          <div
                            key={m.id}
                            className="group/bar absolute top-1/2 z-10 -translate-y-1/2"
                            style={{ left: `${placed.left}%` }}
                          >
                            <Diamond
                              size={12}
                              className="-translate-x-1/2 drop-shadow-[0_0_0_1.5px_var(--surface)]"
                              style={{ color: "var(--surface)", fill: "var(--ink)" }}
                              strokeWidth={3}
                            />
                            <div
                              role="tooltip"
                              className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-max rounded-[8px] border px-2 py-1.5 text-[11.5px] shadow-sm group-hover/bar:block"
                              style={{ background: "var(--surface)", borderColor: "var(--hairline)" }}
                            >
                              <span className="block font-medium">{m.name}</span>
                              <span className="block text-muted">Milestone · {fmt(m.dueDate)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </Row>
                  )}

                  {group.tasks.map((task) => {
                    const placed = placeInWindow(task.span, window)!;
                    const done = task.status === "done";
                    return (
                      <Row
                        key={task.id}
                        window={window}
                        indent={group.project ? 2 : 1}
                        today={today}
                        label={
                          <span className={`flex items-center gap-1.5 truncate ${done ? "line-through opacity-60" : ""}`}>
                            {task.overdue && (
                              <AlertTriangle size={11} className="shrink-0" style={{ color: "var(--color-urgent)" }} />
                            )}
                            <span className="truncate">{task.title}</span>
                          </span>
                        }
                      >
                        <Bar
                          placed={placed}
                          colour={task.overdue ? "var(--color-urgent)" : (row.client?.color ?? "var(--ink-muted)")}
                          height={10}
                          muted={done}
                          title={task.title}
                          detail={[
                            placed.width > 1
                              ? `${fmt(task.span.start)} – ${fmt(task.span.end)}`
                              : `Due ${fmt(task.span.end)}`,
                            task.estimateMinutes ? `${hours(task.estimateMinutes / 60)}t estimated` : "no estimate",
                            task.overdue ? "overdue" : task.status,
                          ].join(" · ")}
                        />
                      </Row>
                    );
                  })}
                </div>
              ))}
            </section>
          ))}
        </div>
        </div>
      </div>

      {undated > 0 && (
        <p className="px-1 text-[11.5px] leading-relaxed text-muted">
          {undated} open task{undated === 1 ? "" : "s"} {undated === 1 ? "has" : "have"} no dates and so {undated === 1 ? "is" : "are"} not
          on the timeline. They still have to be done — give them a due date to see them here.
        </p>
      )}
    </div>
  );
}

const total = (load: WeekLoad[]) => load.reduce((sum, w) => sum + w.logged + w.committed, 0);

/** One timeline row: a fixed label column, then the plotted area. */
function Row({
  label,
  children,
  indent,
  strong,
  today,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  indent: number;
  strong?: boolean;
  today: { left: number } | null;
  window: Span;
}) {
  return (
    <div className="flex items-stretch border-b last:border-b-0">
      <div
        className={`w-[150px] shrink-0 py-1.5 pr-2 text-[12px] sm:w-[230px] ${strong ? "font-medium" : ""}`}
        style={{ paddingLeft: 12 + indent * 12 }}
      >
        <div className="truncate">{label}</div>
      </div>
      <div className="relative min-h-[26px] flex-1 pr-3">
        {today && (
          <div
            className="absolute inset-y-0 w-px"
            style={{ left: `${today.left}%`, background: "var(--color-urgent)", opacity: 0.35 }}
          />
        )}
        {children}
      </div>
    </div>
  );
}
