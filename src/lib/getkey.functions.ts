import { createServerFn } from "@tanstack/react-start";
import { hostingAllowed } from "@/lib/moderation";
import { checkpointToken, isBypassReferrer } from "@/lib/getkey-token";

const MIN_SECONDS = 15; // must spend at least this long on the ad link before returning
const uuid = (v: unknown) =>
  String(v ?? "")
    .replace(/[^a-f0-9-]/gi, "")
    .slice(0, 36);
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

async function loadScript(id: string) {
  const sb = await admin();
  const { data } = await sb
    .from("scripts")
    .select("name, enabled, moderation_disabled, getkey_enabled, checkpoints, getkey_hours")
    .eq("id", id)
    .maybeSingle();
  return data && hostingAllowed(data) && data.getkey_enabled && data.checkpoints.length > 0
    ? data
    : null;
}

async function state(scriptId: string, sessionId: string) {
  const sb = await admin();
  const { data } = await sb
    .from("getkey_sessions")
    .select("id, step, key, script_id")
    .eq("id", sessionId)
    .maybeSingle();
  return data && data.script_id === scriptId ? data : null;
}

export const getKeyStatus = createServerFn({ method: "POST" })
  .inputValidator((d: { scriptId: string; sessionId?: string | undefined }) => ({
    scriptId: uuid(d?.scriptId),
    sessionId: uuid(d?.sessionId),
  }))
  .handler(async ({ data }) => {
    const sc = await loadScript(data.scriptId);
    if (!sc) return { ok: false as const };
    const sb = await admin();
    let s = data.sessionId ? await state(data.scriptId, data.sessionId) : null;
    if (!s) {
      const { data: n } = await sb
        .from("getkey_sessions")
        .insert({ script_id: data.scriptId })
        .select("id, step, key, script_id")
        .single();
      if (!n) return { ok: false as const };
      s = n;
    }
    return {
      ok: true as const,
      name: sc.name,
      total: sc.checkpoints.length,
      hours: sc.getkey_hours,
      sessionId: s.id,
      step: s.step,
      key: s.key,
    };
  });

// Called right before the buyer is sent to the ad link; returns the URL to open.
export const beginCheckpoint = createServerFn({ method: "POST" })
  .inputValidator((d: { scriptId: string; sessionId: string }) => ({
    scriptId: uuid(d?.scriptId),
    sessionId: uuid(d?.sessionId),
  }))
  .handler(async ({ data }) => {
    const sc = await loadScript(data.scriptId);
    const s = sc && (await state(data.scriptId, data.sessionId));
    if (!sc || !s || s.key) return { url: null };
    const sb = await admin();
    await sb
      .from("getkey_sessions")
      .update({ step_started_at: new Date().toISOString() })
      .eq("id", s.id);
    return { url: sc.checkpoints[s.step] ?? null };
  });

// Called when the ad link sends the buyer back with ?cp=N.
export const completeCheckpoint = createServerFn({ method: "POST" })
  .inputValidator((d: { scriptId: string; sessionId: string; cp: number; t?: string | undefined; ref?: string | undefined }) => ({
    scriptId: uuid(d?.scriptId),
    sessionId: uuid(d?.sessionId),
    cp: Math.floor(Number(d?.cp) || 0),
    t: String(d?.t ?? "").replace(/[^a-f0-9]/gi, "").slice(0, 64),
    ref: String(d?.ref ?? "").slice(0, 500),
  }))
  .handler(async ({ data }) => {
    const sc = await loadScript(data.scriptId);
    if (!sc) return { message: "Key system is off." };
    const sb = await admin();
    const { data: s } = await sb
      .from("getkey_sessions")
      .select("id, step, step_started_at, key, script_id")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!s || s.script_id !== data.scriptId) return { message: "Session not found, start again." };
    if (s.key) return { message: "" };
    if (data.cp !== s.step + 1 || !s.step_started_at)
      return { message: "Complete the checkpoints in order." };
    const bypassFail = async (why: string) => {
      // Anti-bypass: wipe progress so the buyer must start over.
      await sb.from("getkey_sessions").update({ step: 0, step_started_at: null }).eq("id", s.id);
      return { message: `⚠ Bypass detected (${why}). Your progress was reset — complete the checkpoints normally.` };
    };
    if (isBypassReferrer(data.ref)) return bypassFail("bypass site");
    const { data: own } = await sb.from("scripts").select("owner_id").eq("id", data.scriptId).single();
    if (!own || data.t !== (await checkpointToken(data.scriptId, own.owner_id, data.cp)))
      return bypassFail("invalid checkpoint link");
    if (Date.now() - new Date(s.step_started_at).getTime() < MIN_SECONDS * 1000)
      return bypassFail("finished too fast");
    const step = s.step + 1;
    let key: string | null = null;
    if (step >= sc.checkpoints.length) {
      key =
        "FREE_" +
        Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
      const { data: owner } = await sb
        .from("scripts")
        .select("owner_id")
        .eq("id", data.scriptId)
        .single();
      if (!owner) return { message: "Script not found." };
      await sb.from("license_keys").insert({
        script_id: data.scriptId,
        owner_id: owner.owner_id,
        key,
        note: "get-key page",
        expires_at: new Date(Date.now() + sc.getkey_hours * 3600e3).toISOString(),
      });
    }
    await sb.from("getkey_sessions").update({ step, step_started_at: null, key }).eq("id", s.id);
    return { message: "" };
  });
