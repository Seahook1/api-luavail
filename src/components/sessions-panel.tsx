import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getActiveSessions, revokeExecutionSession } from "@/lib/sessions.functions";

type ActiveSession = {
  id: string;
  script_id: string;
  script_name: string;
  executor: string | null;
  roblox_username: string | null;
  roblox_display_name: string | null;
  created_at: string;
  last_heartbeat_at: string | null;
  session_expires_at: string | null;
};

export function SessionsPanel() {
  const getSessions = useServerFn(getActiveSessions);
  const revoke = useServerFn(revokeExecutionSession);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const result = await getSessions();
        if (mounted) setSessions(result as ActiveSession[]);
      } catch {
        if (mounted) toast.error("Could not load active sessions.");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [getSessions]);

  const refreshNow = async () => {
    setLoading(true);
    try { setSessions(await getSessions() as ActiveSession[]); }
    catch { toast.error("Could not refresh sessions."); }
    finally { setLoading(false); }
  };

  const endSession = async (sessionId: string) => {
    setRevoking(sessionId);
    try {
      const result = await revoke({ data: { sessionId } });
      if (result.ok) {
        setSessions((current) => current.filter((session) => session.id !== sessionId));
        toast.success(result.message);
      } else toast.error(result.message);
    } catch {
      toast.error("Could not revoke this session.");
    } finally { setRevoking(null); }
  };

  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Security</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Live sessions</h1>
          <p className="mt-1 text-sm text-zinc-500">Active script sessions, refreshed every 10 seconds.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void refreshNow()} disabled={loading}>Refresh</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/[0.07] bg-[#101014] p-4">
          <p className="text-xs text-zinc-500">Active sessions</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{sessions.length}</p>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-[#101014] p-4">
          <p className="text-xs text-zinc-500">Tracked scripts</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{new Set(sessions.map((session) => session.script_id)).size}</p>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-[#101014] p-4">
          <p className="text-xs text-zinc-500">Refresh interval</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-white">10s</p>
        </div>
      </div>
      <div className="space-y-2">
        {sessions.map((session) => (
          <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-[#101014] p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-white">{session.roblox_display_name || session.roblox_username || "Unknown player"}</span>
                <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">ACTIVE</span>
              </div>
              <p className="mt-1 text-xs text-zinc-400">{session.roblox_username ? "@" + session.roblox_username : "Username unavailable"} · {session.executor || "Unknown executor"}</p>
              <p className="mt-1 truncate text-xs text-zinc-600">{session.script_name} · Last heartbeat {session.last_heartbeat_at ? new Date(session.last_heartbeat_at).toLocaleTimeString() : "not recorded"}</p>
            </div>
            <Button size="sm" variant="destructive" disabled={revoking === session.id} onClick={() => void endSession(session.id)}>
              {revoking === session.id ? "Ending…" : "End session"}
            </Button>
          </div>
        ))}
        {!sessions.length && <div className="rounded-xl border border-dashed border-white/[0.1] p-8 text-center text-sm text-zinc-500">{loading ? "Loading active sessions…" : "No active sessions right now."}</div>}
      </div>
      <p className="text-[11px] text-zinc-600">Player names and executor names are client-reported and may be inaccurate. This view does not collect IP addresses or physical addresses.</p>
    </section>
  );
}
