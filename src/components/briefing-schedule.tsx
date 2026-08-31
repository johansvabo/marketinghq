"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import { AGENT_LIST } from "@/lib/ai/agents";
import type { BriefingConfig } from "@/lib/ai/briefings";
import { runBriefingsNow, setBriefingConfig } from "@/server/actions";
import { Card, CardTitle } from "./ui";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function BriefingSchedule({ config, clientCount }: { config: BriefingConfig; clientCount: number }) {
  const router = useRouter();
  const [state, setState] = useState(config);
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function save(next: BriefingConfig) {
    setState(next);
    startTransition(async () => {
      await setBriefingConfig(next);
      router.refresh();
    });
  }

  const runsPerCycle = state.agents.length * clientCount;

  return (
    <Card>
      <CardTitle
        action={
          <button
            onClick={() => {
              setRunning(true);
              setNote(null);
              startTransition(async () => {
                const result = await runBriefingsNow();
                setRunning(false);
                setNote(
                  result.produced === 0 && result.planned === 0
                    ? "Nothing was due — everything for the current slots has already run."
                    : `${result.produced} produced${result.remaining ? `, ${result.remaining} still queued` : ""}${result.failed ? `, ${result.failed} failed` : ""}.`,
                );
                router.refresh();
              });
            }}
            disabled={running || pending || !state.enabled}
            className="btn btn-sm"
            title={state.enabled ? "Run a cycle now" : "Turn the schedule on first"}
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            Run now
          </button>
        }
      >
        Schedule
      </CardTitle>

      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={(e) => save({ ...state, enabled: e.target.checked })}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="block text-[13px] font-medium">The team works on its own</span>
          <span className="block text-[11.5px] leading-relaxed text-muted">
            Each selected specialist studies each active client at the times below, and produces work in their speciality.
          </span>
        </span>
      </label>

      <div className="mt-4">
        <span className="label">When</span>
        <div className="flex flex-col gap-2">
          {state.slots.map((slot, index) => (
            <div key={index} className="flex flex-wrap items-center gap-1.5">
              <select
                value={slot.weekday}
                onChange={(e) => {
                  const slots = [...state.slots];
                  slots[index] = { ...slot, weekday: Number(e.target.value) };
                  save({ ...state, slots });
                }}
                className="input w-auto py-1.5 text-[12.5px]"
                aria-label="Day"
              >
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
              <select
                value={slot.hour}
                onChange={(e) => {
                  const slots = [...state.slots];
                  slots[index] = { ...slot, hour: Number(e.target.value) };
                  save({ ...state, slots });
                }}
                className="input w-auto py-1.5 text-[12.5px]"
                aria-label="Hour"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                ))}
              </select>
              {state.slots.length > 1 && (
                <button
                  onClick={() => save({ ...state, slots: state.slots.filter((_, i) => i !== index) })}
                  className="btn btn-ghost btn-sm"
                >
                  remove
                </button>
              )}
            </div>
          ))}
          {state.slots.length < 4 && (
            <button
              onClick={() => save({ ...state, slots: [...state.slots, { weekday: 1, hour: 9 }] })}
              className="btn btn-ghost btn-sm -ml-2 self-start"
            >
              Add a time
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[11.5px] text-muted">
          Times are {state.timezone.replace("_", " ")}. The host runs scheduled jobs within the hour rather than to the
          minute, so treat these as “that hour”, not “on the dot”.
        </p>
      </div>

      <div className="mt-4">
        <span className="label">Who works</span>
        <div className="flex flex-wrap gap-1.5">
          {AGENT_LIST.map((agent) => {
            const on = state.agents.includes(agent.key);
            return (
              <button
                key={agent.key}
                onClick={() =>
                  save({
                    ...state,
                    agents: on ? state.agents.filter((a) => a !== agent.key) : [...state.agents, agent.key],
                  })
                }
                className={`btn btn-sm ${on ? "btn-primary" : ""}`}
              >
                {agent.name}
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-4 border-t pt-3 text-[11.5px] leading-relaxed text-muted">
        {runsPerCycle === 0 || clientCount === 0
          ? "Nothing will run — pick at least one specialist, and have at least one active client."
          : `Each run is about ${runsPerCycle} pieces of work (${state.agents.length} specialist${state.agents.length === 1 ? "" : "s"} × ${clientCount} active client${clientCount === 1 ? "" : "s"}), and there are ${state.slots.length} a week. Each one costs a few cents of Claude usage, more when they search the web.`}
      </p>

      {note && <p className="mt-2 text-[12px]" style={{ color: "var(--color-good)" }}>{note}</p>}
    </Card>
  );
}
