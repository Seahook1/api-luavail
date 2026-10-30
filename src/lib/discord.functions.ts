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
