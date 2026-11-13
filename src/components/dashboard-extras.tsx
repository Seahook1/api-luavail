import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Range = "7" | "30";
const db = supabase as any;

export function InsightsPanel() {
  const [range, setRange] = useState<Range>("7");
  const [prefs, setPrefs] = useState<DashboardPrefs>(defaultPrefs);
  useEffect(() => { try { const saved = localStorage.getItem(PREF_KEY); if (saved) { const next = { ...defaultPrefs, ...JSON.parse(saved) }; setPrefs(next); setRange(next.range); } } catch { /* use defaults */ } }, []);
  const accentColor = prefs.accent === "blue" ? "#67e8f9" : prefs.accent === "green" ? "#6ee7b7" : "#a78bfa";
  const [scripts, setScripts] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [usage, setUsage] = useState<any[]>([]);
  const [status, setStatus] = useState<"checking" | "online" | "error">("checking");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - Number(range) * 86400000).toISOString();
    const [s, l, u] = await Promise.all([
      db.from("scripts").select("id,name,executions,enabled,maintenance_mode"),
      supabase.from("execution_logs").select("id,script_id,result,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
      db.from("api_usage_events").select("id,method,path,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
    ]);
    setScripts(s.data ?? []);
    setLogs(l.data ?? []);
    setUsage(u.data ?? []);
    setStatus(s.error || l.error || u.error ? "error" : "online");
    setLoading(false);
  };
  useEffect(() => {
    void load();
    const channel = supabase.channel("global-dashboard-activity")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "execution_logs" }, (payload) => {
        setLogs((current) => [payload.new, ...current].slice(0, 2000));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "api_usage_events" }, (payload) => {
        setUsage((current) => [payload.new, ...current].slice(0, 2000));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [range]);

  const series = useMemo(() => {
    const days = Number(range);
    return Array.from({ length: days }, (_, i) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (days - 1 - i));
      const next = date.getTime() + 86400000;
      return {
        day: date.toLocaleDateString([], { month: "short", day: "numeric" }),
        executions: logs.filter((x) => {
          const t = new Date(x.created_at).getTime();
          return t >= date.getTime() && t < next;
        }).length,
        api: usage.filter((x) => {
          const t = new Date(x.created_at).getTime();
          return t >= date.getTime() && t < next;
        }).length,
      };
    });
  }, [logs, usage, range]);

  const success = logs.filter((x) => x.result === "success" || x.result === "ok").length;
  const stats = [
    ["Total scripts", scripts.length.toLocaleString()],
    ["Executions", logs.length.toLocaleString()],
    ["Successful runs", success.toLocaleString()],
    ["API requests", usage.length.toLocaleString()],
  ];
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Overview</p><h1 className="mt-1 text-2xl font-semibold text-white">Analytics</h1><p className="mt-1 text-sm text-zinc-500">Usage across all of your scripts.</p></div>
        <div className="flex items-center gap-2">
          <select value={range} onChange={(e) => setRange(e.target.value as Range)} className="rounded-lg border border-white/10 bg-[#111115] px-3 py-2 text-xs text-zinc-200"><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>Refresh</Button>
        </div>
      </div>
      {prefs.showStats && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(([label, value]) => <div key={label} className="rounded-xl border border-white/[0.07] bg-[#101014] p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</p></div>)}
      </div>}
      {prefs.showChart && <div className="rounded-xl border border-white/[0.07] bg-[#101014] p-4 sm:p-5">
        <div className="mb-4"><h2 className="text-sm font-semibold text-white">Activity overview</h2><p className="mt-1 text-xs text-zinc-500">Daily executions and authenticated API requests</p></div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
              <defs><linearGradient id="globalExecFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a78bfa" stopOpacity={0.28}/><stop offset="95%" stopColor="#a78bfa" stopOpacity={0}/></linearGradient></defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false}/>
              <XAxis dataKey="day" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false}/>
              <YAxis allowDecimals={false} tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{ background: "#17171c", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#fff", fontSize: 12 }}/>
              <Area type="monotone" dataKey="executions" name="Executions" stroke={accentColor} fill="url(#globalExecFill)" strokeWidth={2}/>
              <Area type="monotone" dataKey="api" name="API requests" stroke="#67e8f9" fill="transparent" strokeWidth={1.5}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>}
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-xl border border-white/[0.07] bg-[#101014] p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-white">Script status</h2><span className="text-xs text-zinc-500">{scripts.length} total</span></div>
          <div className="space-y-2">{scripts.map((s) => <div key={s.id} className="flex items-center justify-between gap-3 border-b border-white/[0.05] py-2 last:border-0"><span className="truncate text-sm text-zinc-300">{s.name}</span><span className={`shrink-0 text-[10px] ${s.maintenance_mode ? "text-amber-300" : s.enabled ? "text-emerald-300" : "text-zinc-500"}`}>{s.maintenance_mode ? "Maintenance" : s.enabled ? "Enabled" : "Disabled"}</span></div>)}{scripts.length===0 && <p className="text-xs text-zinc-500">No scripts found.</p>}</div>
        </div>
        {prefs.showStatus && <div className="rounded-xl border border-white/[0.07] bg-[#101014] p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-white">System status</h2><span className={`rounded-full px-2 py-1 text-[10px] ${status==="online" ? "bg-emerald-400/10 text-emerald-300" : status==="error" ? "bg-rose-400/10 text-rose-300" : "bg-white/5 text-zinc-400"}`}>{status==="online" ? "CONNECTED" : status==="error" ? "CHECK FAILED" : "CHECKING"}</span></div>
          <p className="text-sm text-zinc-400">Dashboard database connectivity</p><p className="mt-1 text-xs text-zinc-600">This checks the dashboard's Supabase queries, not third-party hosting or global uptime.</p>
          <Button size="sm" variant="outline" className="mt-4" onClick={() => void load()} disabled={loading}>Run check</Button>
        </div>}
      </div>
      <p className="text-[11px] text-zinc-600">API usage counts authenticated API-key requests. Execution totals are based on recorded delivery events. No IP or address data is collected by these analytics.</p>
    </section>
  );
}

