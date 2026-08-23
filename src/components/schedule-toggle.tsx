"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleReportSchedule } from "@/server/actions";

export function ScheduleToggle({ scheduleId, active }: { scheduleId: string; active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      disabled={pending}
      onClick={() => startTransition(async () => { await toggleReportSchedule(scheduleId); router.refresh(); })}
      className="btn btn-sm"
      style={active ? { color: "var(--color-good)" } : { opacity: 0.6 }}
      title={active ? "Pause this cadence" : "Resume this cadence"}
    >
      {active ? "on" : "paused"}
    </button>
  );
}
