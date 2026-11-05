import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ShieldCheck, Search, Trash2, Pause, Play, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAppSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { getAdminAccess, listAdminScripts, moderateScript } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Moderation — Vault" },
      {
        name: "description",
        content: "Administrator login and hosted-script moderation for Vault.",
      },
      { property: "og:title", content: "Admin Moderation — Vault" },
      {
        property: "og:description",
        content: "Secure administrator access to Vault script moderation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { user, ready } = useAppSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const check = useServerFn(getAdminAccess);
  const list = useServerFn(listAdminScripts);
  const moderate = useServerFn(moderateScript);
  const access = useQuery({
    queryKey: ["admin-access", user?.id],
    queryFn: () => check(),
    enabled: !!user,
    retry: false,
  });
  const scripts = useQuery({
    queryKey: ["admin-scripts", user?.id],
    queryFn: () => list(),
    enabled: !!user && access.data === true,
    retry: false,
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/admin", replace: true });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const credentials = { email: email.trim(), password };
      const { error } = signup
        ? await supabase.auth.signUp({
            ...credentials,
            options: { emailRedirectTo: `${window.location.origin}/admin` },
          })
        : await supabase.auth.signInWithPassword(credentials);
      setMessage(
        error
          ? error.message
          : signup
            ? "Check your email to confirm your account, then return here to sign in."
            : "",
      );
    } finally {
      setBusy(false);
    }
  };
  const act = async (scriptId: string, action: "disable" | "restore" | "delete") => {
    setBusy(true);
    setMessage("");
    try {
      await moderate({ data: { scriptId, action } });
      if (action === "delete") setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-scripts"] });
      setMessage(
        action === "delete"
          ? "Script and related keys deleted."
          : action === "disable"
            ? "Script hosting disabled."
            : "Moderation suspension removed.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update script.");
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };
  const rows = (scripts.data ?? []).filter(
    (s) =>
      `${s.name} ${s.id} ${s.owner_id}`.toLowerCase().includes(search.toLowerCase()) &&
      (status === "all" ||
        (status === "disabled" ? s.moderation_disabled : !s.moderation_disabled)),
  );
  const picked = scripts.data?.find((s) => s.id === selected);
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 text-foreground sm:px-6">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <h1 className="flex items-center gap-3 text-2xl font-bold">
          <ShieldCheck className="text-primary" />
          Admin moderation
        </h1>
        {user && (
          <Button variant="outline" onClick={signOut}>
            Sign out
          </Button>
        )}
      </header>
      {!ready ? (
        <p>Loading…</p>
      ) : !user ? (
        <form onSubmit={submit} className="mx-auto max-w-sm space-y-4">
          <h2 className="text-xl font-semibold">
            {signup ? "Create admin account" : "Admin login"}
          </h2>
          <label className="block space-y-2">
            <span className="text-sm">Email</span>
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm">Password</span>
            <Input
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>
          <Button className="w-full" disabled={busy}>
            {busy ? "Please wait…" : signup ? "Create account" : "Sign in as admin"}
          </Button>
          <Button
            type="button"
            variant="link"
            onClick={() => {
              setSignup(!signup);
              setMessage("");
            }}
          >
            {signup ? "Already registered? Sign in" : "Create admin account"}
          </Button>
        </form>
      ) : access.isPending ? (
        <p>Checking admin access…</p>
      ) : access.data !== true ? (
        <div className="space-y-3">
          <h2 className="text-xl font-semibold">Admin access required</h2>
          <p className="text-muted-foreground">
            Sign in with the verified designated administrator account.
          </p>
          {access.error && (
            <Button variant="outline" onClick={() => access.refetch()}>
              Retry access check
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
              <Input
                aria-label="Search scripts"
                placeholder="Search by name, script ID, or owner ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <select
              aria-label="Moderation status"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All scripts</option>
              <option value="active">Not suspended</option>
              <option value="disabled">Admin disabled</option>
            </select>
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh scripts"
              title="Refresh scripts"
              onClick={() => scripts.refetch()}
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
          {scripts.isPending ? (
            <p>Loading scripts…</p>
          ) : scripts.error ? (
            <p role="alert">Could not load scripts. Try refreshing.</p>
          ) : (
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section aria-label="Hosted scripts" className="min-w-0 space-y-3">
                <h2 className="text-sm text-muted-foreground">{rows.length} hosted scripts</h2>
                {!rows.length && <p className="py-8 text-muted-foreground">No scripts found.</p>}
                {rows.map((s) => (
                  <article key={s.id} className="min-w-0 rounded-md border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="break-all font-semibold">{s.name}</h3>
                      <Badge variant={s.moderation_disabled ? "destructive" : "secondary"}>
                        {s.moderation_disabled
                          ? "Admin disabled"
                          : s.enabled
                            ? "Hosting enabled"
                            : "Seller disabled"}
                      </Badge>
                    </div>
                    <p className="mt-2 break-all text-xs text-muted-foreground">
                      Owner: {s.owner_id}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.executions} runs · {new Date(s.created_at).toLocaleDateString()}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => setSelected(s.id)}>
                        Review script
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => act(s.id, s.moderation_disabled ? "restore" : "disable")}
                      >
                        {s.moderation_disabled ? (
                          <Play className="mr-2 size-4" />
                        ) : (
                          <Pause className="mr-2 size-4" />
                        )}
                        {s.moderation_disabled ? "Restore" : "Disable"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="icon"
                        disabled={busy}
                        aria-label={`Delete ${s.name}`}
                        title="Delete script"
                        onClick={() => setDeleting(s.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </article>
                ))}
              </section>
              <section aria-label="Script review" className="min-w-0 lg:sticky lg:top-20">
                <h2 className="mb-3 break-all text-lg font-semibold">
                  {picked?.name ?? "Script review"}
                </h2>
                {picked ? (
                  <>
                    <p className="mb-3 break-all text-xs text-muted-foreground">
                      Script ID: {picked.id}
                    </p>
                    <pre className="max-h-[600px] overflow-auto rounded-md border border-border bg-muted p-4 text-xs">
                      <code>{picked.source || "-- Empty source"}</code>
                    </pre>
                  </>
                ) : (
                  <p className="text-muted-foreground">No script selected.</p>
                )}
              </section>
            </div>
          )}
        </>
      )}
      {message && (
        <p role="status" className="mt-5 break-words text-sm">
          {message}
        </p>
      )}
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <AlertDialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this script permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              The hosted script, license keys, execution logs, and free-key sessions will be
              deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) void act(deleting, "delete");
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
