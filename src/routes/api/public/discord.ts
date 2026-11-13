import { createFileRoute } from "@tanstack/react-router";

const hex = (h: string) => new Uint8Array(h.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
const reply = (content: string, components?: unknown[]) =>
  Response.json({ type: 4, data: { content, flags: 64, ...(components ? { components } : {}) } });
const keyModal = (id: string, title: string) =>
  Response.json({ type: 9, data: { custom_id: id, title, components: [{ type: 1, components: [{ type: 4, custom_id: "key", label: "License key", style: 1, min_length: 4, max_length: 128, required: true }] }] } });
const btn = (label: string, custom_id: string, style = 2) => ({ type: 2, style, label, custom_id });

async function verify(req: Request, body: string) {
  const pk = process.env["DISCORD_PUBLIC_KEY"];
  const sig = req.headers.get("x-signature-ed25519");
  const ts = req.headers.get("x-signature-timestamp");
  if (!pk || !sig || !ts || !/^[0-9a-f]+$/i.test(sig)) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hex(pk), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hex(sig), new TextEncoder().encode(ts + body));
  } catch { return false; }
}

type Opt = { name: string; value: string | number };

export const Route = createFileRoute("/api/public/discord")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        if (!(await verify(request, body))) return new Response("Invalid signature", { status: 401 });
        const i = JSON.parse(body);
        if (i.type === 1) return Response.json({ type: 1 });
        if (i.type !== 2 && i.type !== 3 && i.type !== 5) return reply("Unsupported.");

        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        let name: string = i.data?.name;
        let opts: Record<string, string | number> = Object.fromEntries(((i.data?.options ?? []) as Opt[]).map((o) => [o.name, o.value]));

        // Panel buttons
        if (i.type === 3) {
          const [, action, sid] = String(i.data?.custom_id ?? "").split(":");
          if (action === "redeem") return keyModal("modal:redeem", "Redeem key");
          if (action === "resethwid") return keyModal("modal:resethwid", "Reset device lock");
          if (action === "check") return keyModal("modal:check", "Check key status");
          if (action === "getkey") {
            const { data: sc } = await db.from("scripts").select("id, name, getkey_enabled, enabled, moderation_disabled").eq("id", sid ?? "").maybeSingle();
            if (!sc || !sc.enabled || sc.moderation_disabled) return reply("This script is currently unavailable.");
            if (!sc.getkey_enabled) return reply("Free keys aren't available for this script. Contact the seller to buy a key.");
            return reply(`🔑 Complete the checkpoints to get a free key for **${sc.name}**:`, [{ type: 1, components: [{ type: 2, style: 5, label: "Get key", url: `${new URL(request.url).origin}/getkey/${sc.id}` }] }]);
          }
          return reply("Unknown button.");
        }
        // Modal submits map onto the slash command handlers
        if (i.type === 5) {
          name = String(i.data?.custom_id ?? "").replace("modal:", "");
          const v = i.data?.components?.[0]?.components?.[0]?.value;
          opts = { key: String(v ?? "") };
        }
        const key = String(opts["key"] ?? "").trim().slice(0, 128);
        const origin = new URL(request.url).origin;
        const guild: string | undefined = i.guild_id;
        const isAdmin = !!i.member && (BigInt(i.member.permissions ?? "0") & 8n) === 8n;

        if (name === "help") {
          return reply("**API Luavail** — script licensing and delivery\n\nBuyer commands: `/redeem`, `/resethwid`\nSeller commands: `/link`, `/panel`, `/genkey`, `/ban`, `/unban`, `/delkey`, `/stats`, `/maintenance`\nUse `/status` to check service connectivity.");
        }
        if (name === "status") {
          const { error } = await db.from("scripts").select("id").limit(1);
          return reply(error ? "⚠️ API Luavail database check failed." : "🟢 API Luavail is responding and the database is reachable.");
        }
        if (name === "redeem") {
          const { data: lic } = await db.from("license_keys").select("banned, expires_at, script_id, hwid, scripts(name)").eq("key", key).maybeSingle();
          if (!lic) return reply("❌ Key not found.");
          if (lic.banned) return reply("⛔ This key is banned. Contact the seller.");
          if (lic.expires_at && new Date(lic.expires_at) < new Date()) return reply("⌛ This key has expired. Contact the seller.");
          const sn = (lic.scripts as unknown as { name?: string } | null)?.name ?? "Script";
          const exp = lic.expires_at ? `<t:${Math.floor(new Date(lic.expires_at).getTime() / 1000)}:R>` : "never";
          return reply(`✅ **${sn}** — valid, expires ${exp}, device ${lic.hwid ? "locked" : "not locked yet"}\n\`\`\`lua\nscript_key = "${key}"\nloadstring(game:HttpGet("${origin}/api/public/cdn/loader/${lic.script_id}"))()\n\`\`\``);
        }

        if (name === "check") {
          const { data: lic } = await db.from("license_keys").select("banned, expires_at, hwid, scripts(name)").eq("key", key).maybeSingle();
          if (!lic) return reply("❌ Key not found.");
          const sn = (lic.scripts as unknown as { name?: string } | null)?.name ?? "Script";
          const expired = !!lic.expires_at && new Date(lic.expires_at) < new Date();
          const exp = lic.expires_at ? `<t:${Math.floor(new Date(lic.expires_at).getTime() / 1000)}:R>` : "never";
          return reply(`**${sn}** — ${lic.banned ? "⛔ banned" : expired ? "⌛ expired" : "✅ valid"}\nExpires: ${exp}\nDevice: ${lic.hwid ? "locked" : "not locked yet"}`);
        }

        if (name === "resethwid") {
          const { data: lic } = await db.from("license_keys").select("id, hwid, banned, expires_at, hwid_reset_at").eq("key", key).maybeSingle();
          if (!lic) return reply("❌ Key not found.");
          if (lic.banned || (lic.expires_at && new Date(lic.expires_at) < new Date())) return reply("This key can no longer be used.");
          if (!lic.hwid) return reply("Your key isn't locked to a device yet.");
          const next = lic.hwid_reset_at ? new Date(lic.hwid_reset_at).getTime() + 864e5 : 0;
          if (next > Date.now()) return reply(`You can reset again <t:${Math.floor(next / 1000)}:R>.`);
          await db.from("license_keys").update({ hwid: null, hwid_reset_at: new Date().toISOString() }).eq("id", lic.id);
          return reply("✅ Device reset. Run the loader on your new device.");
        }

        // Seller commands: server admins only, in a linked server.
        if (!guild || !isAdmin) return reply("Only server admins can use this command.");

        if (name === "link") {
          const code = String(opts["code"] ?? "").trim().slice(0, 64);
          const { data: row } = await db.from("discord_links").select("user_id").eq("link_code", code).maybeSingle();
          if (!row) return reply("❌ Invalid link code.");
          await db.from("discord_links").update({ guild_id: null }).eq("guild_id", guild);
          await db.from("discord_links").update({ guild_id: guild }).eq("user_id", row.user_id);
          return reply("✅ This server is now linked to your API Luavail account.");
        }

        const { data: link } = await db.from("discord_links").select("user_id").eq("guild_id", guild).maybeSingle();
        if (!link) return reply("This server isn't linked. Run /link with the code from your dashboard.");
        const { data: owned } = await db.from("scripts").select("id, name").eq("owner_id", link.user_id);
        const ids = (owned ?? []).map((s) => s.id);

        if (name === "stats") {
          const { count: scriptCount } = await db.from("scripts").select("id", { count: "exact", head: true }).eq("owner_id", link.user_id);
          const { count: keyCount } = await db.from("license_keys").select("id", { count: "exact", head: true }).in("script_id", ids);
          const { count: activeCount } = await db.from("license_keys").select("id", { count: "exact", head: true }).in("script_id", ids).eq("banned", false);
          const { count: runCount } = await db.from("execution_logs").select("id", { count: "exact", head: true }).in("script_id", ids);
          return reply("📊 **API Luavail statistics**\nScripts: **" + (scriptCount ?? 0) + "**\nLicense keys: **" + (keyCount ?? 0) + "**\nNot banned: **" + (activeCount ?? 0) + "**\nRecorded runs: **" + (runCount ?? 0) + "**");
        }

        if (name === "maintenance") {
          const sname = String(opts["script"] ?? "").trim().toLowerCase();
          const sc = (owned ?? []).find((s) => s.name.toLowerCase() === sname);
          if (!sc) return reply("❌ Script not found in your account.");
          const enabled = opts["enabled"] === true || opts["enabled"] === "true";
          const { error } = await db.from("scripts").update({ maintenance_mode: enabled }).eq("id", sc.id).eq("owner_id", link.user_id);
          if (error) return reply("❌ Could not update maintenance mode.");
          return reply((enabled ? "🛠️ Maintenance enabled" : "✅ Maintenance disabled") + " for **" + sc.name + "**.");
        }
        if (name === "panel") {
          const sname = String(opts["script"] ?? "").trim().toLowerCase();
          const sc = (owned ?? []).find((s) => s.name.toLowerCase() === sname);
          if (!sc) return reply(`❌ No script named that. Your scripts: ${(owned ?? []).map((s) => s.name).join(", ") || "none"}`);
          return Response.json({ type: 4, data: {
            embeds: [{
              title: String(opts["title"] ?? `${sc.name} — Key Panel`).slice(0, 256),
              description: String(opts["description"] ?? "Use the buttons below to get, redeem or manage your key.").slice(0, 2000),
              color: 0x22c55e,
              fields: [
                { name: "🔑 Get key", value: "Get a free key through the checkpoints", inline: true },
                { name: "✅ Redeem key", value: "Get your loader script", inline: true },
                { name: "🔄 Reset HWID", value: "Move your key to a new device", inline: true },
                { name: "🔎 Check key", value: "See status and expiry", inline: true },
              ],
              footer: { text: "Powered by API Luavail" },
            }],
            components: [{ type: 1, components: [
              btn("Get key", `panel:getkey:${sc.id}`, 1), btn("Redeem key", "panel:redeem", 3),
              btn("Reset HWID", "panel:resethwid"), btn("Check key", "panel:check"),
            ] }],
            allowed_mentions: { parse: [] },
          } });
        }

        if (name === "genkey") {
          const sname = String(opts["script"] ?? "").trim().toLowerCase();
          const sc = (owned ?? []).find((s) => s.name.toLowerCase() === sname);
          if (!sc) return reply(`❌ No script named that. Your scripts: ${(owned ?? []).map((s) => s.name).join(", ") || "none"}`);
          const nk = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
          const days = Number(opts["days"] ?? 0);
          const expires_at = days > 0 ? new Date(Date.now() + days * 864e5).toISOString() : null;
          const { error } = await db.from("license_keys").insert({ script_id: sc.id, key: nk, note: opts["note"] ? String(opts["note"]).slice(0, 100) : null, expires_at });
          if (error) return reply("❌ Could not create key.");
          return reply(`🔑 Key for **${sc.name}** (${days > 0 ? `${days} days` : "lifetime"}):\n\`${nk}\``);
        }

        if (name === "ban" || name === "unban" || name === "delkey") {
          const { data: lic } = await db.from("license_keys").select("id, script_id").eq("key", key).maybeSingle();
          if (!lic || !ids.includes(lic.script_id)) return reply("❌ Key not found in your scripts.");
          if (name === "delkey") await db.from("license_keys").delete().eq("id", lic.id);
          else await db.from("license_keys").update({ banned: name === "ban" }).eq("id", lic.id);
          return reply(`✅ Key ${name === "delkey" ? "deleted" : name === "ban" ? "banned" : "unbanned"}.`);
        }
        return reply("Unknown command.");
      },
    },
  },
});
