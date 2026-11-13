import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DISCORD_COMMANDS } from "./discord-commands";

// Registers the bot's slash commands with Discord (safe to run repeatedly).
export const registerDiscordCommands = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const token = process.env["DISCORD_BOT_TOKEN"];
    const app = process.env["DISCORD_APPLICATION_ID"];
    if (!token || !app) return { ok: false, message: "Discord bot secrets are missing." };
    const res = await fetch(`https://discord.com/api/v10/applications/${app}/commands`, {
      method: "PUT",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify(DISCORD_COMMANDS),
    });
    if (!res.ok) return { ok: false, message: `Discord said ${res.status}: ${(await res.text()).slice(0, 300)}` };
    return { ok: true, message: "Commands registered." };
  });

export const getBotInvite = createServerFn({ method: "GET" }).handler(async () => {
  const app = process.env["DISCORD_APPLICATION_ID"];
  return { url: app ? `https://discord.com/oauth2/authorize?client_id=${app}&scope=bot%20applications.commands` : null };
});


export const updateBotProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { username: string; avatar: string | null }) => data)
  .handler(async ({ context, data }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleError || allowed !== true) return { ok: false, message: "Administrator access required." };
    const token = process.env["DISCORD_BOT_TOKEN"];
    if (!token) return { ok: false, message: "Discord bot token is missing." };
    const username = data.username.trim();
    if (username.length < 2 || username.length > 32) return { ok: false, message: "Bot name must be between 2 and 32 characters." };
    if (data.avatar && (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(data.avatar) || data.avatar.length > 600000)) return { ok: false, message: "Use a PNG, JPG, GIF or WebP image under 400 KB." };
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      method: "PATCH",
      headers: { authorization: "Bot " + token, "content-type": "application/json" },
      body: JSON.stringify({ username, ...(data.avatar ? { avatar: data.avatar } : {}) }),
    });
    if (!res.ok) return { ok: false, message: "Discord said " + res.status + ": " + (await res.text()).slice(0, 300) };
    return { ok: true, message: "Bot profile updated." };
  });


export const sendScriptWebhookTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { scriptId: string }) => data)
  .handler(async ({ context, data }) => {
    const { data: script, error } = await context.supabase
      .from("scripts")
      .select("id,name,discord_webhook")
      .eq("id", data.scriptId)
      .maybeSingle();
    if (error || !script) return { ok: false, message: "Script not found or access denied." };
    if (!script.discord_webhook) return { ok: false, message: "Save a Discord webhook URL first." };

    let webhook: URL;
    try {
      webhook = new URL(script.discord_webhook);
    } catch {
      return { ok: false, message: "The saved webhook URL is invalid." };
    }
    if (
      webhook.protocol !== "https:" ||
      !["discord.com", "discordapp.com"].includes(webhook.hostname) ||
      !/^\/api\/webhooks\/[0-9]+\/[A-Za-z0-9._-]+$/.test(webhook.pathname)
    ) {
      return { ok: false, message: "Only official Discord webhook URLs are supported." };
    }

    try {
      const response = await fetch(webhook, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            title: "Webhook test",
            description: "Your execution alerts are connected and working.",
            color: 0x8b5cf6,
            fields: [{ name: "Script", value: script.name.slice(0, 100), inline: true }],
            footer: { text: "Vault · Webhook diagnostics" },
            timestamp: new Date().toISOString(),
          }],
        }),
      });
      if (!response.ok) return { ok: false, message: "Discord returned HTTP " + response.status + "." };
      return { ok: true, message: "Test message delivered to Discord." };
    } catch {
      return { ok: false, message: "Could not reach Discord. Check the webhook URL and try again." };
    }
  });
