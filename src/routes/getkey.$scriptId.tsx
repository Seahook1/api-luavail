import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getKeyStatus, beginCheckpoint, completeCheckpoint } from "@/lib/getkey.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/getkey/$scriptId")({
  validateSearch: (s: Record<string, unknown>) => ({ cp: s['cp'] ? Number(s['cp']) : undefined }),
  head: () => ({
    meta: [
      { title: "Get a Free Key — Vault" },
      { name: "description", content: "Complete the checkpoints to get a free script key." },
      { property: "og:title", content: "Get a Free Key — Vault" },
      { property: "og:description", content: "Complete the checkpoints to get a free script key." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GetKey,
});

type St = Awaited<ReturnType<typeof getKeyStatus>>;

function GetKey() {
  const { scriptId } = Route.useParams();
  const { cp } = Route.useSearch();
  const status = useServerFn(getKeyStatus);
  const begin = useServerFn(beginCheckpoint);
  const complete = useServerFn(completeCheckpoint);
  const [st, setSt] = useState<St | null>(null);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const storeKey = `getkey:${scriptId}`;

  useEffect(() => {
    (async () => {
      let sessionId = localStorage.getItem(storeKey) ?? undefined;
      if (cp && sessionId) {
        const r = await complete({ data: { scriptId, sessionId, cp } });
        setMsg(r.message);
        window.history.replaceState(null, "", window.location.pathname);
      }
      const s = await status({ data: { scriptId, sessionId } });
      if (s.ok) localStorage.setItem(storeKey, s.sessionId);
      setSt(s);
    })();
  }, []);

  const go = async () => {
    if (!st?.ok) return;
    const r = await begin({ data: { scriptId, sessionId: st.sessionId } });
    if (r.url) window.location.href = r.url;
  };
  const restart = () => { localStorage.removeItem(storeKey); window.location.reload(); };

  return (
    <div className="min-h-screen bg-background text-foreground font-mono">
      <header className="border-b border-border px-6 py-4"><span className="text-lg font-bold text-primary">▲ VAULT</span></header>
      <main className="mx-auto max-w-md px-6 py-16 space-y-6">
        {!st ? <p className="text-muted-foreground">Loading…</p> : !st.ok ? (
          <p className="text-destructive">The key system for this script is not available.</p>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-bold">{st.name}</h1>
              <p className="text-sm text-muted-foreground mt-1">Complete {st.total} checkpoint{st.total > 1 ? "s" : ""} to get a free key that lasts {st.hours} hours.</p>
            </div>
            <div className="flex gap-2">
              {Array.from({ length: st.total }, (_, i) => (
                <div key={i} className={`h-2 flex-1 rounded ${i < st.step ? "bg-primary" : "bg-muted"}`} />
              ))}
            </div>
            {msg && <p className="text-sm text-destructive">{msg}</p>}
            {st.key ? (
              <div className="space-y-3">
                <p className="text-sm">Your key:</p>
                <pre className="rounded-md border border-border bg-card p-3 text-xs overflow-x-auto">{st.key}</pre>
                <div className="flex gap-2">
                  <Button onClick={() => { navigator.clipboard.writeText(st.key!); setCopied(true); }}>{copied ? "Copied!" : "Copy key"}</Button>
                  <Button variant="ghost" onClick={restart}>Get a new key</Button>
                </div>
              </div>
            ) : (
              <Button className="w-full" onClick={go}>Checkpoint {st.step + 1} of {st.total}</Button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
