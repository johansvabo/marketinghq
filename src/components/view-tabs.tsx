import Link from "next/link";

/**
 * One view at a time. The client page used to stack every section on one
 * page in two parallel columns, which read as a pile rather than a place.
 */
export function ViewTabs({
  base,
  current,
  tabs,
}: {
  base: string;
  current: string;
  tabs: { key: string; label: string; count?: number }[];
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={tab.key === tabs[0].key ? base : `${base}?tab=${tab.key}`}
            aria-current={active ? "page" : undefined}
            className={`btn btn-sm ${active ? "btn-primary" : ""}`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={`text-[11px] ${active ? "" : "text-muted"}`}>{tab.count}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
