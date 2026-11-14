import { createFileRoute } from "@tanstack/react-router";
import { hostingAllowed } from "@/lib/moderation";

const SESSION_SECONDS = 120;
const fail = (msg: string) => new Response(`--ERR:${msg}`, { status: 200 });

export const Route = createFileRoute("/api/public/heartbeat")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const t = new URL(request.url).searchParams.get("t");
          if (!t || t.length > 128) return fail("Missing token");
          const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

          const { data: row } = await db
            .from("execution_tokens")
            .select("id, revoked, session_expires_at, script_id, key_id, hwid")
            .eq("heartbeat_token", t)
            .maybeSingle();
          if (!row || row.revoked || (row.session_expires_at && new Date(row.session_expires_at) < new Date())) {
            return fail("Session revoked or expired");
          }

          // Kill the session when the script is moderated/disabled or the key/HWID gets banned.
          const { data: script } = await db
            .from("scripts")
            .select("owner_id, enabled, moderation_disabled")
            .eq("id", row.script_id)
            .maybeSingle();
          const { data: lockdown } = await db.from("platform_settings").select("emergency_lockdown").eq("owner_id", script?.owner_id).maybeSingle();
          const { data: bannedHwid } = await db.from("banned_hwids").select("hwid").eq("hwid", row.hwid).maybeSingle();
          let keyBanned = false;
          if (row.key_id) {
            const { data: k } = await db.from("license_keys").select("banned, expires_at, hwid").eq("id", row.key_id).maybeSingle();
            keyBanned =
              !k ||
              k.banned ||
              (!!k.expires_at && new Date(k.expires_at) < new Date()) ||
              (!!k.hwid && k.hwid !== row.hwid);
          }
          if (!script || !hostingAllowed(script) || lockdown?.emergency_lockdown || bannedHwid || keyBanned) {
            await db.from("execution_tokens").update({ revoked: true }).eq("id", row.id);
            return fail("Session revoked or expired");
          }

          await db
            .from("execution_tokens")
            .update({
              last_heartbeat_at: new Date().toISOString(),
              session_expires_at: new Date(Date.now() + SESSION_SECONDS * 1000).toISOString(),
            })
            .eq("id", row.id);
          return new Response("OK", { status: 200 });
        } catch (err) {
          console.error("heartbeat fatal:", err);
          return fail("Internal server error");
        }
      },
    },
  },
});
