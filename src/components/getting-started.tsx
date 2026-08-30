import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import type { Step } from "@/lib/onboarding";
import { Card } from "./ui";

/**
 * Shown until the workspace has been set up, then gone for good. Deliberately
 * not dismissible while incomplete: the steps are the difference between an app
 * that watches your work and an empty page that cannot.
 */
export function GettingStarted({ steps }: { steps: Step[] }) {
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  return (
    <Card className="mb-5" tone="brand">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Getting set up</h2>
        <span className="text-[12px] text-muted">
          {done} of {steps.length} done
        </span>
        <div className="ml-auto flex gap-1">
          {steps.map((s) => (
            <span
              key={s.key}
              className="h-1.5 w-6 rounded-full"
              style={{ background: s.done ? "var(--color-good)" : "var(--raised)" }}
            />
          ))}
        </div>
      </div>

      <ul className="flex flex-col">
        {steps.map((step) => (
          <li
            key={step.key}
            className="flex items-start gap-3 border-t py-2.5 first:border-t-0 first:pt-0"
            style={{ opacity: step.done ? 0.5 : 1 }}
          >
            <span
              className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full"
              style={{
                background: step.done ? "var(--color-good)" : "transparent",
                border: step.done ? "none" : "1.5px solid var(--ink-muted)",
                color: "var(--canvas)",
              }}
            >
              {step.done && <Check size={11} strokeWidth={3} />}
            </span>

            <div className="min-w-0 flex-1">
              <p className={`text-[13.5px] font-medium leading-snug ${step.done ? "line-through" : ""}`}>{step.title}</p>
              {!step.done && <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{step.why}</p>}
            </div>

            {!step.done && (
              <Link
                href={step.href}
                className={step.key === next?.key ? "btn btn-sm btn-primary shrink-0" : "btn btn-sm shrink-0"}
              >
                {step.cta}
                <ChevronRight size={13} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
