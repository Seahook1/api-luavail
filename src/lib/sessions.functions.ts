import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getActiveSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: ownedScripts, error: scriptsError } = await db
      .from("scripts")
      .select("id,name")
      .eq("owner_id", context.userId);
    if (scriptsError) throw new Error("Could not load your scripts.");
    const scripts = ownedScripts ?? [];
    if (!scripts.length) return [];

    const names = new Map<string, string>(scripts.map((script: { id: string; name: string }) => [script.id, script.name]));
    const { data, error } = await db
      .from("execution_tokens")
      .select("id,script_id,executor,roblox_username,roblox_display_name,created_at,last_heartbeat_at,session_expires_at")
      .eq("consumed", true)
      .eq("revoked", false)
      .gt("session_expires_at", new Date().toISOString())
      .in("script_id", scripts.map((script: { id: string }) => script.id))
      .order("last_heartbeat_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("Could not load active sessions.");
    return (data ?? []).map((session: Record<string, unknown>) => ({
      ...session,
      script_name: names.get(String(session.script_id)) ?? "Unknown script",
    }));
  });

export const revokeExecutionSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { sessionId: string }) => data)
  .handler(async ({ context, data }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.sessionId)) return { ok: false, message: "Invalid session." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: ownedScripts, error: scriptsError } = await db
      .from("scripts")
      .select("id")
      .eq("owner_id", context.userId);
    if (scriptsError || !ownedScripts?.length) return { ok: false, message: "Session not found." };
    const { data: revoked, error } = await db
      .from("execution_tokens")
      .update({ revoked: true })
      .eq("id", data.sessionId)
      .eq("consumed", true)
      .eq("revoked", false)
      .in("script_id", ownedScripts.map((script: { id: string }) => script.id))
      .select("id")
      .maybeSingle();
    if (error || !revoked) return { ok: false, message: "Session was not found or is no longer active." };
    return { ok: true, message: "Session revoked." };
  });
