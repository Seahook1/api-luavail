import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAppSession } from "@/components/session-provider";
import { getAdminAccess } from "@/lib/admin.functions";
import { canShowAdminTab } from "@/lib/admin-navigation";

const TABS = [
  { id: "home", label: "Home" },
  { id: "scripts", label: "Scripts" },
  { id: "discord", label: "Discord" },
  { id: "api", label: "API keys" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AppTabs() {
  const { user, ready } = useAppSession();
  const check = useServerFn(getAdminAccess);
  const access = useQuery({
    queryKey: ["admin-access", user?.id],
    queryFn: () => check(),
    enabled: ready && !!user,
    retry: false,
  });
  const showAdmin = canShowAdminTab(ready, user?.id, access.data);
  const location = useLocation();
  const params = new URLSearchParams(location.searchStr);
  const active: TabId | "buyer" | "admin" | null =
    location.pathname === "/"
      ? ((params.get("tab") as TabId) ?? "home")
      : location.pathname === "/admin"
        ? "admin"
        : location.pathname === "/redeem"
          ? "buyer"
          : null;

  const base =
    "relative px-3 py-3 text-sm font-medium tracking-tight whitespace-nowrap transition-colors sm:px-4";
  const off = "text-muted-foreground hover:text-foreground";
  const on =
    "text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary";

  return (
    <nav
      aria-label="Main tabs"
      className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur text-foreground"
    >
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
        {showAdmin && <Link
          to="/admin"
          aria-current={active === "admin" ? "page" : undefined}
          className={`${base} ${active === "admin" ? on : off}`}
        >
          Admin
        </Link>}
      </div>
    </nav>
  );
}
