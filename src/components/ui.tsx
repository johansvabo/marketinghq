import { clsx } from "clsx";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-[-0.02em] md:text-[26px]">{title}</h1>
        {subtitle && <div className="mt-1 text-[13.5px] text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <section className={clsx("card", padded && "p-4 md:p-5", className)}>{children}</section>;
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="section-title">{children}</h2>
      {action}
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-9 text-center">
      <p className="text-[13.5px] font-semibold">{title}</p>
      {hint && <p className="max-w-[42ch] text-[12.5px] leading-relaxed text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const TONES = {
  neutral: { color: "var(--ink-muted)", border: "var(--hairline)" },
  brand: { color: "var(--color-brand)", border: "color-mix(in oklch, var(--color-brand) 40%, transparent)" },
  urgent: { color: "var(--color-urgent)", border: "color-mix(in oklch, var(--color-urgent) 40%, transparent)" },
  warn: { color: "var(--color-warn)", border: "color-mix(in oklch, var(--color-warn) 40%, transparent)" },
  good: { color: "var(--color-good)", border: "color-mix(in oklch, var(--color-good) 40%, transparent)" },
  info: { color: "var(--color-info)", border: "color-mix(in oklch, var(--color-info) 40%, transparent)" },
} as const;

export type Tone = keyof typeof TONES;

export function Chip({
  children,
  tone = "neutral",
  solid = false,
  dot,
}: {
  children: ReactNode;
  tone?: Tone;
  solid?: boolean;
  dot?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      className="chip"
      style={
        solid
          ? { background: `color-mix(in oklch, ${t.color} 16%, transparent)`, borderColor: t.border, color: t.color }
          : { borderColor: t.border, color: t.color }
      }
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />}
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="card p-3.5">
      <div className="section-title">{label}</div>
      <div className="mt-1.5 text-[22px] font-bold leading-none tracking-[-0.02em]" style={{ color: TONES[tone].color === "var(--ink-muted)" ? "var(--ink)" : TONES[tone].color }}>
        {value}
      </div>
      {hint && <div className="mt-1.5 text-[11.5px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

export function Progress({ value, tone = "brand" }: { value: number; tone?: Tone }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--raised)" }}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${clamped}%`, background: TONES[tone].color }}
      />
    </div>
  );
}

/** Inline SVG trend line — no chart library, no runtime cost, scales anywhere. */
export function Sparkline({
  points,
  tone = "brand",
  height = 34,
  width = 120,
}: {
  points: number[];
  tone?: Tone;
  height?: number;
  width?: number;
}) {
  if (points.length < 2) return <div style={{ height }} />;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);

  const coords = points.map((p, i) => [i * step, height - ((p - min) / span) * (height - 4) - 2] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const color = TONES[tone].color;
  const gradientId = `spark-${tone}-${points.length}-${Math.round(points[0] ?? 0)}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Trend" className="overflow-visible">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="2.2" fill={color} />
    </svg>
  );
}

export function Delta({
  pct,
  goodDirection = "up",
}: {
  pct: number | null;
  /** "none" for metrics like spend, where up is neither good nor bad on its own. */
  goodDirection?: "up" | "down" | "none";
}) {
  if (pct === null || !Number.isFinite(pct)) return <span className="text-[11.5px] text-muted">—</span>;

  const rounded = Math.round(pct * 10) / 10;
  if (Math.abs(rounded) < 0.05) return <span className="text-[11.5px] text-muted">flat</span>;

  const color =
    goodDirection === "none"
      ? "var(--ink-muted)"
      : (goodDirection === "up" ? rounded > 0 : rounded < 0)
        ? "var(--color-good)"
        : "var(--color-urgent)";

  return (
    <span className="text-[11.5px] font-semibold" style={{ color }}>
      {rounded > 0 ? "+" : ""}
      {rounded}%
    </span>
  );
}

export function ClientDot({ color }: { color?: string | null }) {
  if (!color) return null;
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

export const SEVERITY_TONE: Record<string, Tone> = {
  urgent: "urgent",
  important: "warn",
  fyi: "info",
};
