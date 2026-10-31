import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { checkKey, resetHwid } from "@/lib/keycheck.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/redeem")({
  head: () => ({
    meta: [
      { title: "Get Your Loader — Vault" },
      {
        name: "description",
        content: "Enter your license key to get your loader line and check if your key is valid.",
      },
      { property: "og:title", content: "Get Your Loader — Vault" },
      { property: "og:description", content: "Enter your key to get your loader and key status." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Redeem,
});

type Res = Awaited<ReturnType<typeof checkKey>>;

function Redeem() {
  const check = useServerFn(checkKey);
  const [key, setKey] = useState("");
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const reset = useServerFn(resetHwid);
  const [resetMsg, setResetMsg] = useState("");
  const doReset = async () => {
    const r = await reset({ data: { key } });
    setResetMsg(r.message);
    if (r.ok) setRes(await check({ data: { key } }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setCopied(false);
    setResetMsg("");
    try {
      setRes(await check({ data: { key } }));
    } finally {
      setBusy(false);
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const loader = res?.found
    ? `script_key = "${key.trim()}"\nloadstring(game:HttpGet("${origin}/api/public/loader/${res.scriptId}"))()`
    : "";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <Link to="/" search={{ tab: "scripts" }} className="font-bold text-lg">
          Vault
        </Link>
        <span className="text-sm text-muted-foreground">Buyer portal</span>
      </header>
      <main className="max-w-xl mx-auto px-6 py-12 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Get your loader</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Enter the key you received to get your script loader.
          </p>
        </div>
        <form onSubmit={submit} className="flex gap-2">
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Your license key"
            maxLength={128}
          />
          <Button type="submit" disabled={busy || !key.trim()}>
            {busy ? "Checking..." : "Check"}
          </Button>
        </form>

        {res && !res.found && (
          <div className="rounded-md border border-destructive p-4 text-destructive">
            Key not found.
          </div>
        )}

        {res?.found && (
          <div className="rounded-md border border-border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">{res.scriptName}</span>
              <Badge variant={res.status === "valid" ? "default" : "destructive"}>
                {res.status === "valid" ? "Valid" : res.status === "expired" ? "Expired" : "Banned"}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground space-y-1">
              <div>
                Expires: {res.expiresAt ? new Date(res.expiresAt).toLocaleString() : "Never"}
              </div>
              <div>Device lock: {res.hwidLocked ? "Locked to your device" : "Not used yet"}</div>
            </div>
            {res.status === "valid" && res.hwidLocked && (
              <div className="space-y-1">
                <Button size="sm" variant="outline" onClick={doReset}>
                  Reset device (once per 24h)
                </Button>
                {resetMsg && <p className="text-xs text-muted-foreground">{resetMsg}</p>}
              </div>
            )}
            {resetMsg && !res.hwidLocked && (
              <p className="text-xs text-muted-foreground">{resetMsg}</p>
            )}
            {res.status === "valid" ? (
              <>
                <pre className="bg-muted p-3 rounded text-xs overflow-x-auto whitespace-pre">
                  {loader}
                </pre>
                <Button
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(loader);
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied!" : "Copy loader"}
                </Button>
              </>
            ) : (
              <p className="text-sm text-destructive">
                This key can no longer be used. Contact the seller.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
