"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { setModel } from "@/server/actions";
import { AVAILABLE_MODELS } from "@/lib/ai/models";

/**
 * A fallback, not a quality knob. Anthropic can have one model at capacity
 * while the others are fine — this is what lets work continue during that
 * window instead of waiting it out on the one model that happens to be busy.
 */
export function ModelPicker({ current, isOverride }: { current: string; isOverride: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(modelId: string) {
    startTransition(async () => {
      await setModel(modelId === current && !isOverride ? null : modelId);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={current}
        onChange={(e) => change(e.target.value)}
        disabled={pending}
        className="input w-auto py-1 text-[11.5px]"
        aria-label="Model"
        title="Which Claude model answers — a fallback for when one is at capacity"
      >
        {AVAILABLE_MODELS.map((m) => (
          <option key={m.id} value={m.id} title={m.hint}>
            {m.label}
          </option>
        ))}
      </select>
      {isOverride && (
        <button
          onClick={() => startTransition(async () => { await setModel(null); router.refresh(); })}
          disabled={pending}
          className="btn btn-ghost btn-sm"
          title="Back to the default model"
        >
          <RotateCcw size={11} />
        </button>
      )}
    </div>
  );
}
