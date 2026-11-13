import { createServerFn } from "@tanstack/react-start";

export const checkKey = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string }) => ({ key: String(d?.key ?? "").trim().slice(0, 128) }))
  .handler(async ({ data }) => {
    if (!data.key) return { found: false as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: lic } = await supabaseAdmin
      .from("license_keys")
      .select("id, banned, expires_at, script_id, hwid, last_used_at, max_concurrent_sessions, scripts(name)")
      .eq("key", data.key)
      .maybeSingle();
    if (!lic) return { found: false as const };
    const expired = !!lic.expires_at && new Date(lic.expires_at) < new Date();
    const status = lic.banned ? "banned" : expired ? "expired" : "valid";
    const s = lic.scripts as unknown as { name?: string } | null;
    const { data: recentActivity } = await supabaseAdmin.from("execution_logs")
      .select("result,created_at").eq("key_id", lic.id).order("created_at", { ascending: false }).limit(10);
    return {
      found: true as const,
      status,
      scriptId: lic.script_id as string,
      scriptName: s?.name ?? "Script",
      expiresAt: lic.expires_at as string | null,
      hwidLocked: !!lic.hwid,
      lastUsedAt: lic.last_used_at as string | null,
      maxConcurrentSessions: Number(lic.max_concurrent_sessions ?? 1),
      recentActivity: (recentActivity ?? []).map((event: { result: string; created_at: string }) => ({ result: event.result, createdAt: event.created_at })),
    };
  });

// Buyer self-service device reset, limited to once per 24h per key.
export const resetHwid = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string }) => ({ key: String(d?.key ?? "").trim().slice(0, 128) }))
  .handler(async ({ data }) => {
    if (!data.key) return { ok: false as const, message: "Key not found." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: lic } = await supabaseAdmin
      .from("license_keys").select("id, hwid, banned, expires_at, hwid_reset_at").eq("key", data.key).maybeSingle();
    if (!lic) return { ok: false as const, message: "Key not found." };
    if (lic.banned || (lic.expires_at && new Date(lic.expires_at) < new Date()))
      return { ok: false as const, message: "This key can no longer be used." };
    if (!lic.hwid) return { ok: false as const, message: "Your key isn't locked to a device yet." };
    const next = lic.hwid_reset_at ? new Date(lic.hwid_reset_at).getTime() + 864e5 : 0;
    if (next > Date.now())
      return { ok: false as const, message: `You can reset again on ${new Date(next).toLocaleString()}.` };
    await supabaseAdmin.from("license_keys").update({ hwid: null, hwid_reset_at: new Date().toISOString() }).eq("id", lic.id);
    // Resetting a device also ends existing sessions so the previous device cannot keep running.
    await supabaseAdmin.from("execution_tokens").update({ revoked: true }).eq("key_id", lic.id).eq("revoked", false);
    return { ok: true as const, message: "Device reset. Existing sessions were ended; run the loader on your new device." };
  });
