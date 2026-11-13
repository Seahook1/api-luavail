// Slash command definitions registered with Discord.
const str = (name: string, description: string, required = true) => ({ type: 3, name, description, required });
const int = (name: string, description: string) => ({ type: 4, name, description, required: false });
const ADMIN = "8"; // only server admins see seller commands by default

export const DISCORD_COMMANDS = [
  { name: "help", description: "Show API Luavail bot commands" },
  { name: "status", description: "Check API Luavail service status" },
  { name: "redeem", description: "Get your loader line for a key", options: [str("key", "Your license key")] },
  { name: "resethwid", description: "Reset the device lock on your key", options: [str("key", "Your license key")] },
  { name: "link", description: "Link this server to your Vault account", default_member_permissions: ADMIN, options: [str("code", "Link code from the Vault dashboard")] },
  { name: "stats", description: "View your script and license statistics", default_member_permissions: ADMIN },
  { name: "maintenance", description: "Toggle maintenance mode for one of your scripts", default_member_permissions: ADMIN, options: [str("script", "Script name"), { type: 5, name: "enabled", description: "Enable maintenance mode", required: true }] },
  { name: "panel", description: "Post a key panel with buttons for buyers", default_member_permissions: ADMIN, options: [str("script", "Script name"), str("title", "Panel title", false), str("description", "Panel text", false)] },
  { name: "genkey", description: "Generate a key", default_member_permissions: ADMIN, options: [str("script", "Script name"), str("note", "Buyer note", false), int("days", "Days until expiry (blank = lifetime)")] },
  { name: "ban", description: "Ban a key", default_member_permissions: ADMIN, options: [str("key", "License key")] },
  { name: "unban", description: "Unban a key", default_member_permissions: ADMIN, options: [str("key", "License key")] },
  { name: "delkey", description: "Delete a key", default_member_permissions: ADMIN, options: [str("key", "License key")] },
];

export function sendDiscordAlert(url: string | null | undefined, text: string) {
  if (!url || !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) return Promise.resolve();
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      embeds: [{ description: text.slice(0, 4000), color: 0x292929 }],
      allowed_mentions: { parse: [] },
    }),
  }).then(() => undefined, () => undefined);
}
