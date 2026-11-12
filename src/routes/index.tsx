import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAppSession } from "@/components/session-provider";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { useServerFn } from "@tanstack/react-start";
import { registerDiscordCommands, getBotInvite } from "@/lib/discord.functions";
import { createApiKey } from "@/lib/apikeys.functions";
import { checkpointToken } from "@/lib/getkey-token";
import { lovable } from "@/integrations/lovable";
import { HomePanel } from "@/components/home-panel";
import { LuaFilePicker } from "@/components/lua-file-picker";

export const Route = createFileRoute("/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab: "home" | "scripts" | "discord" | "api" } => ({
    tab:
      search["tab"] === "discord" || search["tab"] === "api" || search["tab"] === "scripts"
        ? search["tab"]
        : "home",
  }),
  head: () => ({
    meta: [
      { title: "Vault — Roblox Script Protection & Key System" },
      {
        name: "description",
        content: "Host Roblox scripts behind license keys with HWID locking, expiry and bans.",
      },
      { property: "og:title", content: "Vault — Roblox Script Protection" },
      {
        property: "og:description",
        content: "License keys, HWID lock and protected script delivery.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type Script = {
  id: string;
  name: string;
  source: string;
  executions: number;
  enabled: boolean;
  keyless: boolean;
  getkey_enabled: boolean;
  checkpoints: string[];
  getkey_hours: number;
  discord_webhook: string | null;
};
type Log = {
  id: string;
  key_note: string | null;
  result: string;
  executor: string | null;
  created_at: string;
};
type Key = {
  id: string;
  key: string;
  note: string | null;
  hwid: string | null;
  banned: boolean;
  expires_at: string | null;
  last_used_at: string | null;
};

function Index() {
  const { user: session, ready } = useAppSession();
  const queryClient = useQueryClient();
  const { tab } = Route.useSearch();
  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
  };
  return (
    <div className="min-h-screen bg-background text-foreground font-mono">
      <Toaster />
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <span className="text-lg font-bold text-primary">▲ VAULT</span>
        <div className="flex items-center gap-2">
          {session && (
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign out
            </Button>
          )}
        </div>
      </header>
      {!ready ? null : tab === "home" ? (
        <div className="mx-auto max-w-6xl px-6">
          <HomePanel signedIn={!!session} />
        </div>
      ) : session ? (
        <Dashboard />
      ) : (
        <Auth />
      )}
    </div>
  );
}

function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const google = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) toast.error(result.error.message ?? "Google sign-in failed");
  };
  const discord = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: window.location.origin },
    });
    if (error) toast.error(error.message || "Discord sign-in failed");
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } =
      mode === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          });
    if (error) toast.error(error.message);
    else if (mode === "up") toast.success("Check your email to confirm your account.");
  };
  return (
    <main className="mx-auto flex min-h-[75vh] max-w-md items-center px-6 py-14">
      <div className="w-full rounded-2xl border border-violet-400/15 bg-[#100d19] p-7 shadow-[0_24px_90px_rgba(0,0,0,0.4)] sm:p-9">
        <div className="mb-7">
          <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-500/10 text-lg font-bold text-violet-300">V</div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-300">Vault access</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Protect your scripts.</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            License keys, device locking and protected script delivery in one place.
          </p>
        </div>
      <form onSubmit={submit} className="space-y-3">
        <Input
          type="email"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
        <Button type="submit" className="w-full">
          {mode === "in" ? "Sign in" : "Create account"}
        </Button>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>
        <Button type="button" variant="outline" className="w-full border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.08]" onClick={google}>
          Continue with Google
        </Button>
        <Button type="button" variant="outline" className="w-full border-[#5865f2]/40 bg-[#5865f2]/10 text-white hover:bg-[#5865f2]/20" onClick={discord}>
          <span className="text-lg">◉</span> Continue with Discord
        </Button>
        <button
          type="button"
          className="text-sm text-violet-300 underline-offset-4 hover:underline"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
        >
          {mode === "in" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
      </div>
    </main>
  );
}

