import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authApiRequest, json, CORS, SCRIPT_COLS } from "@/lib/api-auth";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

const Patch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  source: z.string().max(MAX_SOURCE_BYTES).refine((value) => new TextEncoder().encode(value).byteLength <= MAX_SOURCE_BYTES, "Source must be 10 MB or smaller").optional(),
  enabled: z.boolean().optional(),
  keyless: z.boolean().optional(),
}).strict();
const Id = z.string().uuid();

export const Route = createFileRoute("/api/public/v1/scripts/$id")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request, params }) => {
        const a = await authApiRequest(request);
        if (!a) return json({ error: "Invalid API key" }, 401);
        if (!Id.safeParse(params.id).success) return json({ error: "Not found" }, 404);
        const { data } = await a.db.from("scripts").select(SCRIPT_COLS).eq("id", params.id).eq("owner_id", a.ownerId).maybeSingle();
        return data ? json({ script: data }) : json({ error: "Not found" }, 404);
      },
      PATCH: async ({ request, params }) => {
        const a = await authApiRequest(request);
        if (!a) return json({ error: "Invalid API key" }, 401);
        if (!Id.safeParse(params.id).success) return json({ error: "Not found" }, 404);
        const p = Patch.safeParse(await request.json().catch(() => null));
        if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Invalid body" }, 400);
        const { data } = await a.db.from("scripts").update(JSON.parse(JSON.stringify(p.data)) as { name?: string; source?: string; enabled?: boolean; keyless?: boolean }).eq("id", params.id).eq("owner_id", a.ownerId).select(SCRIPT_COLS).maybeSingle();
        return data ? json({ script: data }) : json({ error: "Not found" }, 404);
      },
      DELETE: async ({ request, params }) => {
        const a = await authApiRequest(request);
        if (!a) return json({ error: "Invalid API key" }, 401);
        if (!Id.safeParse(params.id).success) return json({ error: "Not found" }, 404);
        const { data } = await a.db.from("scripts").delete().eq("id", params.id).eq("owner_id", a.ownerId).select("id").maybeSingle();
        return data ? json({ deleted: true }) : json({ error: "Not found" }, 404);
      },
    },
  },
});
