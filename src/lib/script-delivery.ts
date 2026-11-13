import { hostingAllowed } from "@/lib/moderation";
import { isBrowserNavigation, browserBlockedPage } from "@/lib/browser-page";
import { obfuscateLua } from "@/lib/obfuscate";
import { DELIVERY_HEADERS } from "@/lib/delivery-links";

const SESSION_SECONDS = 120;
const INTERVAL_SECONDS = 30;
const fail = (msg: string) =>
  new Response(`--ERR:${msg}`, { status: 200, headers: DELIVERY_HEADERS });
const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

export async function servePayload(request: Request) {
  try {
    if (isBrowserNavigation(request)) {
      return browserBlockedPage(`${new URL(request.url).origin}/api/public/cdn/loader/SCRIPT_ID`);
    }
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const token = new URL(request.url).searchParams.get("token");
    if (!token || token.length > 128) return fail("Missing token");

    // Atomic single-use: only one request can flip consumed false -> true.
    const heartbeat = hex(24);
    const now = new Date();
    const { data: row } = await db
      .from("execution_tokens")
      .update({
        consumed: true,
        heartbeat_token: heartbeat,
        session_expires_at: new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString(),
        last_heartbeat_at: now.toISOString(),
      })
      .eq("token", token)
      .eq("consumed", false)
      .eq("revoked", false)
      .gt("expires_at", now.toISOString())
      .select("id, script_id, key_id, executor, roblox_username, roblox_display_name")
      .maybeSingle();
    if (!row) return fail("Token expired or already used");

    const { data: script } = await db
      .from("scripts")
      .select("id, source, enabled, moderation_disabled, executions, maintenance_mode")
      .eq("id", row.script_id)
      .maybeSingle();
    if (!script || !hostingAllowed(script)) return fail("Script is disabled or moderated");
    if ((script as typeof script & { maintenance_mode?: boolean }).maintenance_mode) return fail("Script is temporarily in maintenance mode");
    if (!script.source) return fail("No payload available");

    await db
      .from("scripts")
      .update({ executions: script.executions + 1 })
      .eq("id", script.id);
    await db.from("execution_logs").insert({
      script_id: script.id,
      key_id: row.key_id,
      executor: row.executor ?? "Unknown",
      roblox_username: row.roblox_username,
      roblox_display_name: row.roblox_display_name,
      result: "success",
    });

    // Every delivery is freshly obfuscated with new keys/names, so no two payloads match.
    return Response.json(
      {
        payload: obfuscateLua(script.source, 3),
        heartbeat_token: heartbeat,
        interval: INTERVAL_SECONDS,
      },
      { status: 200, headers: DELIVERY_HEADERS },
    );
  } catch (err) {
    console.error("fetch fatal:", err);
    return fail("Internal server error");
  }
}
