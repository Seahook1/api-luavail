import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { createBulkLicenseKeys, getKeyCenterData, updateLicenseKeyControl } from "@/lib/key-center.functions";

type KeyRow = {
  id: string; script_id: string; script_name: string; key: string; note: string | null;
  banned: boolean; expires_at: string | null; device_bound: boolean; last_used_at: string | null;
  max_concurrent_sessions: number; created_at: string;
};
type Data = { scripts: { id: string; name: string }[]; keys: KeyRow[]; audit: any[]; failures: any[] };

export function KeyCenterPanel() {
  const load = useServerFn(getKeyCenterData);
  const create = useServerFn(createBulkLicenseKeys);
  const update = useServerFn(updateLicenseKeyControl);
  const [data, setData] = useState<Data>({ scripts: [], keys: [], audit: [], failures: [] });
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [scriptId, setScriptId] = useState("");
  const [count, setCount] = useState("10");
  const [days, setDays] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("all");
  const [freshKeys, setFreshKeys] = useState<string[]>([]);
  const refresh = async () => {
    try { setData(await load() as Data); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not load key center."); }
  };
  useEffect(() => { void refresh(); }, []);
  const visible = useMemo(() => data.keys.filter(k => {
    const q = query.trim().toLowerCase();
    const matches = !q || k.key.toLowerCase().includes(q) || (k.note ?? "").toLowerCase().includes(q) || k.script_name.toLowerCase().includes(q);
    const expired = !!k.expires_at && new Date(k.expires_at).getTime() < Date.now();
    const status = filter === "all" || (filter === "banned" && k.banned) || (filter === "expired" && !k.banned && expired) || (filter === "active" && !k.banned && !expired);
    return matches && status;
  }), [data.keys, query, filter]);
  const active = data.keys.filter(k => !k.banned && (!k.expires_at || new Date(k.expires_at).getTime() >= Date.now())).length;
  const expired = data.keys.filter(k => !k.banned && !!k.expires_at && new Date(k.expires_at).getTime() < Date.now()).length;
  const act = async (keyId: string, action: "ban" | "unban" | "reset-device" | "set-session-limit", limit?: number) => {
    setBusy(true);
    try { await update({ data: { keyId, action, limit } }); toast.success(action === "reset-device" ? "Device binding reset and active sessions revoked." : "Key updated."); await refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not update key."); }
    finally { setBusy(false); }
  };
  const generate = async () => {
    if (!scriptId) { toast.error("Choose a script first."); return; }
    setBusy(true);
    try {
      const result = await create({ data: { scriptId, count: Number(count), days: days ? Number(days) : undefined, note } });
      setFreshKeys(result.keys);
      toast.success(result.keys.length + " keys created.");
      setNote("");
      await refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not create keys."); }
    finally { setBusy(false); }
  };
  const copy = (value: string) => { void navigator.clipboard.writeText(value); toast.success("Copied."); };
  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Licensing</p><h1 className="mt-1 text-2xl font-semibold text-white">Key management</h1><p className="mt-1 text-sm text-zinc-500">Manage licenses, device bindings, and security events across your scripts.</p></header>
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Total keys", data.keys.length], ["Active", active], ["Banned", data.keys.filter(k => k.banned).length], ["Expired", expired],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-white/[0.07] bg-[#101014] p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</p></div>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3 rounded-xl border border-white/[0.07] bg-[#101014] p-4">
          <div><h2 className="font-semibold text-white">Bulk key generator</h2><p className="text-xs text-zinc-500">Generate up to 100 unique keys at once. New keys are shown only once here.</p></div>
          <select value={scriptId} onChange={e => setScriptId(e.target.value)} className="w-full rounded-md border border-white/10 bg-[#09090b] px-3 py-2 text-sm"><option value="">Choose script</option>{data.scripts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <div className="grid grid-cols-2 gap-2"><Input type="number" min="1" max="100" value={count} onChange={e => setCount(e.target.value)} placeholder="Quantity"/><Input type="number" min="1" max="3650" value={days} onChange={e => setDays(e.target.value)} placeholder="Days (blank = lifetime)"/></div>
          <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Buyer note (optional)"/>
          <Button onClick={() => void generate()} disabled={busy || !scriptId}>Generate keys</Button>
          {freshKeys.length > 0 && <div className="space-y-2 rounded-lg border border-blue-300/20 bg-blue-300/[0.04] p-3"><div className="flex items-center justify-between"><b className="text-sm">New keys · copy now</b><Button size="sm" variant="outline" onClick={() => copy(freshKeys.join("\n"))}>Copy all</Button></div><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] text-zinc-300">{freshKeys.join("\n")}</pre><p className="text-[10px] text-zinc-600">For security, refresh hides this one-time display.</p></div>}
        </div>
        <div className="space-y-3 rounded-xl border border-white/[0.07] bg-[#101014] p-4">
          <h2 className="font-semibold text-white">Security center</h2>
          <p className="text-xs text-zinc-500">Recent rejected execution attempts and account audit events.</p>
          <div className="space-y-2"><div className="text-xs font-medium text-zinc-400">Rejected attempts</div>{data.failures.slice(0,8).map(f => <div key={f.id} className="flex items-center justify-between gap-2 rounded-md border border-white/[0.06] px-3 py-2 text-xs"><span className="min-w-0 truncate text-zinc-300">{f.script_name} · {f.result}</span><span className="shrink-0 text-zinc-600">{new Date(f.created_at).toLocaleString()}</span></div>)}{!data.failures.length && <p className="text-xs text-zinc-600">No rejected attempts in the latest 150 events.</p>}</div>
          <div className="space-y-2 border-t border-white/[0.06] pt-3"><div className="text-xs font-medium text-zinc-400">Audit history</div>{data.audit.slice(0,8).map(a => <div key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-white/[0.06] px-3 py-2 text-xs"><span className="text-zinc-300">{a.entity_type} {a.action}</span><span className="shrink-0 text-zinc-600">{new Date(a.created_at).toLocaleString()}</span></div>)}{!data.audit.length && <p className="text-xs text-zinc-600">No audit events yet.</p>}</div>
          <p className="text-[10px] text-zinc-600">No IP addresses or physical addresses are collected or displayed by this panel.</p>
        </div>
      </div>
      <div className="space-y-3 rounded-xl border border-white/[0.07] bg-[#101014] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-white">All license keys</h2><Button size="sm" variant="outline" onClick={() => void refresh()}>Refresh</Button></div>
        <div className="flex flex-wrap gap-2"><Input className="min-w-44 flex-1" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search key, note, or script…"/><select value={filter} onChange={e => setFilter(e.target.value)} className="rounded-md border border-white/10 bg-[#09090b] px-3 text-xs"><option value="all">All statuses</option><option value="active">Active</option><option value="banned">Banned</option><option value="expired">Expired</option></select></div>
        <div className="space-y-2">{visible.map(k => <div key={k.id} className="space-y-2 rounded-lg border border-white/[0.06] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><code className={k.banned ? "break-all text-rose-400 line-through" : "break-all text-blue-200"}>{k.key}</code><p className="mt-1 text-[11px] text-zinc-500">{k.script_name} · {k.note || "No buyer note"} · {k.banned ? "Banned" : k.expires_at && new Date(k.expires_at) < new Date() ? "Expired" : "Active"}</p></div><div className="flex flex-wrap gap-1"><Button size="sm" variant="ghost" onClick={() => copy(k.key)}>Copy</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(k.id, k.banned ? "unban" : "ban")}>{k.banned ? "Unban" : "Ban"}</Button><Button size="sm" variant="ghost" disabled={busy || !k.device_bound} onClick={() => void act(k.id, "reset-device")}>Reset device</Button></div></div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500"><span>Device: {k.device_bound ? "Linked" : "Not linked"}</span><span>·</span><span>Expires: {k.expires_at ? new Date(k.expires_at).toLocaleDateString() : "Never"}</span><span>·</span><span>Last used: {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "Never"}</span><span>·</span><span>Concurrent sessions</span><select value={k.max_concurrent_sessions || 1} onChange={e => void act(k.id, "set-session-limit", Number(e.target.value))} disabled={busy} className="rounded border border-white/10 bg-[#09090b] px-2 py-1"><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={5}>5</option><option value={10}>10</option></select></div>
        </div>)}{!visible.length && <p className="py-8 text-center text-sm text-zinc-600">No keys match these filters.</p>}</div>
      </div>
    </section>
  );
}
