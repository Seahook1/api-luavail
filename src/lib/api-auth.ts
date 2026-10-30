export async function hashApiKey(raw: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

// Resolves the API key in the Authorization header to its owner. Returns null if invalid.
export async function authApiRequest(request: Request) {
  const m = /^Bearer\s+(vk_[0-9a-f]{48})$/.exec(request.headers.get("authorization") ?? "");
  if (!m) return null;
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data } = await db.from("api_keys").select("id,owner_id").eq("key_hash", await hashApiKey(m[1])).maybeSingle();
  if (!data) return null;
  await db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { db, ownerId: data.owner_id };
}

export const SCRIPT_COLS = "id,name,source,executions,enabled,keyless,getkey_enabled,checkpoints,getkey_hours,created_at";
