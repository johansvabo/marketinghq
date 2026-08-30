"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BrainCircuit,
  CalendarClock,
  Building2,
  CheckSquare,
  FolderKanban,
  Lightbulb,
  Moon,
  Settings,
  Sun,
  Sunrise,
} from "lucide-react";
import { clsx } from "clsx";

type NavItem = { href: string; label: string; icon: typeof Sunrise; exact?: boolean };

const NAV: NavItem[] = [
  { href: "/", label: "Today", icon: Sunrise, exact: true },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/brain", label: "Brain", icon: BrainCircuit },
  { href: "/insights", label: "Insights", icon: Lightbulb },
  { href: "/reports", label: "Reports", icon: CalendarClock },
];

/** The five that fit a thumb. Settings lives behind the header on mobile. */
/** The five that fit a thumb; the rest live behind the header on mobile. */
const MOBILE_NAV = NAV.filter((item) => item.label !== "Insights" && item.label !== "Projects");

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("mhq-theme") as "dark" | "light" | null;
    setTheme(stored ?? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("mhq-theme", next);
    } catch {
      /* private browsing — the theme just won't persist */
    }
  }

  return (
    <button onClick={toggle} className="btn btn-ghost btn-sm" aria-label="Switch theme" title="Switch theme">
      {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  );
}

export function AppShell({ children, signalCount }: { children: React.ReactNode; signalCount: number }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh">
      {/* ------------------------------------------------------- desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[216px] flex-col border-r px-3 py-4 md:flex" style={{ background: "var(--surface)" }}>
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
          <span
            className="grid h-8 w-8 place-items-center rounded-[9px] text-[13px] font-black"
            style={{ background: "var(--color-brand)", color: "var(--color-brand-ink)" }}
          >
            HQ
          </span>
          <span className="text-[13.5px] font-semibold tracking-tight">Marketing HQ</span>
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(pathname, href, exact);
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[13.5px] font-medium transition-colors",
                  active ? "text-[var(--ink)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]",
                )}
                style={active ? { background: "var(--raised)" } : undefined}
              >
                <Icon size={16} strokeWidth={active ? 2.3 : 1.9} />
                {label}
                {label === "Today" && signalCount > 0 && (
                  <span
                    className="ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                    style={{ background: "var(--color-brand)", color: "var(--color-brand-ink)" }}
                  >
                    {signalCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1 border-t pt-3">
          <Link
            href="/settings"
            className={clsx(
              "flex flex-1 items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[13px] font-medium",
              isActive(pathname, "/settings") ? "text-[var(--ink)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]",
            )}
          >
            <Settings size={16} strokeWidth={1.9} />
            Settings
          </Link>
          <ThemeToggle />
        </div>
      </aside>

      {/* ------------------------------------------------------- mobile header */}
      <header
        className="sticky top-0 z-30 flex items-center gap-2 border-b px-4 py-3 md:hidden"
        style={{ background: "color-mix(in oklch, var(--canvas) 88%, transparent)", backdropFilter: "blur(12px)" }}
      >
        <Link href="/" className="flex items-center gap-2">
          <span
            className="grid h-7 w-7 place-items-center rounded-lg text-[11px] font-black"
            style={{ background: "var(--color-brand)", color: "var(--color-brand-ink)" }}
          >
            HQ
          </span>
          <span className="text-[14px] font-semibold tracking-tight">Marketing HQ</span>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Link href="/settings" className="btn btn-ghost btn-sm" aria-label="Settings">
            <Settings size={15} />
          </Link>
        </div>
      </header>

      <main className="md:pl-[216px]">
        <div className="mx-auto w-full max-w-[1180px] px-4 pb-28 pt-4 md:px-8 md:pb-12 md:pt-8">{children}</div>
      </main>

      {/* ---------------------------------------------------- mobile tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t md:hidden"
        style={{
          background: "color-mix(in oklch, var(--surface) 92%, transparent)",
          backdropFilter: "blur(16px)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {MOBILE_NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(pathname, href, exact);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors",
                active ? "text-[var(--ink)]" : "text-[var(--ink-muted)]",
              )}
            >
              <Icon size={19} strokeWidth={active ? 2.3 : 1.8} />
              {label}
              {label === "Today" && signalCount > 0 && (
                <span
                  className="absolute right-[22%] top-1.5 h-1.5 w-1.5 rounded-full"
                  style={{ background: "var(--color-brand)" }}
                />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
