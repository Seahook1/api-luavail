import { createFileRoute } from "@tanstack/react-router";

// Returns a tiny Lua loader. It never contains the real script source.
export const Route = createFileRoute("/api/public/loader/$scriptId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const id = params.scriptId.replace(/[^a-f0-9-]/gi, "");
        const origin = new URL(request.url).origin;
        const lua = `local k = (getgenv and getgenv().script_key) or script_key or ""
local h = (gethwid and gethwid()) or game:GetService("RbxAnalyticsService"):GetClientId()
local hs = game:GetService("HttpService")
local r = game:HttpGet("${origin}/api/public/fetch?s=${id}&k="..hs:UrlEncode(k).."&h="..hs:UrlEncode(h))
if r:sub(1,6) == "--ERR:" then return warn("[Vault] "..r:sub(7)) end
local f, e = loadstring(r)
if not f then return warn("[Vault] load failed") end
return f()`;
        return new Response(lua, { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
      },
    },
  },
});
