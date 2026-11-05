import { createFileRoute } from "@tanstack/react-router";
import { getRequestIP } from "@tanstack/react-start/server";
import { hostingAllowed } from "@/lib/moderation";

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
    if (request.method === "GET") {
      const u = new URL(request.url);
      scriptId = u.searchParams.get("s");
      licenseKey = u.searchParams.get("k");
      hwid = u.searchParams.get("h");
    } else {
      const b = (await request.json().catch(() => ({}))) as Record<string, string | undefined>;
      scriptId = b["script_id"] ?? b["s"] ?? null;
      licenseKey = b["key"] ?? b["k"] ?? null;
      hwid = b["hwid"] ?? b["h"] ?? null;
    }
    if (!scriptId || !UUID.test(scriptId) || !hwid || hwid.length > 200) return fail("Missing script_id or hwid");

    const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";
    if (isRateLimited(`${ip}:${hwid}`)) return fail("Rate limit exceeded");

    const { data: banned } = await db.from("banned_hwids").select("hwid").eq("hwid", hwid).maybeSingle();
    if (banned) return fail("HWID is banned");

    const { data: script } = await db
      .from("scripts")
      .select("id, enabled, moderation_disabled, keyless")
      .eq("id", scriptId)
      .maybeSingle();
    if (!script) return fail("Script not found");
    if (!hostingAllowed(script)) return fail("Script is disabled or moderated");

    let keyId: string | null = null;

    if (!script.keyless) {
      if (!licenseKey) return fail("Missing license key");
      const { data: k } = await db
        .from("license_keys")
        .select("id, banned, expires_at, hwid, last_rebind_at, max_concurrent_sessions")
        .eq("script_id", scriptId)
        .eq("key", licenseKey)
        .maybeSingle();
      if (!k) return fail("Invalid license key");
      if (k.banned) return fail("License key is banned");
      if (k.expires_at && new Date(k.expires_at) < new Date()) return fail("License key has expired");

      if (!k.hwid) {
        await db.from("license_keys").update({ hwid }).eq("id", k.id);
      } else if (k.hwid !== hwid) {
        if (k.last_rebind_at && Date.now() - new Date(k.last_rebind_at).getTime() < 24 * 3600_000) {
          return fail("HWID does not match this key (rebind cooldown 24h)");
        }
        await db.from("license_keys").update({ hwid, last_rebind_at: new Date().toISOString() }).eq("id", k.id);
      }

      const { count } = await db
        .from("execution_tokens")
        .select("id", { count: "exact", head: true })
        .eq("key_id", k.id)
        .eq("consumed", true)
        .eq("revoked", false)
        .gt("session_expires_at", new Date().toISOString());
      if ((count ?? 0) >= k.max_concurrent_sessions) return fail("Max concurrent sessions reached");
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
      ip,
      canary,
      expires_at: new Date(Date.now() + 30_000).toISOString(),
    });
    if (insErr) return fail("Internal error creating token");

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