function Dashboard() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [sel, setSel] = useState<Script | null>(null);
  const { tab } = Route.useSearch();
  const [creating, setCreating] = useState(false);
  const [setupFor, setSetupFor] = useState<Script | null>(null);
  const load = async () => {
    const { data } = await supabase.from("scripts").select(COLS).order("created_at");
    setScripts(data ?? []);
    return data ?? [];
  };
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      {tab === "discord" && <DiscordPanel />}
      {tab === "api" && <ApiPanel />}
      {tab === "scripts" &&
        (setupFor ? (
          <KeySystemSetup
            script={setupFor}
            onDone={async () => {
              const list = await load();
              setSel(list.find((s) => s.id === setupFor.id) ?? null);
              setSetupFor(null);
            }}
          />
        ) : creating ? (
          <NewScriptForm
            onCancel={() => setCreating(false)}
            onCreated={async (s) => {
              setCreating(false);
              await load();
              setSetupFor(s);
            }}
          />
        ) : (
          <main className="grid gap-6 md:grid-cols-[240px_1fr]">
            <aside className="space-y-2">
              <Button className="w-full" onClick={() => setCreating(true)}>
                + New script
              </Button>
              {scripts.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSel(s)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${sel?.id === s.id ? "border-primary text-primary" : "border-border"}`}
                >
                  {s.name}
                  <span className="block text-xs text-muted-foreground">{s.executions} runs</span>
                </button>
              ))}
            </aside>
            {sel ? (
              <ScriptPanel
                key={sel.id}
                script={sel}
                onChange={load}
                onDelete={() => {
                  setSel(null);
                  load();
                }}
              />
            ) : (
              <p className="text-muted-foreground">Create or pick a script.</p>
            )}
          </main>
        ))}
    </div>
  );
}

const COLS =
  "id,name,source,executions,enabled,keyless,getkey_enabled,checkpoints,getkey_hours,discord_webhook";

function NewScriptForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (s: Script) => void;
}) {
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase
      .from("scripts")
      .insert({ name: name.trim(), source })
      .select(COLS)
      .single();
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Script submitted");
    onCreated(data);
  };
  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4">
      <div className="text-xs text-muted-foreground">Step 1 of 2</div>
      <h2 className="text-2xl font-bold">Submit your script</h2>
      <Input
        placeholder="Script name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={100}
      />
      <LuaFilePicker
        onLoaded={(text, fileName) => {
          setSource(text);
          if (!name.trim()) setName(fileName.replace(/\.(lua|luau|txt)$/i, "").slice(0, 100));
        }}
      />
      <Textarea
        rows={14}
        className="font-mono text-xs"
        placeholder='print("hello") -- your Lua source'
        value={source}
        onChange={(e) => setSource(e.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !name.trim()}>
          Submit script →
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function KeySystemSetup({ script, onDone }: { script: Script; onDone: () => void }) {
  const [mode, setMode] = useState<"keys" | "free" | "keyless">("keys");
  const [cps, setCps] = useState("");
  const [hours, setHours] = useState("24");
  const [count, setCount] = useState("1");
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const opts = [
    ["keys", "Paid keys", "You generate keys and hand them to buyers. HWID-locked."],
    [
      "free",
      "Free key system",
      "Users pass ad checkpoints (Linkvertise / LootLabs / Work.ink) to get a temporary key.",
    ],
    ["keyless", "Keyless", "Anyone with the loader can run it. No keys."],
  ] as const;
  const finish = async () => {
    setBusy(true);
    const checkpoints = cps
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//.test(l));
    if (mode === "free" && checkpoints.length === 0) {
      setBusy(false);
      toast.error("Add at least one checkpoint link");
      return;
    }
    const { error } = await supabase
      .from("scripts")
      .update({
        keyless: mode === "keyless",
        getkey_enabled: mode === "free",
        checkpoints,
        getkey_hours: Math.max(1, Number(hours) || 24),
      })
      .eq("id", script.id);
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    if (mode === "keys") {
      const n = Math.min(100, Math.max(0, Number(count) || 0));
      const expires_at = days ? new Date(Date.now() + Number(days) * 864e5).toISOString() : null;
      const rows = Array.from({ length: n }, () => ({
        script_id: script.id,
        expires_at,
        key: Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      }));
      if (rows.length) {
        const { error: e2 } = await supabase.from("license_keys").insert(rows);
        if (e2) {
          setBusy(false);
          toast.error(e2.message);
          return;
        }
      }
    }
    setBusy(false);
    toast.success("Key system ready");
    onDone();
  };
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="text-xs text-muted-foreground">Step 2 of 2 · {script.name}</div>
      <h2 className="text-2xl font-bold">Set up the key system</h2>
      <div className="grid gap-2">
        {opts.map(([id, title, desc]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={`rounded-md border p-4 text-left ${mode === id ? "border-primary bg-card" : "border-border"}`}
          >
            <div className={`font-bold ${mode === id ? "text-primary" : ""}`}>{title}</div>
            <div className="text-xs text-muted-foreground">{desc}</div>
          </button>
        ))}
      </div>
      {mode === "keys" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Generate</span>
          <Input
            className="w-20"
            type="number"
            min={0}
            max={100}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
          <span className="text-muted-foreground">keys lasting</span>
          <Input
            className="w-28"
            type="number"
            placeholder="∞ days"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <span className="text-muted-foreground">days</span>
        </div>
      )}
      {mode === "free" && (
        <div className="space-y-2">
          <Textarea
            rows={3}
            className="font-mono text-xs"
            placeholder="One ad link per line (https://linkvertise.com/...)"
            value={cps}
            onChange={(e) => setCps(e.target.value)}
          />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Key lasts</span>
            <Input
              className="w-20"
              type="number"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
            <span className="text-muted-foreground">hours</span>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button onClick={finish} disabled={busy}>
          Finish setup
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  created_at: string;
};

function ApiPanel() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const create = useServerFn(createApiKey);
  const load = async () => {
    const { data } = await supabase
      .from("api_keys")
      .select("id,name,prefix,last_used_at,created_at")
      .order("created_at", { ascending: false });
    setKeys(data ?? []);
  };
  useEffect(() => {
    load();
  }, []);
  const make = async () => {
    try {
      const r = await create({ data: { name: name || "My key" } });
      setFresh(r.key);
      setName("");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const k = fresh ?? "vk_YOUR_KEY";
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {keys.length === 0 && !fresh ? (
        <div className="rounded-md border border-primary p-6 text-center space-y-3">
          <h2 className="text-xl font-bold">Do you want to make an API key?</h2>
          <p className="text-sm text-muted-foreground">
            An API key lets your own tools, bots or panels create and manage scripts and keys
            without the dashboard.
          </p>
          <div className="flex justify-center gap-2">
            <Input
              className="w-56"
              placeholder="Key name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button onClick={make}>Yes, make one</Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            placeholder="New key name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button onClick={make}>Create API key</Button>
        </div>
      )}
      {fresh && (
        <div className="rounded-md border border-primary bg-card p-4 space-y-2">
          <div className="text-sm font-bold">Copy your key now — it won't be shown again.</div>
          <code className="block break-all text-primary text-xs">{fresh}</code>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              navigator.clipboard.writeText(fresh);
              toast.success("Copied");
            }}
          >
            Copy
          </Button>
        </div>
      )}
      <div className="space-y-2">
        {keys.map((x) => (
          <div
            key={x.id}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs"
          >
            <span>
              <b>{x.name}</b> <code className="text-muted-foreground">{x.prefix}…</code>
            </span>
            <span className="flex items-center gap-2 text-muted-foreground">
              {x.last_used_at ? `used ${new Date(x.last_used_at).toLocaleString()}` : "never used"}
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (confirm("Revoke this key?")) {
                    await supabase.from("api_keys").delete().eq("id", x.id);
                    load();
                  }
                }}
              >
                Revoke
              </Button>
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <h3 className="font-bold">Make a script with your key</h3>
        <pre className="overflow-x-auto rounded-md border border-border bg-card p-3 text-xs">{`curl -X POST ${origin}/api/public/v1/scripts \\
  -H "Authorization: Bearer ${k}" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"My Script","source":"print(\\"hi\\")"}'`}</pre>
        <div className="text-xs text-muted-foreground space-y-1">
          <div>
            <code>GET /api/public/v1/scripts</code> — list scripts
          </div>
          <div>
            <code>POST /api/public/v1/scripts</code> — create (name, source, keyless) → returns
            loader
          </div>
          <div>
            <code>GET | PATCH | DELETE /api/public/v1/scripts/:id</code> — read / update (name,
            source, enabled, keyless) / delete
          </div>
          <div>
            <code>GET | POST /api/public/v1/scripts/:id/keys</code> — list / generate key (note,
            days)
          </div>
        </div>
      </div>
    </div>
  );
}

function ScriptPanel({
  script,
  onChange,
  onDelete,
}: {
  script: Script;
  onChange: () => void;
  onDelete: () => void;
}) {
  const [source, setSource] = useState(script.source);
  const [keys, setKeys] = useState<Key[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [enabled, setEnabled] = useState(script.enabled);
  const loadLogs = async () => {
    const { data } = await supabase
      .from("execution_logs")
      .select("id,key_note,result,executor,created_at")
      .eq("script_id", script.id)
      .order("created_at", { ascending: false })
      .limit(25);
    setLogs(data ?? []);
  };
  const executorSummary = logs.reduce<Record<string, number>>((counts, log) => {
    const name = log.executor?.trim() || "Unknown";
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});
  const topExecutors = Object.entries(executorSummary)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const totalLoggedRuns = logs.length;
  const toggle = async () => {
    const { error } = await supabase
      .from("scripts")
      .update({ enabled: !enabled })
      .eq("id", script.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEnabled(!enabled);
    toast.success(!enabled ? "Script enabled" : "Script disabled for all buyers");
    onChange();
  };
  const [keyless, setKeyless] = useState(script.keyless);
  const toggleKeyless = async () => {
    const { error } = await supabase
      .from("scripts")
      .update({ keyless: !keyless })
      .eq("id", script.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setKeyless(!keyless);
    toast.success(!keyless ? "Script is now keyless" : "Keys required again");
    onChange();
  };
  const [gkOn, setGkOn] = useState(script.getkey_enabled);
  const [cps, setCps] = useState(script.checkpoints.join("\n"));
  const [gkHours, setGkHours] = useState(String(script.getkey_hours));
  const saveGk = async (on = gkOn) => {
    const checkpoints = cps
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//.test(l));
    const { error } = await supabase
      .from("scripts")
      .update({ getkey_enabled: on, checkpoints, getkey_hours: Math.max(1, Number(gkHours) || 24) })
      .eq("id", script.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setGkOn(on);
    toast.success("Key system saved");
    onChange();
  };
  const [hook, setHook] = useState(script.discord_webhook ?? "");
  const saveHook = async () => {
    const v = hook.trim();
    if (v && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(v)) {
      toast.error("That isn't a Discord webhook URL");
      return;
    }
    const { error } = await supabase
      .from("scripts")
      .update({ discord_webhook: v || null })
      .eq("id", script.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Alerts saved");
      onChange();
    }
  };
  const [days, setDays] = useState("");
  const [note, setNote] = useState("");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const loader = `${keyless ? "" : 'script_key = "PUT_KEY_HERE"\n'}loadstring(game:HttpGet("${origin}/api/public/cdn/loader/${script.id}"))()`;

  const loadKeys = async () => {
    const { data } = await supabase
      .from("license_keys")
      .select("id,key,note,hwid,banned,expires_at,last_used_at")
      .eq("script_id", script.id)
      .order("created_at", { ascending: false });
    setKeys(data ?? []);
  };
  useEffect(() => {
    loadKeys();
    loadLogs();
  }, []);

  const save = async () => {
    const { error } = await supabase.from("scripts").update({ source }).eq("id", script.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Saved");
      onChange();
    }
  };
  const genKey = async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const expires_at = days ? new Date(Date.now() + Number(days) * 864e5).toISOString() : null;
    const { error } = await supabase
      .from("license_keys")
      .insert({ script_id: script.id, key, note: note || null, expires_at });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNote("");
    loadKeys();
  };
  const upd = async (id: string, patch: Partial<Key>) => {
    await supabase.from("license_keys").update(patch).eq("id", id);
    loadKeys();
  };
  const del = async (id: string) => {
    await supabase.from("license_keys").delete().eq("id", id);
    loadKeys();
  };
  const delScript = async () => {
    if (confirm("Delete script and all keys?")) {
      await supabase.from("scripts").delete().eq("id", script.id);
      onDelete();
    }
  };

  return (
    <section className="space-y-6 min-w-0">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{script.name}</h2>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={toggleKeyless}>
            {keyless ? "Require keys" : "Make keyless"}
          </Button>
          <Button variant={enabled ? "secondary" : "default"} size="sm" onClick={toggle}>
            {enabled ? "Disable script" : "Enable script"}
          </Button>
          <Button variant="destructive" size="sm" onClick={delScript}>
            Delete
          </Button>
        </div>
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Loader (give this to buyers)</label>
        <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-card p-3 text-xs">
          {loader}
        </pre>
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          onClick={() => {
            navigator.clipboard.writeText(loader);
            toast.success("Copied");
          }}
        >
          Copy loader
        </Button>
      </div>
      <div>
        <label className="text-sm text-muted-foreground">
          Protected source (Lua) — encrypted automatically every time it is served
        </label>
        <div className="mt-1">
          <LuaFilePicker onLoaded={(text) => setSource(text)} />
        </div>
        <Textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          rows={12}
          className="mt-1 font-mono text-xs"
          placeholder='print("hello")'
        />
        <Button size="sm" className="mt-2" onClick={save}>
          Save source
        </Button>
      </div>
      <div>
        <h3 className="font-bold">Keys</h3>
        {keyless && (
          <p className="text-xs text-muted-foreground">
            Keyless: anyone with the loader can run this script. Keys are ignored.
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Input
            className="w-40"
            placeholder="note (buyer)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Input
            className="w-32"
            type="number"
            placeholder="days (blank=∞)"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <Button onClick={genKey}>Generate key</Button>
        </div>
        <div className="mt-3 space-y-2">
          {keys.map((k) => (
            <div key={k.id} className="rounded-md border border-border p-3 text-xs space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className={k.banned ? "line-through text-destructive" : "text-primary"}>
                  {k.key}
                </code>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigator.clipboard.writeText(k.key)}
                  >
                    Copy
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => upd(k.id, { hwid: null })}>
                    Reset HWID
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => upd(k.id, { banned: !k.banned })}
                  >
                    {k.banned ? "Unban" : "Ban"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => del(k.id)}>
                    Delete
                  </Button>
                </div>
              </div>
              <div className="text-muted-foreground">
                {k.note ?? "—"} · HWID: {k.hwid ? "locked" : "unbound"} ·{" "}
                {k.expires_at
                  ? `expires ${new Date(k.expires_at).toLocaleDateString()}`
                  : "lifetime"}{" "}
                ·{" "}
                {k.last_used_at
                  ? `last used ${new Date(k.last_used_at).toLocaleString()}`
                  : "never used"}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-bold">Free key system (Linkvertise / LootLabs / Work.ink)</h3>
          <Button size="sm" variant={gkOn ? "secondary" : "default"} onClick={() => saveGk(!gkOn)}>
            {gkOn ? "Turn off" : "Turn on"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Paste one ad link per line, one per checkpoint. In your Linkvertise/LootLabs dashboard set
          each link's destination to the matching return URL below.
        </p>
        <Textarea
          rows={3}
          className="font-mono text-xs"
          placeholder="https://linkvertise.com/..."
          value={cps}
          onChange={(e) => setCps(e.target.value)}
        />
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Key lasts</span>
          <Input
            className="w-20"
            type="number"
            value={gkHours}
            onChange={(e) => setGkHours(e.target.value)}
          />
          <span className="text-muted-foreground">hours</span>
          <Button size="sm" onClick={() => saveGk()}>
            Save
          </Button>
        </div>
        <div className="text-xs space-y-1">
          <div>
            Get-key page (share this):{" "}
            <code className="text-primary">
              {origin}/getkey/{script.id}
            </code>
          </div>
          {cps
            .split("\n")
            .filter((l) => l.trim())
            .map((_, i) => (
              <div key={i} className="text-muted-foreground">
                Checkpoint {i + 1} redirect link (paste into your ad provider):{" "}
                <ReturnUrl scriptId={script.id} cp={i + 1} origin={origin} />
              </div>
            ))}
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="font-bold">Discord run alerts</h3>
        <p className="text-xs text-muted-foreground">
          Paste a Discord channel webhook URL (Channel settings → Integrations → Webhooks). Every
          run and failed attempt is posted there.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="https://discord.com/api/webhooks/..."
            value={hook}
            onChange={(e) => setHook(e.target.value)}
          />
          <Button size="sm" onClick={saveHook}>
            Save
          </Button>
        </div>
      </div>
      {!enabled && (
        <p className="text-sm text-destructive">
          Disabled: no buyer can run this script right now.
        </p>
      )}
      <div>
        <div className="flex items-center justify-between">
          <h3 className="font-bold">Recent runs</h3>
          <Button size="sm" variant="ghost" onClick={loadLogs}>
            Refresh
          </Button>
        </div>
        {totalLoggedRuns > 0 && (
          <div className="mb-3 space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Top executors</span>
              <span className="text-muted-foreground">{totalLoggedRuns} recent runs</span>
            </div>
            {topExecutors.map(([name, count]) => {
              const percent = Math.round((count / totalLoggedRuns) * 100);
              return (
                <div key={name} className="space-y-1">
                  <div className="flex justify-between gap-2">
                    <span>{name}</span>
                    <span className="text-muted-foreground">{percent}% ({count})</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-2 space-y-1 text-xs">
          {logs.length === 0 && <p className="text-muted-foreground">No runs yet.</p>}
          {logs.map((l) => (
            <div
              key={l.id}
              className="flex flex-wrap justify-between gap-2 rounded border border-border px-3 py-2"
            >
              <span className="flex items-center gap-2">
                <span className={l.result === "ok" ? "text-primary" : "text-destructive"}>
                  {l.result}
                </span>
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                  {l.executor || "Unknown"}
                </span>
              </span>
              <span className="text-muted-foreground">
                {l.key_note ?? "—"} · {new Date(l.created_at).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DiscordPanel() {
  const [link, setLink] = useState<{ guild_id: string | null; link_code: string } | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const register = useServerFn(registerDiscordCommands);
  const load = async () => {
    const { data } = await supabase
      .from("discord_links")
      .select("guild_id,link_code")
      .maybeSingle();
    setLink(data);
  };
  useEffect(() => {
    load();
    getBotInvite().then((r) => setInvite(r.url));
  }, []);
  const newCode = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("discord_links").delete().eq("user_id", u.user.id);
    const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const { error } = await supabase
      .from("discord_links")
      .insert({ user_id: u.user.id, link_code: code });
    if (error) toast.error(error.message);
    else await load();
  };
  const step = "rounded-md border border-border p-4 space-y-2";
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Discord bot</h2>
        <span className={`text-xs ${link?.guild_id ? "text-primary" : "text-muted-foreground"}`}>
          {link?.guild_id ? `● Linked to server ${link.guild_id}` : "○ No server linked"}
        </span>
      </div>
      <div className={step}>
        <div className="font-bold">1. Add the bot to your server</div>
        {invite ? (
          <a
            href={invite}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary underline"
          >
            Open invite link
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">
            The bot isn't configured yet (missing Discord bot details).
          </p>
        )}
      </div>
      <div className={step}>
        <div className="font-bold">2. Register slash commands</div>
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            const r = await register();
            if (r.ok) toast.success(r.message);
            else toast.error(r.message);
          }}
        >
          Register commands
        </Button>
      </div>
      <div className={step}>
        <div className="font-bold">3. Link your server</div>
        {link && (
          <div className="text-sm">
            Run in Discord: <code className="text-primary break-all">/link {link.link_code}</code>
          </div>
        )}
        <Button size="sm" onClick={newCode}>
          {link ? "New link code" : "Get link code"}
        </Button>
      </div>
      <div className={step}>
        <div className="font-bold">Commands</div>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>
            <code>/redeem key</code> — buyer gets their loader
          </li>
          <li>
            <code>/resethwid key</code> — buyer resets device lock
          </li>
          <li>
            <code>/panel script [title] [description]</code> — admin: post a key panel with Get key
            / Redeem / Reset HWID / Check key buttons
          </li>
          <li>
            <code>/genkey script [note] [days]</code> — admin: generate a key
          </li>
          <li>
            <code>/ban</code> · <code>/unban</code> · <code>/delkey key</code> — admin key
            management
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Run alerts per script are set in each script's "Discord run alerts" section.
        </p>
      </div>
    </div>
  );
}

function ReturnUrl({ scriptId, cp, origin }: { scriptId: string; cp: number; origin: string }) {
  const { user } = useAppSession();
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (user)
      void checkpointToken(scriptId, user.id, cp).then((t) =>
        setUrl(`${origin}/getkey/${scriptId}?cp=${cp}&t=${t}`),
      );
  }, [user, scriptId, cp, origin]);
  if (!url) return <span>…</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code className="break-all">{url}</code>
      <button
        type="button"
        className="underline text-primary"
        onClick={() => {
          void navigator.clipboard.writeText(url);
          toast.success("Redirect link copied");
        }}
      >
        Copy
      </button>
    </span>
  );
}
