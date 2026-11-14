import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  scriptId: string;
  source: string;
  loader: string;
  hasDiscordWebhook: boolean;
};

export function LuavailIntegrationAssistant({ scriptId, source, loader, hasDiscordWebhook }: Props) {
  const [analyzed, setAnalyzed] = useState(false);
  const findings = useMemo(() => {
    const hasLuavailLoader = source.includes("/api/public/cdn/loader/") || source.includes(scriptId);
    const hasWebhookSecret = /https?:\/\/(?:discord(?:app)?\.com)\/api\/webhooks\//i.test(source);
    const hasHttpCalls = /HttpGet|RequestAsync|http_request|request\s*\(/i.test(source);
    return { hasLuavailLoader, hasWebhookSecret, hasHttpCalls };
  }, [source, scriptId]);

  return (
    <section className="rounded-xl border border-blue-300/15 bg-blue-300/[0.035] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">Luavail integration assistant</h3>
          <p className="mt-1 text-xs text-zinc-400">Runs locally in your browser · no external AI service or API key</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAnalyzed(true)}>Analyze script</Button>
      </div>
      <p className="text-xs text-zinc-400">
        Luavail already records live executions and sends your configured Discord alerts through its hosted loader.
        Those features belong in the loader/server, so webhook secrets never need to be placed inside your Lua source.
      </p>
      {analyzed && (
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2"><span className="text-zinc-300">Luavail loader reference</span><span className={findings.hasLuavailLoader ? "text-emerald-300" : "text-amber-300"}>{findings.hasLuavailLoader ? "Reference detected" : "Not detected in source"}</span></div>
          <div className="flex items-center justify-between gap-2"><span className="text-zinc-300">Discord webhook URL in source</span><span className={findings.hasWebhookSecret ? "text-rose-300" : "text-emerald-300"}>{findings.hasWebhookSecret ? "Found — remove it" : "None found"}</span></div>
          <div className="flex items-center justify-between gap-2"><span className="text-zinc-300">HTTP/network calls</span><span className="text-zinc-300">{findings.hasHttpCalls ? "Detected" : "Not detected"}</span></div>
          <div className="rounded-lg border border-white/[0.07] bg-black/20 p-3 text-zinc-400">
            {findings.hasWebhookSecret
              ? "A Discord webhook URL in client Lua can be copied and abused. Remove it and configure the webhook in the Discord run alerts section below."
              : hasDiscordWebhook
                ? "Your Discord webhook is configured in Luavail. Successful execution alerts are sent by the server."
                : "Configure a Discord webhook in the Discord run alerts section below to receive execution notifications."}
            {" "}Live execution records are created automatically when users run this script through its Luavail loader.
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => { void navigator.clipboard.writeText(loader); }}>Copy Luavail loader</Button>
        <span className="text-[11px] text-zinc-500">Use this as the entry point for users. It handles licensing, execution logs, heartbeats and server-side alerts.</span>
      </div>
    </section>
  );
}