export function ActivityPanel() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    const { data, error } = await db.from("audit_events").select("id,action,entity_type,entity_id,created_at").order("created_at", { ascending: false }).limit(150);
    if (error) toast.error("Could not load the audit log. Apply the dashboard migration first.");
    setEvents(data ?? []);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  return <section className="space-y-4"><div className="flex items-end justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Security</p><h1 className="mt-1 text-2xl font-semibold text-white">Audit log</h1><p className="mt-1 text-sm text-zinc-500">Recent script and license-key changes.</p></div><Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>Refresh</Button></div><div className="rounded-xl border border-white/[0.07] bg-[#101014] p-3">{events.map((e) => <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] px-2 py-3 last:border-0"><div><p className="text-sm text-zinc-200"><span className="capitalize">{e.action}</span> {e.entity_type.replaceAll("_"," ")}</p><p className="mt-1 text-[11px] text-zinc-600">{e.entity_id ?? "Record"}</p></div><time className="text-[11px] text-zinc-500">{new Date(e.created_at).toLocaleString()}</time></div>)}{!events.length && <p className="p-4 text-sm text-zinc-500">{loading ? "Loading…" : "No audit events yet."}</p>}</div></section>;
}


type DashboardPrefs = { showStats: boolean; showChart: boolean; showStatus: boolean; range: "7" | "30"; accent: "violet" | "blue" | "green" };
const PREF_KEY = "vault-dashboard-preferences";
const defaultPrefs: DashboardPrefs = { showStats: true, showChart: true, showStatus: true, range: "7", accent: "violet" };

export function PreferencesPanel() {
  const [prefs, setPrefs] = useState<DashboardPrefs>(defaultPrefs);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PREF_KEY);
      if (saved) setPrefs({ ...defaultPrefs, ...JSON.parse(saved) });
    } catch { /* keep defaults */ }
  }, []);
  const save = (next: DashboardPrefs) => {
    setPrefs(next);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); toast.success("Dashboard preferences saved"); }
    catch { toast.error("Could not save preferences in this browser."); }
  };
  return <section className="mx-auto max-w-3xl space-y-5">
    <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Workspace</p><h1 className="mt-1 text-2xl font-semibold text-white">Dashboard preferences</h1><p className="mt-1 text-sm text-zinc-500">Choose which analytics widgets appear and set your default view.</p></div>
    <div className="rounded-xl border border-white/[0.07] bg-[#101014] p-4 space-y-4">
      <h2 className="text-sm font-semibold text-white">Visible widgets</h2>
      {([["showStats","Summary cards"],["showChart","Activity chart"],["showStatus","System status"]] as const).map(([key,label]) => <label key={key} className="flex items-center justify-between gap-3 border-b border-white/[0.05] py-2 last:border-0"><span className="text-sm text-zinc-300">{label}</span><input type="checkbox" checked={prefs[key]} onChange={(e) => save({ ...prefs, [key]: e.target.checked })}/></label>)}
    </div>
    <div className="rounded-xl border border-white/[0.07] bg-[#101014] p-4 space-y-4">
      <div><h2 className="text-sm font-semibold text-white">Default analytics range</h2><p className="mt-1 text-xs text-zinc-500">You can still change this directly on the Analytics page.</p></div>
      <select value={prefs.range} onChange={(e) => save({ ...prefs, range: e.target.value as "7" | "30" })} className="rounded-lg border border-white/10 bg-[#111115] px-3 py-2 text-xs text-zinc-200"><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
    </div>
    <div className="rounded-xl border border-white/[0.07] bg-[#101014] p-4 space-y-3">
      <h2 className="text-sm font-semibold text-white">Chart accent</h2>
      <div className="flex flex-wrap gap-2">{(["violet","blue","green"] as const).map((accent) => <Button key={accent} size="sm" variant={prefs.accent===accent ? "default" : "outline"} onClick={() => save({ ...prefs, accent })}>{accent[0]!.toUpperCase()+accent.slice(1)}</Button>)}</div>
      <p className="text-[11px] text-zinc-600">Preferences are stored in this browser and do not affect other dashboard users.</p>
    </div>
  </section>;
}
