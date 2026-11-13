import { createFileRoute } from "@tanstack/react-router";
import { hostingAllowed } from "@/lib/moderation";
import { sendDiscordAlert } from "@/lib/discord-commands";

const RATE_WINDOW_MS = 30_000;
const MAX_INIT_PER_WINDOW = 5;
const rateBuckets = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || now - b.windowStart > RATE_WINDOW_MS) {
    rateBuckets.set(key, { count: 1, windowStart: now });
    return false;
  }
  if (b.count >= MAX_INIT_PER_WINDOW) return true;
  b.count += 1;
  return false;
}

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

// Roblox executors crash on non-200 responses, so errors are always HTTP 200 with an --ERR: prefix.
const fail = (msg: string) => new Response(`--ERR:${msg}`, { status: 200 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleInit(request: Request): Promise<Response> {
  try {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    let scriptId: string | null = null;
    let licenseKey: string | null = null;
    let hwid: string | null = null;
    let executor: string | null = null;
    let robloxUsername: string | null = null;
    let robloxDisplayName: string | null = null;
    const recordSecurityEvent = async (eventType: string, severity: "info" | "warning" | "critical", message: string, keyId: string | null = null, details: Record<string, unknown> = {}) => {
      if (!scriptId) return;
      const { data: owner } = await (db as any).from("scripts").select("owner_id").eq("id", scriptId).maybeSingle();
      if (!owner?.owner_id) return;
      await (db as any).from("security_events").insert({
        owner_id: owner.owner_id, script_id: scriptId, key_id: keyId,
        event_type: eventType, severity, message: message.slice(0, 240), details,
      });
    };
    const failWithAlert = async (message: string) => {
      if (scriptId) {
        const { data: alertScript } = await (db as any).from("scripts").select("discord_webhook,webhook_failure_enabled,owner_id").eq("id", scriptId).maybeSingle();
        if (alertScript?.owner_id && /license key|invalid license|key is banned|key has expired|rate limit/i.test(message)) {
          const { count } = await (db as any).from("security_events").select("id", { count: "exact", head: true })
            .eq("script_id", scriptId).eq("event_type", "failed_key_check")
            .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
          const severity = (count ?? 0) >= 4 ? "warning" : "info";
          await (db as any).from("security_events").insert({
            owner_id: alertScript.owner_id, script_id: scriptId, event_type: "failed_key_check",
            severity, message: (count ?? 0) >= 4 ? "Repeated failed license checks detected" : "A license check was rejected",
            details: { reason: message.slice(0, 120), attemptsInWindow: (count ?? 0) + 1 },
          });
          if ((count ?? 0) === 4 && alertScript.discord_webhook && alertScript.webhook_failure_enabled !== false) {
            void sendDiscordAlert(alertScript.discord_webhook, "⚠️ API Luavail detected 5 failed license checks for one script within 10 minutes.");
          }
        }
        if (alertScript?.discord_webhook && alertScript.webhook_failure_enabled !== false) {
          void sendDiscordAlert(alertScript.discord_webhook, "A script execution attempt was rejected: " + message.slice(0, 300));
        }
      }
      return fail(message);
    };
    if (request.method === "GET") {
      const u = new URL(request.url);
      scriptId = u.searchParams.get("s");
      licenseKey = u.searchParams.get("k");
      hwid = u.searchParams.get("h");
      executor = u.searchParams.get("e");
      robloxUsername = u.searchParams.get("u");
      robloxDisplayName = u.searchParams.get("d");
    } else {
      const b = (await request.json().catch(() => ({}))) as Record<string, string | undefined>;
      scriptId = b["script_id"] ?? b["s"] ?? null;
      licenseKey = b["key"] ?? b["k"] ?? null;
      hwid = b["hwid"] ?? b["h"] ?? null;
      executor = b["executor"] ?? b["e"] ?? null;
      robloxUsername = b["roblox_username"] ?? b["u"] ?? null;
      robloxDisplayName = b["roblox_display_name"] ?? b["d"] ?? null;
    }
    executor = (typeof executor === "string" ? executor : "")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .trim()
      .slice(0, 40) || "Unknown";
    const cleanPlayerName = (value: unknown) => (typeof value === "string" ? value : "").replace(/[^\w .-]/g, "").trim().slice(0, 32) || null;
    robloxUsername = cleanPlayerName(robloxUsername);
    robloxDisplayName = cleanPlayerName(robloxDisplayName);
    if (!scriptId || !UUID.test(scriptId) || !hwid || hwid.length > 200) return await failWithAlert("Missing script_id or hwid");

    if (isRateLimited(hwid)) return await failWithAlert("Rate limit exceeded");

    const { data: banned } = await db.from("banned_hwids").select("hwid").eq("hwid", hwid).maybeSingle();
    if (banned) return await failWithAlert("HWID is banned");

    const { data: script } = await (db as any)
      .from("scripts")
      .select("id, owner_id, enabled, moderation_disabled, keyless, maintenance_mode")
      .eq("id", scriptId)
      .maybeSingle();
    if (!script) return await failWithAlert("Script not found");
    if (!hostingAllowed(script)) return await failWithAlert("Script is disabled or moderated");
    const { data: platformSettings } = await (db as any).from("platform_settings").select("emergency_lockdown").eq("owner_id", script.owner_id).maybeSingle();
    if (platformSettings?.emergency_lockdown) return await failWithAlert("Emergency lockdown is active");
    if ((script as typeof script & { maintenance_mode?: boolean }).maintenance_mode) return await failWithAlert("Script is temporarily in maintenance mode");

    let keyId: string | null = null;

    if (!script.keyless) {
      if (!licenseKey) return await failWithAlert("Missing license key");
      const { data: k } = await db
        .from("license_keys")
        .select("id, banned, expires_at, hwid, last_rebind_at, max_concurrent_sessions")
        .eq("script_id", scriptId)
        .eq("key", licenseKey)
        .maybeSingle();
      if (!k) return await failWithAlert("Invalid license key");
      if (k.banned) return await failWithAlert("License key is banned");
      if (k.expires_at && new Date(k.expires_at) < new Date()) return await failWithAlert("License key has expired");

      if (!k.hwid) {
        await db.from("license_keys").update({ hwid }).eq("id", k.id);
      } else if (k.hwid !== hwid) {
        if (k.last_rebind_at && Date.now() - new Date(k.last_rebind_at).getTime() < 24 * 3600_000) {
          return await failWithAlert("HWID does not match this key (rebind cooldown 24h)");
        }
        await db.from("license_keys").update({ hwid, last_rebind_at: new Date().toISOString() }).eq("id", k.id);
        const { count: recentChanges } = await (db as any).from("security_events").select("id", { count: "exact", head: true })
          .eq("key_id", k.id).eq("event_type", "device_rebind").gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString());
        await (db as any).from("security_events").insert({
          owner_id: script.owner_id, script_id: scriptId, key_id: k.id, event_type: "device_rebind",
          severity: (recentChanges ?? 0) >= 1 ? "warning" : "info",
          message: (recentChanges ?? 0) >= 1 ? "Multiple device changes detected for this license" : "License device changed",
          details: { changesIn30Days: (recentChanges ?? 0) + 1 },
        });
        if ((recentChanges ?? 0) === 1) {
          const { data: alertConfig } = await (db as any).from("scripts").select("discord_webhook,webhook_failure_enabled").eq("id", scriptId).maybeSingle();
          if (alertConfig?.discord_webhook && alertConfig.webhook_failure_enabled !== false) void sendDiscordAlert(alertConfig.discord_webhook, "⚠️ API Luavail detected multiple device changes for a license key within 30 days.");
        }
      }

      const { count } = await db
        .from("execution_tokens")
        .select("id", { count: "exact", head: true })
        .eq("key_id", k.id)
        .eq("consumed", true)
        .eq("revoked", false)
        .gt("session_expires_at", new Date().toISOString());
      if ((count ?? 0) >= k.max_concurrent_sessions) return await failWithAlert("Max concurrent sessions reached");
      keyId = k.id;
      await db.from("license_keys").update({ last_used_at: new Date().toISOString() }).eq("id", k.id);
    }

    const token = hex(32);
    const canary = hex(8);
    const { error: insErr } = await db.from("execution_tokens").insert({
      token,
      script_id: scriptId,
      key_id: keyId,
      hwid,
      executor,
      roblox_username: robloxUsername,
      roblox_display_name: robloxDisplayName,
      canary,
      expires_at: new Date(Date.now() + 30_000).toISOString(),
    });
    if (insErr) {
      // Keep the client response generic, but retain the database diagnostic for server logs.
      console.error("execution token insert failed:", {
        code: insErr.code,
        message: insErr.message,
        details: insErr.details,
        hint: insErr.hint,
      });
      return await failWithAlert("Internal error creating token");
    }

    // Flag unusually high launch volume without recording client/network addresses.
    const burstSince = new Date(Date.now() - 2 * 60_000).toISOString();
    const { count: recentLaunches } = await (db as any).from("execution_tokens").select("id", { count: "exact", head: true })
      .eq("script_id", scriptId).gte("created_at", burstSince);
    if ((recentLaunches ?? 0) >= 25) {
      const { count: recentAlerts } = await (db as any).from("security_events").select("id", { count: "exact", head: true })
        .eq("script_id", scriptId).eq("event_type", "execution_burst").gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
      if (!recentAlerts) {
        await (db as any).from("security_events").insert({
          owner_id: script.owner_id, script_id: scriptId, event_type: "execution_burst", severity: "warning",
          message: "Unusual execution burst detected",
          details: { launchesInTwoMinutes: recentLaunches },
        });
        const { data: alertConfig } = await (db as any).from("scripts").select("discord_webhook,webhook_failure_enabled").eq("id", scriptId).maybeSingle();
        if (alertConfig?.discord_webhook && alertConfig.webhook_failure_enabled !== false) void sendDiscordAlert(alertConfig.discord_webhook, "⚠️ API Luavail detected an unusual execution burst (25+ launches in 2 minutes).");
      }
    }

    // Opportunistic cleanup of long-dead tokens.
    void db.from("execution_tokens").delete().lt("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());

    return Response.json({ token, canary }, { status: 200 });
  } catch (e) {
    console.error("session/init fatal:", e);
    return fail("Internal server error");
  }
}

export const Route = createFileRoute("/api/public/session/init")({
  server: {
    handlers: {
      GET: ({ request }) => handleInit(request),
      POST: ({ request }) => handleInit(request),
    },
  },
});
