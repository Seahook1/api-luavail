import { Link } from "@tanstack/react-router";
import { useState } from "react";
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
];


const PLANS = [
  {
    name: "Free",
    monthly: "$0",
    lifetime: "$0",
    description: "Try the core Luavail tools.",
    perks: ["Limited script hosting", "Basic API access", "Basic obfuscation", "Basic anti-tamper checks", "2 MB maximum script size", "Basic analytics", "Community support", "Luavail branding"],
  },
  {
    name: "Developer",
    monthly: "$4.99",
    lifetime: "$19.99",
    description: "For creators managing multiple scripts.",
    perks: ["Expanded script hosting", "Advanced API access", "Advanced obfuscation", "Advanced anti-tamper checks", "10 MB maximum script size", "Detailed analytics", "Priority support", "Custom branding"],
  },
  {
    name: "Enterprise",
    monthly: "$9.99",
    lifetime: "$39.99",
    description: "The highest listed Luavail tier.",
    perks: ["Expanded script hosting", "Full API access", "Heavy VM option (when available)", "Full anti-tamper feature set", "15 MB maximum script size", "Full analytics", "Priority support", "Custom branding"],
  },
] as const;

function PlansSection() {
  const [billing, setBilling] = useState<"monthly" | "lifetime">("monthly");
  return (
    <section id="plans" className="border-y border-white/[0.08] py-12 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-blue-300">Luavail plans</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Pick your access level</h2>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">Choose monthly access or a lower-cost one-time lifetime option.</p>
        </div>
        <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-1">
          <button type="button" onClick={() => setBilling("monthly")} aria-pressed={billing === "monthly"} className={`rounded-md px-4 py-2 text-xs font-medium ${billing === "monthly" ? "bg-blue-400/15 text-blue-100" : "text-zinc-400"}`}>Monthly</button>
          <button type="button" onClick={() => setBilling("lifetime")} aria-pressed={billing === "lifetime"} className={`rounded-md px-4 py-2 text-xs font-medium ${billing === "lifetime" ? "bg-blue-400/15 text-blue-100" : "text-zinc-400"}`}>One-time</button>
        </div>
      </div>
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <article key={plan.name} className="flex flex-col rounded-xl border border-white/[0.09] bg-white/[0.02] p-5">
            <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
            <p className="mt-1 min-h-10 text-sm text-zinc-400">{plan.description}</p>
            <div className="mt-5">
              <span className="text-3xl font-semibold tracking-tight text-white">{billing === "monthly" ? plan.monthly : plan.lifetime}</span>
              <span className="ml-1 text-xs text-zinc-500">{plan.name === "Free" ? "forever" : billing === "monthly" ? "/ month" : " once · lifetime access"}</span>
            </div>
            <ul className="mt-6 flex-1 space-y-3 text-sm text-zinc-300">
              {plan.perks.map((perk) => <li key={perk} className="flex gap-2"><span className="text-blue-300">✓</span><span>{perk}</span></li>)}
            </ul>
            <button type="button" disabled className="mt-7 w-full cursor-not-allowed rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-500" title="Checkout is not connected yet">
              {plan.name === "Free" ? "Included" : "Checkout setup required"}
            </button>
          </article>
        ))}
      </div>
      <p className="mt-5 text-xs leading-5 text-zinc-500">Plan display is ready, but checkout, recurring billing, lifetime purchases, and server-side feature enforcement are not connected yet. Prices are proposed and no payment will be collected from these buttons.</p>
    </section>
  );
}

export function HomePanel({ signedIn }: { signedIn: boolean }) {
  return (
    <div>
      <section className="border-b border-white/[0.08] py-16 text-left sm:py-24">
        <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Roblox script protection · API Luavail</p>
        <div className="overflow-hidden">
          <h1 className="vault-hero-reveal mt-6 max-w-4xl text-5xl font-semibold leading-[0.98] tracking-[-0.055em] text-white sm:text-7xl lg:text-8xl">
            Host your script. Sell or gate it. Keep your source safe.
          </h1>
        </div>
        <p className="mt-7 max-w-xl text-sm leading-7 text-zinc-400 sm:text-base">
          Upload your Lua, pick a key system, and share one protected loadstring. Keys, HWID lock,
          ad checkpoints, a Discord bot and an API — all in one place.
        </p>
        <div className="mt-9 flex flex-wrap justify-start gap-3">
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

      <PlansSection />

      <section className="grid gap-0 pb-10 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="border-b border-r border-white/[0.08] bg-transparent p-5 transition-colors hover:bg-white/[0.025]">
            <h3 className="text-sm font-medium text-white">{f.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="mb-12 border-t border-white/[0.08] py-8">
        <h2 className="text-xl font-medium tracking-tight text-white">How it works</h2>
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
