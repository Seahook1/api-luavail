import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { moderationInput } from "@/lib/moderation";

export const getAdminAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (error) throw new Error("Could not check admin access.");
    return data === true;
  });

export const listAdminScripts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("admin_list_scripts");
    if (error) throw new Error("Administrator access required, or scripts could not be loaded.");
    return data;
  });

export const moderateScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => moderationInput.parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("admin_moderate_script", {
      _script_id: data.scriptId,
      _action: data.action,
    });
    if (error) throw new Error("Administrator access required, or the script no longer exists.");
    return { ok: true };
  });
