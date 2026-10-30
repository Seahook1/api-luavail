import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authApiRequest, json, CORS } from "@/lib/api-auth";

const Create = z.object({
  note: z.string().max(200).optional(),
  days: z.number().int().min(1).max(3650).optional(),
});

export const Route = createFileRoute("/api/public/v1/scripts/$id/keys")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request, params }) => {
        const a = await authApiRequest(request);
        if (!a) return json({ error: "Invalid API key" }, 401);
        const { data } = await a.db.from("license_keys").select("id,key,note,hwid,banned,expires_at,last_used_at,created_at")
          .eq("script_id", params.id).eq("owner_id", a.ownerId).order("created_at", { ascending: false });
        return json({ keys: data ?? [] });
      },
      POST: async ({ request, params }) => {
        const a = await authApiRequest(request);
        if (!a) return json({ error: "Invalid API key" }, 401);
        const p = Create.safeParse(await request.json().catch(() => ({})));
        if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Invalid body" }, 400);
        const { data: s } = await a.db.from("scripts").select("id").eq("id", params.id).eq("owner_id", a.ownerId).maybeSingle();
        if (!s) return json({ error: "Not found" }, 404);
        const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
        const expires_at = p.data.days ? new Date(Date.now() + p.data.days * 864e5).toISOString() : null;
        const { data, error } = await a.db.from("license_keys")
          .insert({ script_id: s.id, owner_id: a.ownerId, key, note: p.data.note ?? null, expires_at })
          .select("id,key,note,expires_at").single();
        return error ? json({ error: error.message }, 500) : json({ key: data }, 201);
      },
    },
  },
});
