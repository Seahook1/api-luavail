import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LayoutDashboard, Code2, Bot, KeyRound, UserRound, ShieldCheck, ChartNoAxesCombined, ScrollText } from "lucide-react";
import { useAppSession } from "@/components/session-provider";
import { getAdminAccess } from "@/lib/admin.functions";
import { canShowAdminTab } from "@/lib/admin-navigation";

const TABS = [
  { id: "home", label: "Overview", group: "Workspace", icon: LayoutDashboard },
  { id: "scripts", label: "Scripts", group: "Workspace", icon: Code2 },
  { id: "discord", label: "Discord bot", group: "Integrations", icon: Bot },
  { id: "api", label: "API keys", group: "Integrations", icon: KeyRound },\n  { id: "insights", label: "Analytics", group: "Insights", icon: ChartNoAxesCombined },\n  { id: "activity", label: "Audit log", group: "Insights", icon: ScrollText },
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

  const linkClass = (selected: boolean) =>
    `group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors ${
      selected
        ? "bg-violet-400/[0.09] text-white before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:rounded-full before:bg-violet-300"
        : "text-zinc-500 hover:bg-white/[0.035] hover:text-zinc-200"
    }`;

  const navGroup = (label: string, tabs: readonly (typeof TABS)[number][]) => (
    <div className="mb-7">
      <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-700">{label}</div>
      <div className="space-y-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <Link
              key={tab.id}
              to="/"
              search={{ tab: tab.id }}
              aria-current={active === tab.id ? "page" : undefined}
              className={linkClass(active === tab.id)}
            >
              <Icon size={15} strokeWidth={1.8} className={active === tab.id ? "text-violet-200" : "text-zinc-600 group-hover:text-zinc-300"} />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-[216px] flex-col border-r border-white/[0.06] bg-[#09090b] px-3 py-6 md:flex">
        <Link to="/" search={{ tab: "home" }} className="mb-12 flex items-center gap-3 px-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-300/15 bg-violet-300/[0.08] text-xs font-semibold text-violet-200">V</span>
          <span className="text-[13px] font-semibold tracking-[0.19em] text-zinc-100">VAULT<span className="text-violet-300">.</span></span>
        </Link>
        <nav aria-label="Main navigation" className="flex-1">
          {navGroup("Workspace", TABS.filter((tab) => tab.group === "Workspace"))}
          {navGroup("Integrations", TABS.filter((tab) => tab.group === "Integrations"))}\n          {navGroup("Insights", TABS.filter((tab) => tab.group === "Insights"))}
          <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-700">Account</div>
          <div className="space-y-1">
            <Link to="/redeem" aria-current={active === "buyer" ? "page" : undefined} className={linkClass(active === "buyer")}>
              <UserRound size={15} strokeWidth={1.8} className="text-zinc-600" />Buyer portal
            </Link>
            {showAdmin && (
              <Link to="/admin" aria-current={active === "admin" ? "page" : undefined} className={linkClass(active === "admin")}>
                <ShieldCheck size={15} strokeWidth={1.8} className="text-zinc-600" />Admin
              </Link>
            )}
          </div>
        </nav>
        <div className="border-t border-white/[0.06] px-3 pt-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-700">Vault dashboard</div>
          <p className="mt-1 text-[11px] text-zinc-600">Script management</p>
        </div>
      </aside>
      <nav aria-label="Mobile navigation" className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#09090b]/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="mb-3 flex items-center gap-2 px-1">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-violet-300/15 bg-violet-300/[0.08] text-[11px] font-semibold text-violet-200">V</span>
          <span className="text-xs font-semibold tracking-[0.18em] text-zinc-100">VAULT<span className="text-violet-300">.</span></span>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-0.5">
          {TABS.map((tab) => (
            <Link key={tab.id} to="/" search={{ tab: tab.id }} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors ${active === tab.id ? "bg-violet-300/[0.1] text-violet-100" : "text-zinc-500 hover:text-zinc-200"}`}>
              {tab.label}
            </Link>
          ))}
          <Link to="/redeem" className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium ${active === "buyer" ? "bg-violet-300/[0.1] text-violet-100" : "text-zinc-500"}`}>Buyer portal</Link>
          {showAdmin && <Link to="/admin" className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium ${active === "admin" ? "bg-violet-300/[0.1] text-violet-100" : "text-zinc-500"}`}>Admin</Link>}
        </div>
      </nav>
    </>
  );
}
