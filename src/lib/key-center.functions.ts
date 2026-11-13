import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = (value: unknown) => String(value ?? "").trim();

export const getKeyCenterData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: scripts, error: scriptError } = await db.from("scripts")
      .select("id,name").eq("owner_id", context.userId);
    if (scriptError) throw new Error("Could not load your scripts.");
    const owned = scripts ?? [];
    if (!owned.length) return { scripts: [], keys: [], audit: [], failures: [] };
    const ids = owned.map((s: { id: string }) => s.id);
    const names = new Map<string, string>(owned.map((s: { id: string; name: string }) => [s.id, s.name]));
    const [keyResult, auditResult, logResult] = await Promise.all([
      db.from("license_keys").select("id,script_id,key,note,banned,expires_at,hwid,last_used_at,max_concurrent_sessions,created_at")
        .in("script_id", ids).order("created_at", { ascending: false }).limit(500),
      db.from("audit_events").select("id,action,entity_type,entity_id,details,created_at")
        .eq("owner_id", context.userId).order("created_at", { ascending: false }).limit(50),
      db.from("execution_logs").select("id,script_id,key_note,result,created_at")
        .in("script_id", ids).order("created_at", { ascending: false }).limit(150),
    ]);
    if (keyResult.error) throw new Error("Could not load license keys.");
    return {
      scripts: owned,
      keys: (keyResult.data ?? []).map((key: Record<string, unknown>) => ({
        ...key, script_name: names.get(String(key.script_id)) ?? "Script",
        device_bound: !!key.hwid, hwid: undefined,
      })),
      audit: auditResult.data ?? [],
      failures: (logResult.data ?? []).filter((log: { result: string }) => !["success", "ok"].includes(String(log.result).toLowerCase()))
        .map((log: Record<string, unknown>) => ({ ...log, script_name: names.get(String(log.script_id)) ?? "Script" })),
    };
  });

export const createBulkLicenseKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { scriptId: string; count: number; days?: number; note?: string }) => ({
    scriptId: uuid(input?.scriptId),
    count: Math.floor(Number(input?.count)),
    days: input?.days == null ? null : Math.floor(Number(input.days)),
    note: String(input?.note ?? "").trim().slice(0, 200),
  }))
  .handler(async ({ context, data }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.scriptId) || data.count < 1 || data.count > 100)
      throw new Error("Choose a script and a quantity from 1 to 100.");
    if (data.days !== null && (data.days < 1 || data.days > 3650))
      throw new Error("Expiration must be between 1 and 3650 days.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: script } = await db.from("scripts").select("id").eq("id", data.scriptId).eq("owner_id", context.userId).maybeSingle();
    if (!script) throw new Error("Script not found.");
    const keys = Array.from({ length: data.count }, () => Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, "0")).join(""));
    const expires_at = data.days ? new Date(Date.now() + data.days * 864e5).toISOString() : null;
    const rows = keys.map(key => ({ script_id: data.scriptId, owner_id: context.userId, key, note: data.note || null, expires_at }));
    const { error } = await db.from("license_keys").insert(rows);
    if (error) throw new Error("Could not create keys: " + error.message);
    return { keys };
  });

export const updateLicenseKeyControl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { keyId: string; action: "ban" | "unban" | "reset-device" | "set-session-limit"; limit?: number }) => ({
    keyId: uuid(input?.keyId),
    action: input?.action,
    limit: Math.floor(Number(input?.limit)),
  }))
  .handler(async ({ context, data }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.keyId)) throw new Error("Invalid key.");
    if (data.action === "set-session-limit" && (!Number.isInteger(data.limit) || data.limit < 1 || data.limit > 10))
      throw new Error("Concurrent session limit must be between 1 and 10.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: key } = await db.from("license_keys").select("id,script_id").eq("id", data.keyId).maybeSingle();
    if (!key) throw new Error("Key not found.");
    const { data: script } = await db.from("scripts").select("id").eq("id", key.script_id).eq("owner_id", context.userId).maybeSingle();
    if (!script) throw new Error("Key not found.");
    let patch: Record<string, unknown> = {};
    if (data.action === "ban") patch = { banned: true };
    if (data.action === "unban") patch = { banned: false };
    if (data.action === "reset-device") patch = { hwid: null, hwid_reset_at: new Date().toISOString() };
    if (data.action === "set-session-limit") patch = { max_concurrent_sessions: data.limit };
    const { error } = await db.from("license_keys").update(patch).eq("id", data.keyId);
    if (error) throw new Error("Could not update key.");
    if (data.action === "reset-device") {
      await db.from("execution_tokens").update({ revoked: true }).eq("key_id", data.keyId).eq("revoked", false);
    }
    return { ok: true };
  });
