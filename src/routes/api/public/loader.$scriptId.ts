import { createFileRoute } from "@tanstack/react-router";
import { obfuscateLua } from "@/lib/obfuscate";

// Obfuscate the bootstrap on every request; the hosted source stays behind fetch authorization.
export const Route = createFileRoute("/api/public/loader/$scriptId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const id = params.scriptId.replace(/[^a-f0-9-]/gi, "");
        const origin = new URL(request.url).origin;
        const { isBrowserNavigation, browserBlockedPage } = await import("@/lib/browser-page");
        if (isBrowserNavigation(request))
          return browserBlockedPage(`${origin}/api/public/loader/${id}`);
        const lua = `local k = (getgenv and getgenv().script_key) or script_key or ""
local h = (gethwid and gethwid()) or game:GetService("RbxAnalyticsService"):GetClientId()
local hs = game:GetService("HttpService")
local ok, r = pcall(function() return game:HttpGet("${origin}/api/public/fetch?s=${id}&k="..hs:UrlEncode(k).."&h="..hs:UrlEncode(h)) end)
if not ok then return warn("[Vault] request failed: "..tostring(r)) end
if r:sub(1,6) == "--ERR:" then return warn("[Vault] "..r:sub(7)) end
local f, e = loadstring(r)
if not f then return warn("[Vault] load failed") end
return f()`;
        return new Response(`-- Do not save this file. Always use the loadstring.\n${obfuscateLua(lua)}`, {
          headers: { "content-type": "text/plain", "cache-control": "no-store" },
        });
      },
    },
  },
});
