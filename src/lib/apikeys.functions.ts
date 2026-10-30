import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hashApiKey } from "./api-auth";

// Creates an API key; the raw key is returned only once and only its hash is stored.
export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string }) => {
    const name = String(input?.name ?? "").trim().slice(0, 60);
    if (!name) throw new Error("Name is required");
    return { name };
  })
  .handler(async ({ data, context }) => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const raw = "vk_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("api_keys").insert({
      owner_id: context.userId,
      name: data.name,
      prefix: raw.slice(0, 10),
      key_hash: await hashApiKey(raw),
    });
    if (error) throw new Error(error.message);
    return { key: raw };
  });
