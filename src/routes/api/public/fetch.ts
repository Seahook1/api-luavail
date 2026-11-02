import { createFileRoute } from "@tanstack/react-router";
import { obfuscateLua } from "@/lib/obfuscate";
import { sendDiscordAlert } from "@/lib/discord-commands";
import { hostingAllowed } from "@/lib/moderation";
import { isBrowserNavigation, browserBlockedPage } from "@/lib/browser-page";

// Always 200 so Roblox HttpGet doesn't throw; the loader reads the --ERR: prefix.
const err = (m: string, _status = 200) =>
  new Response(`--ERR:${m}`, {
    status: 200,
    headers: { "content-type": "text/plain", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/public/fetch")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ua = request.headers.get("user-agent") ?? "";
        // Block obvious scraping tools; executors (incl. mobile WebKit ones) are allowed.
        if (/curl|python|wget|Postman|axios|node-fetch|undici/i.test(ua))
          return err("Access denied");
        const u = new URL(request.url);
        const s = (u.searchParams.get("s") ?? "").replace(/[^a-f0-9-]/gi, "");
        if (isBrowserNavigation(request))
          return browserBlockedPage(`${u.origin}/api/public/loader/${s}`);
        const k = (u.searchParams.get("k") ?? "").slice(0, 128);
        const h = (u.searchParams.get("h") ?? "").slice(0, 256);
        if (!s || !h) return err("Missing HWID", 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const ip =
          request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? null;
        const { data: sc } = await supabaseAdmin
          .from("scripts")
          .select("enabled, moderation_disabled, keyless, name, discord_webhook")
          .eq("id", s)
          .maybeSingle();
        if (!sc) return err("Script not found", 404);
        if (!hostingAllowed(sc)) return err("Script hosting is disabled");
        if (sc.keyless) {
          const log = async (result: string) => {
            await supabaseAdmin
              .from("execution_logs")
              .insert({ script_id: s, key_id: null, key_note: "keyless", result, ip });
            await sendDiscordAlert(
              sc.discord_webhook,
              `${result === "ok" ? "✅" : "⚠️"} **${sc.name}** · ${result} · keyless · IP ${ip ?? "?"}`,
            );
          };
          if (!sc.enabled) {
            await log("script disabled");
            return err("Script is temporarily disabled by the seller");
          }
          if (ip) {
            const { count } = await supabaseAdmin
              .from("execution_logs")
              .select("id", { count: "exact", head: true })
              .eq("script_id", s)
              .eq("ip", ip)
              .eq("result", "ok")
              .gte("created_at", new Date(Date.now() - 60_000).toISOString());
            if ((count ?? 0) >= 10) {
              await log("rate limited");
              return err("Too many runs, wait a minute", 429);
            }
          }
          await log("ok");
        } else {
          if (!k) return err("Missing key", 400);
          const { data: lic } = await supabaseAdmin
            .from("license_keys")
            .select("id, hwid, banned, expires_at, script_id, note")
            .eq("key", k)
            .eq("script_id", s)
            .maybeSingle();
          const log = async (result: string) => {
            await supabaseAdmin
              .from("execution_logs")
              .insert({
                script_id: s,
                key_id: lic?.id ?? null,
                key_note: lic?.note ?? null,
                result,
                ip,
              });
            await sendDiscordAlert(
              sc.discord_webhook,
              `${result === "ok" ? "✅" : "⚠️"} **${sc.name}** · ${result} · ${lic?.note ?? "unknown buyer"} · IP ${ip ?? "?"}`,
            );
          };
          if (!lic) {
            await log("invalid key");
            return err("Invalid key");
          }
          if (!sc.enabled) {
            await log("script disabled");
            return err("Script is temporarily disabled by the seller");
          }
          if (lic.banned) {
            await log("banned");
            return err("Key is banned");
          }
          if (lic.expires_at && new Date(lic.expires_at) < new Date()) {
            await log("expired");
            return err("Key expired");
          }
          if (lic.hwid && lic.hwid !== h) {
            await log("hwid mismatch");
            return err("HWID mismatch - reset it on the buyer portal");
          }
          // Rate limit: max 10 runs per key per minute (stops key sharing / dumping loops)
          const { count } = await supabaseAdmin
            .from("execution_logs")
            .select("id", { count: "exact", head: true })
            .eq("key_id", lic.id)
            .eq("result", "ok")
            .gte("created_at", new Date(Date.now() - 60_000).toISOString());
          if ((count ?? 0) >= 10) {
            await log("rate limited");
            return err("Too many runs, wait a minute", 429);
          }
          await log("ok");

          await supabaseAdmin
            .from("license_keys")
            .update({ hwid: lic.hwid ?? h, last_used_at: new Date().toISOString() })
            .eq("id", lic.id);
        }

        const { data: script } = await supabaseAdmin
          .from("scripts")
          .select("source, executions")
          .eq("id", s)
          .eq("moderation_disabled", false)
          .eq("enabled", true)
          .maybeSingle();
        if (!script) return err("Script not found", 404);
        await supabaseAdmin
          .from("scripts")
          .update({ executions: script.executions + 1 })
          .eq("id", s);

        return new Response(obfuscateLua(script.source), {
          headers: { "content-type": "text/plain", "cache-control": "no-store" },
        });
      },
    },
  },
});
