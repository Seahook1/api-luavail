import { Link, useLocation } from "@tanstack/react-router";

const TABS = [
  { id: "scripts", label: "Scripts" },
  { id: "discord", label: "Discord" },
  { id: "api", label: "API keys" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AppTabs() {
  const location = useLocation();
  const params = new URLSearchParams(location.searchStr);
  const active: TabId | "buyer" =
    location.pathname === "/" ? (params.get("tab") as TabId) ?? "scripts" : "buyer";

  const base =
    "relative px-3 py-3 text-sm font-medium tracking-tight whitespace-nowrap transition-colors sm:px-4";
  const off = "text-muted-foreground hover:text-foreground";
  const on = "text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary";

  return (
    <nav aria-label="Main tabs" className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur text-foreground">
      <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-2">
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            to="/"
            search={{ tab: tab.id }}
            aria-current={active === tab.id ? "page" : undefined}
            className={`${base} ${active === tab.id ? on : off}`}
          >
            {tab.label}
          </Link>
        ))}
        <span aria-hidden className="mx-1 hidden h-5 w-px shrink-0 bg-border sm:mx-2 sm:block" />
        <Link
          to="/redeem"
          aria-current={active === "buyer" ? "page" : undefined}
          className={`${base} ${active === "buyer" ? on : off}`}
        >
          Buyer<span className="hidden sm:inline"> portal</span>
        </Link>
      </div>
    </nav>
  );
}
