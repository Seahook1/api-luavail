import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authApiRequest, json, CORS, SCRIPT_COLS } from "@/lib/api-auth";

const Create = z.object({
  name: z.string().trim().min(1).max(100),
  source: z.string().max(500_000).optional(),
  keyless: z.boolean().optional(),
});

export const Route = createFileRoute("/api/public/v1/scripts")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const a = await authApiRequest(request);
        if (!a) return json({ error: "Invalid API key" }, 401);
        const { data, error } = await a.db.from("scripts").select(SCRIPT_COLS).eq("owner_id", a.ownerId).order("created_at");
        return error ? json({ error: error.message }, 500) : json({ scripts: data });
      },
      POST: async ({ request }) => {
        const a = await authApiRequest(request);
        if (!a) return json({ error: "Invalid API key" }, 401);
        const p = Create.safeParse(await request.json().catch(() => null));
        if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Invalid body" }, 400);
        const { data, error } = await a.db.from("scripts").insert({ name: p.data.name, source: p.data.source ?? "", keyless: p.data.keyless ?? false, owner_id: a.ownerId }).select(SCRIPT_COLS).single();
        if (error) return json({ error: error.message }, 500);
        const origin = new URL(request.url).origin;
        return json({ script: data, loader: `loadstring(game:HttpGet("${origin}/api/public/loader/${data.id}"))()` }, 201);
      },
    },
  },
});
