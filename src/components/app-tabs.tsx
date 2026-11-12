import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAppSession } from "@/components/session-provider";
import { getAdminAccess } from "@/lib/admin.functions";
import { canShowAdminTab } from "@/lib/admin-navigation";

const TABS = [
  { id: "home", label: "Overview", group: "Workspace" },
  { id: "scripts", label: "Scripts", group: "Workspace" },
  { id: "discord", label: "Discord bot", group: "Integrations" },
  { id: "api", label: "API keys", group: "Integrations" },
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
    `group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${
      selected
        ? "bg-white/[0.09] text-white ring-1 ring-inset ring-white/[0.12]"
        : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
    }`;
  const links = (
    <>
      <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Workspace</div>
      {TABS.filter((tab) => tab.group === "Workspace").map((tab) => (
        <Link key={tab.id} to="/" search={{ tab: tab.id }} aria-current={active === tab.id ? "page" : undefined} className={linkClass(active === tab.id)}>
          <span className="w-4 text-center text-xs">{tab.id === "home" ? "⌂" : "▤"}</span>{tab.label}
        </Link>
      ))}
      <div className="mb-2 mt-7 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Integrations</div>
      {TABS.filter((tab) => tab.group === "Integrations").map((tab) => (
        <Link key={tab.id} to="/" search={{ tab: tab.id }} aria-current={active === tab.id ? "page" : undefined} className={linkClass(active === tab.id)}>
          <span className="w-4 text-center text-xs">{tab.id === "discord" ? "◈" : "⌘"}</span>{tab.label}
        </Link>
      ))}
      <div className="mb-2 mt-7 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Account</div>
      <Link to="/redeem" aria-current={active === "buyer" ? "page" : undefined} className={linkClass(active === "buyer")}>
        <span className="w-4 text-center text-xs">◇</span>Buyer portal
      </Link>
      {showAdmin && <Link to="/admin" aria-current={active === "admin" ? "page" : undefined} className={linkClass(active === "admin")}>
        <span className="w-4 text-center text-xs">⚙</span>Admin
      </Link>}
    </>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-[232px] flex-col border-r border-white/[0.07] bg-[#0b0a10] px-4 py-5 md:flex">
        <Link to="/" search={{ tab: "home" }} className="mb-10 flex items-center gap-3 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/10 text-sm font-bold text-violet-300">V</span>
          <span className="text-sm font-bold tracking-[0.16em] text-zinc-100">VAULT<span className="ml-1 text-zinc-500">.</span><span className="mt-0.5 block text-[10px] font-normal tracking-normal text-zinc-600">SCRIPT MANAGEMENT</span></span>
        </Link>
        <nav aria-label="Main navigation" className="flex-1">{links}</nav>
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
          <div className="flex items-center gap-2 text-xs text-zinc-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />All systems operational</div>
          <p className="mt-1.5 pl-3.5 text-[10px] text-zinc-600">Vault dashboard</p>
        </div>
      </aside>
      <nav aria-label="Mobile navigation" className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#0b0a10]/95 px-3 py-3 backdrop-blur md:hidden">
        <div className="mb-3 flex items-center gap-2 px-1">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/10 text-xs font-bold text-violet-300">V</span>
          <span className="text-xs font-bold tracking-[0.16em] text-zinc-100">VAULT</span>
        </div>
        <div className="flex gap-1 overflow-x-auto">{TABS.map((tab) => <Link key={tab.id} to="/" search={{ tab: tab.id }} className={`whitespace-nowrap rounded-md px-3 py-2 text-xs ${active === tab.id ? "bg-white/[0.09] text-white" : "text-zinc-400"}`}>{tab.label}</Link>)}<Link to="/redeem" className="whitespace-nowrap rounded-md px-3 py-2 text-xs text-zinc-400">Buyer portal</Link>{showAdmin && <Link to="/admin" className="whitespace-nowrap rounded-md px-3 py-2 text-xs text-zinc-400">Admin</Link>}</div>
      </nav>
    </>
  );
}
