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
  tone,
  spine = false,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  /** Paints a tinted ground and matching edge. Reserved for state, never identity. */
  tone?: Tone;
  /** Wear the tone as a left spine — scannable down a column of cards. */
  spine?: boolean;
}) {
  return (
    <section className={clsx("card", padded && "p-4 md:p-5", className)} style={toneStyle(tone, { spine })}>
      {children}
    </section>
  );
}

const ZONE_ICON_TONE: Record<Tone, string> = {
  neutral: "var(--ink-muted)",
  brand: "var(--color-brand)",
  urgent: "var(--color-urgent)",
  warn: "var(--color-warn)",
  good: "var(--color-good)",
  info: "var(--color-info)",
};

/**
 * A titled region. The header plus the space around it is what makes a page read
 * as a few areas rather than one long list of equally-important boxes.
 */
export function Zone({
  title,
  icon,
  count,
  tone = "neutral",
  aside,
  children,
}: {
  title: string;
  icon?: ReactNode;
  count?: number;
  tone?: Tone;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={{ ["--tone" as string]: ZONE_ICON_TONE[tone] }}>
      <header className="zone-head">
        {icon && <span className="zone-icon">{icon}</span>}
        <h2 className="zone-title">{title}</h2>
        {aside && <span className="text-[11.5px] text-muted">{aside}</span>}
        {count !== undefined && <span className="zone-count">{count}</span>}
      </header>
      {children}
    </section>
  );
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

/**
 * The inline style a tone paints: tinted ground, matching edge, and the --tone
 * variable that a spine or a nested badge reads from. Inline rather than a CSS
 * class because Tailwind v4's `card` utility sits in a later cascade layer and
 * would otherwise overwrite the background.
 */
export function toneStyle(tone: Tone | undefined, opts: { spine?: boolean; strength?: number } = {}) {
  if (!tone || tone === "neutral") return undefined;
  const hue = TONES[tone].color;
  return {
    ["--tone" as string]: hue,
    background: `color-mix(in oklch, ${hue} calc(var(--tint-strength) * ${opts.strength ?? 1}), var(--surface))`,
    borderColor: `color-mix(in oklch, ${hue} var(--tint-edge), var(--hairline))`,
    ...(opts.spine ? { borderLeft: `3px solid ${hue}` } : {}),
  } as React.CSSProperties;
}

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

export type StatItem = { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone };

/**
 * One strip, divided — not four floating boxes. Four separate cards give four
 * equal claims on attention; a single divided strip reads as one instrument
 * panel, and lets the leading figure actually lead.
 */
export function StatStrip({ items }: { items: StatItem[] }) {
  return (
    <div className="card grid grid-cols-2 overflow-hidden md:grid-cols-4">
      {items.map((item, index) => {
        const tone = item.tone ?? "neutral";
        return (
          <div
            key={item.label}
            className={clsx(
              "px-4 py-3.5",
              index % 2 === 1 && "border-l md:border-l",
              index >= 2 && "border-t md:border-t-0",
              index === 2 && "md:border-l",
              index === 3 && "md:border-l",
            )}
          >
            <div className="section-title">{item.label}</div>
            <div
              className={clsx("mt-1.5 font-bold leading-none tracking-[-0.03em]", index === 0 ? "text-[30px]" : "text-[22px]")}
              style={{ color: tone === "neutral" ? "var(--ink)" : TONES[tone].color }}
            >
              {item.value}
            </div>
            {item.hint && <div className="mt-1.5 text-[11.5px] leading-snug text-muted">{item.hint}</div>}
          </div>
        );
      })}
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
/**
 * The trend line is context, not the message — so it wears the de-emphasis ink
 * rather than an accent. The deltas beside it carry the signal, and four amber
 * sparklines would out-shout them.
 */
export function Sparkline({
  points,
  tone,
  height = 34,
  width = 120,
}: {
  points: number[];
  /** Omit for the de-emphasised default; pass a tone only to make a point. */
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
  const color = tone ? TONES[tone].color : "var(--ink-muted)";
  const gradientId = `spark-${tone ?? "muted"}-${points.length}-${Math.round(points[0] ?? 0)}`;

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

/**
 * A client's colour on its own tinted pill. Always paired with the name — hue is
 * the fast channel, the word is the reliable one.
 */
export function ClientBadge({
  name,
  color,
  size = "sm",
}: {
  name: string;
  color?: string | null;
  size?: "sm" | "md";
}) {
  const hue = color ?? "var(--ink-muted)";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full font-semibold",
        size === "md" ? "px-2.5 py-1 text-[12px]" : "px-2 py-0.5 text-[11px]",
      )}
      style={{
        background: `color-mix(in oklch, ${hue} 14%, var(--surface))`,
        color: `color-mix(in oklch, ${hue} 72%, var(--ink))`,
        border: `1px solid color-mix(in oklch, ${hue} 26%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: hue }} />
      {name}
    </span>
  );
}

export const SEVERITY_TONE: Record<string, Tone> = {
  urgent: "urgent",
  important: "warn",
  fyi: "info",
};
