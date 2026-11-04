import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    title: "License keys",
    body: "Generate paid keys in bulk with optional expiry, add notes, ban or delete them any time.",
  },
  {
    title: "Free key system",
    body: "Ad checkpoints (Linkvertise, LootLabs, Work.ink) with a redirect link per step and a key that expires after the hours you choose.",
  },
  {
    title: "Anti-bypass",
    body: "Checkpoint links carry a secret code, steps must be done in order, finishing too fast or arriving from a bypass site resets progress.",
  },
  {
    title: "HWID lock",
    body: "Bind a key to one device. Buyers can reset it themselves from Discord or the buyer portal (once per 24 hours).",
  },
  {
    title: "Anti-tamper loader",
    body: "Every loader request is freshly encrypted with new keys and names, layered, with junk code and self-checks. Editing it or hooking core functions breaks decryption.",
  },
  {
    title: "Source stays on the server",
    body: "The loader never contains your script. It is only sent after the key, device and moderation checks pass.",
  },
  {
    title: "Discord bot",
    body: "/panel posts an embed with Get key, Redeem key, Reset HWID and Check key buttons. Plus /genkey, /ban, /unban, /delkey and /link.",
  },
  {
    title: "API keys",
    body: "Create vk_ API keys to create scripts and generate license keys from your own bot or site.",
  },
  {
    title: "Upload .lua files",
    body: "Drop a .lua or .txt file instead of pasting. Replace the source of an existing script the same way.",
  },
  {
    title: "Execution logs",
    body: "See every run and every rejected attempt per script, with the result and key note.",
  },
  {
    title: "Browser-proof links",
    body: "Opening a loader link in a browser shows a Loadstring page, never the script.",
  },
  {
    title: "Admin moderation",
    body: "A verified admin can review, disable, restore or delete any hosted script.",
  },
];

export function HomePanel({ signedIn }: { signedIn: boolean }) {
  return (
    <div>
      <section className="py-10 sm:py-16 text-center">
        <p className="text-xs uppercase tracking-widest text-primary">Roblox script protection</p>
        <h1 className="mx-auto mt-3 max-w-3xl text-3xl font-bold sm:text-5xl">
          Host your script. Sell or gate it. Keep your source safe.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
          Upload your Lua, pick a key system, and share one protected loadstring. Keys, HWID lock,
          ad checkpoints, a Discord bot and an API — all in one place.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/" search={{ tab: "scripts" }}>
              {signedIn ? "Open my scripts" : "Get started"}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/redeem">Buyer portal</Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-3 pb-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-lg border border-border bg-card p-4">
            <h3 className="font-bold text-primary">{f.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="mb-10 rounded-lg border border-border p-5">
        <h2 className="text-lg font-bold">How it works</h2>
        <ol className="mt-3 grid gap-3 text-sm text-muted-foreground sm:grid-cols-4">
          <li>
            <span className="text-primary">1.</span> Sign in with Google or email.
          </li>
          <li>
            <span className="text-primary">2.</span> Upload your .lua file or paste the source.
          </li>
          <li>
            <span className="text-primary">3.</span> Choose paid keys, free keys or keyless.
          </li>
          <li>
            <span className="text-primary">4.</span> Share the protected loadstring.
          </li>
        </ol>
        <p className="mt-4 text-xs text-muted-foreground">
          Client-side protection raises the cost of cracking but cannot make code on a player's
          machine impossible to extract. That is why the real source is only delivered after
          server-side checks.
        </p>
      </section>
    </div>
  );
}
