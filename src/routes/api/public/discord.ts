import { createFileRoute } from "@tanstack/react-router";

const hex = (h: string) => new Uint8Array(h.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
const reply = (content: string) => Response.json({ type: 4, data: { content, flags: 64 } });

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
        if (i.type !== 2) return reply("Unsupported.");

        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const name: string = i.data?.name;
        const opts: Record<string, string | number> = Object.fromEntries(((i.data?.options ?? []) as Opt[]).map((o) => [o.name, o.value]));
        const key = String(opts["key"] ?? "").trim().slice(0, 128);
        const origin = new URL(request.url).origin;
        const guild: string | undefined = i.guild_id;
        const isAdmin = !!i.member && (BigInt(i.member.permissions ?? "0") & 8n) === 8n;

        if (name === "redeem") {
          const { data: lic } = await db.from("license_keys").select("banned, expires_at, script_id, hwid, scripts(name)").eq("key", key).maybeSingle();
          if (!lic) return reply("❌ Key not found.");
          if (lic.banned) return reply("⛔ This key is banned. Contact the seller.");
          if (lic.expires_at && new Date(lic.expires_at) < new Date()) return reply("⌛ This key has expired. Contact the seller.");
          const sn = (lic.scripts as unknown as { name?: string } | null)?.name ?? "Script";
          const exp = lic.expires_at ? `<t:${Math.floor(new Date(lic.expires_at).getTime() / 1000)}:R>` : "never";
          return reply(`✅ **${sn}** — valid, expires ${exp}, device ${lic.hwid ? "locked" : "not locked yet"}\n\`\`\`lua\nscript_key = "${key}"\nloadstring(game:HttpGet("${origin}/api/public/loader/${lic.script_id}"))()\n\`\`\``);
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
          return reply("✅ This server is now linked to your Vault account.");
        }

        const { data: link } = await db.from("discord_links").select("user_id").eq("guild_id", guild).maybeSingle();
        if (!link) return reply("This server isn't linked. Run /link with the code from your dashboard.");
        const { data: owned } = await db.from("scripts").select("id, name").eq("owner_id", link.user_id);
        const ids = (owned ?? []).map((s) => s.id);

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
