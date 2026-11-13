import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const db = supabase as any;

export function PlatformToolsPanel() {
  const [lockdown, setLockdown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<any[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiResult, setApiResult] = useState("");
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const load = async () => {
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    const { data: adminResult } = auth.user ? await supabase.rpc("has_role", { _user_id: auth.user.id, _role: "admin" }) : { data: false };
    const admin = adminResult === true;
    setIsAdmin(admin);
    let ticketQuery = db.from("support_tickets").select("id,owner_id,subject,message,status,reply,created_at,updated_at").order("created_at", { ascending: false }).limit(50);
    if (!admin) ticketQuery = ticketQuery.eq("owner_id", auth.user?.id ?? "");
    const [setting, ticketRows, webhookRows] = await Promise.all([
      db.from("platform_settings").select("emergency_lockdown").maybeSingle(),
      ticketQuery,
      db.from("webhook_deliveries").select("id,script_id,event_type,status,response_code,created_at").order("created_at", { ascending: false }).limit(100),
    ]);
    setLockdown(!!setting.data?.emergency_lockdown);
    setTickets(ticketRows.data ?? []);
    setDeliveries(webhookRows.data ?? []);
    if (setting.error || ticketRows.error || webhookRows.error) {
      toast.error("Some tools could not load. Apply the platform tools migration first.");
    }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const setEmergencyLockdown = async () => {
    const next = !lockdown;
    if (next && !confirm("Emergency lockdown will block new script payload deliveries and revoke active sessions for your scripts. Continue?")) return;
    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setBusy(false); return; }
    const { error } = await db.from("platform_settings").upsert({ owner_id: auth.user.id, emergency_lockdown: next, updated_at: new Date().toISOString() });
    if (!error && next) {
      const { data: owned } = await db.from("scripts").select("id");
      const ids = (owned ?? []).map((script: any) => script.id);
      if (ids.length) await db.from("execution_tokens").update({ revoked: true }).in("script_id", ids).eq("revoked", false);
    }
    setBusy(false);
    if (error) toast.error(error.message);
    else { setLockdown(next); toast.success(next ? "Emergency lockdown enabled" : "Emergency lockdown disabled"); }
  };

  const submitTicket = async () => {
    if (subject.trim().length < 3 || message.trim().length < 5) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { error } = await db.from("support_tickets").insert({ owner_id: auth.user.id, subject: subject.trim(), message: message.trim() });
    if (error) toast.error(error.message);
    else { setSubject(""); setMessage(""); toast.success("Support ticket submitted"); void load(); }
  };

  const replyToTicket = async (ticketId: string) => {
    const reply = (replyDrafts[ticketId] ?? "").trim();
    if (!reply) return;
    const { error } = await db.from("support_tickets").update({ reply, status: "in_progress", updated_at: new Date().toISOString() }).eq("id", ticketId);
    if (error) toast.error(error.message);
    else { toast.success("Reply saved"); setReplyDrafts((current) => ({ ...current, [ticketId]: "" })); void load(); }
  };

  const runApiExample = async (method: "GET" | "POST") => {
    if (!apiKey.trim()) { toast.error("Enter your API key first"); return; }
    setBusy(true);
    try {
      const response = await fetch(origin + "/api/public/v1/scripts", {
        method,
        headers: { Authorization: "Bearer " + apiKey.trim(), ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
        ...(method === "POST" ? { body: JSON.stringify({ name: "API Playground Test", source: 'print("Hello from API Luavail")', keyless: true }) } : {}),
      });
      const body = await response.text();
      setApiResult("HTTP " + response.status + "\\n" + body.slice(0, 12000));
    } catch (error) {
      setApiResult(String(error));
    } finally { setBusy(false); }
  };

  return <section className="mx-auto max-w-4xl space-y-5">
    <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Workspace utilities</p><h1 className="mt-1 text-2xl font-semibold text-white">Platform tools</h1><p className="mt-1 text-sm text-zinc-500">Emergency controls, support, API testing and webhook history.</p></div>
    <div className="rounded-xl border border-white/[0.07] bg-[#101014] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-white">Emergency lockdown</h2><p className="mt-1 text-xs text-zinc-500">Blocks new payload deliveries and revokes active sessions for your scripts.</p></div><Button size="sm" variant={lockdown ? "destructive" : "outline"} disabled={busy || loading} onClick={() => void setEmergencyLockdown()}>{lockdown ? "Disable lockdown" : "Enable lockdown"}</Button></div>
      <p className={lockdown ? "text-xs text-rose-300" : "text-xs text-emerald-300"}>{lockdown ? "Lockdown is ACTIVE" : "Lockdown is inactive"}</p>
    </div>
    <div className="rounded-xl border border-white/[0.07] bg-[#101014] p-4 space-y-3">
      <div><h2 className="text-sm font-semibold text-white">API playground</h2><p className="mt-1 text-xs text-zinc-500">Test the authenticated scripts endpoint. POST creates a test script in your account.</p></div>
      <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="vk_ API key" />
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void runApiExample("GET")}>GET scripts</Button><Button size="sm" disabled={busy} onClick={() => void runApiExample("POST")}>POST test script</Button></div>
      {apiResult && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-white/[0.07] bg-black/30 p-3 text-xs text-zinc-300">{apiResult}</pre>}
    </div>
    <div className="rounded-xl border border-white/[0.07] bg-[#101014] p-4 space-y-3">
      <div><h2 className="text-sm font-semibold text-white">Support tickets</h2><p className="mt-1 text-xs text-zinc-500">Submit an issue for the API Luavail team. Your tickets are private to your account.</p></div>
      <Input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={120} placeholder="Ticket subject" />
      <Textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} maxLength={5000} placeholder="Describe the issue…" />
      <Button size="sm" disabled={busy || subject.trim().length < 3 || message.trim().length < 5} onClick={() => void submitTicket()}>Submit ticket</Button>
      <div className="space-y-2">{tickets.map((ticket) => <article key={ticket.id} className="rounded-lg border border-white/[0.06] p-3"><div className="flex flex-wrap justify-between gap-2"><span className="text-sm text-zinc-200">{ticket.subject}</span><span className="text-[10px] uppercase text-zinc-500">{ticket.status.replaceAll("_"," ")}</span></div><p className="mt-2 whitespace-pre-wrap text-xs text-zinc-400">{ticket.message}</p>{ticket.reply && <p className="mt-2 border-l-2 border-violet-400 pl-3 text-xs text-violet-200">Reply: {ticket.reply}</p>}{isAdmin && <div className="mt-3 flex flex-wrap gap-2"><Input value={replyDrafts[ticket.id] ?? ""} onChange={(event) => setReplyDrafts((current) => ({ ...current, [ticket.id]: event.target.value }))} placeholder="Staff reply…" /><Button size="sm" onClick={() => void replyToTicket(ticket.id)}>Reply</Button></div>}<time className="mt-2 block text-[10px] text-zinc-600">{new Date(ticket.created_at).toLocaleString()}{isAdmin ? " · " + ticket.owner_id : ""}</time></article>)}{!tickets.length && <p className="text-xs text-zinc-600">{loading ? "Loading tickets…" : "No tickets yet."}</p>}</div>
    </div>
    <div className="rounded-xl border border-white/[0.07] bg-[#101014] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2"><div><h2 className="text-sm font-semibold text-white">Webhook delivery history</h2><p className="mt-1 text-xs text-zinc-500">Recent Discord webhook delivery attempts.</p></div><Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>Refresh</Button></div>
      {deliveries.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] py-2 text-xs last:border-0"><span className="text-zinc-300">{item.event_type.replaceAll("_"," ")}</span><span className={item.status === "success" ? "text-emerald-300" : "text-rose-300"}>{item.status}{item.response_code ? " · HTTP " + item.response_code : ""}</span><time className="text-zinc-600">{new Date(item.created_at).toLocaleString()}</time></div>)}
      {!deliveries.length && <p className="text-xs text-zinc-600">{loading ? "Loading deliveries…" : "No webhook deliveries recorded yet."}</p>}
    </div>
    <p className="text-[11px] text-zinc-600">No IP addresses, network addresses or raw HWIDs are collected by these tools. Staff can reply to tickets from this panel.</p>
  </section>;
}
