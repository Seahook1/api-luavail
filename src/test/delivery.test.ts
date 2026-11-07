import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { buildLoaderLua, serveLoader } from "@/lib/script-loader";
import { loaderUrl, CDN_PAYLOAD_PATH } from "@/lib/delivery-links";
import { obfuscateLua } from "@/lib/obfuscate";

const maybeSingle = vi.fn();
const query = {
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gt: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  maybeSingle,
};
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: vi.fn(() => query) },
}));
import { servePayload } from "@/lib/script-delivery";

const id = "11111111-1111-4111-8111-111111111111";
const origin = "https://api-luavail.lovable.app";

describe("CDN-style delivery", () => {
  it("uses the same domain and the public CDN loader path", () => {
    expect(loaderUrl(origin, id)).toBe(`${origin}/api/public/cdn/loader/${id}`);
  });
  it("rejects malformed script identifiers with executor-safe status", async () => {
    const response = serveLoader(new Request(`${origin}/api/public/cdn/loader/bad`), "bad");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("--ERR:Script not found");
    expect(response.headers.get("CDN-Cache-Control")).toBe("no-store");
  });
  it("does not display Lua on browser navigation", async () => {
    const response = serveLoader(
      new Request(loaderUrl(origin, id), { headers: { "sec-fetch-mode": "navigate" } }),
      id,
    );
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(await response.text()).toContain(loaderUrl(origin, id));
  });
  it("never bypasses one-time token consumption or caches payload errors", async () => {
    const missing = await servePayload(new Request(`${origin}${CDN_PAYLOAD_PATH}`));
    expect(await missing.text()).toBe("--ERR:Missing token");
    maybeSingle.mockResolvedValueOnce({ data: null });
    const used = await servePayload(new Request(`${origin}${CDN_PAYLOAD_PATH}?token=used`));
    expect(await used.text()).toBe("--ERR:Token expired or already used");
    expect(query.eq).toHaveBeenCalledWith("consumed", false);
    expect(query.eq).toHaveBeenCalledWith("revoked", false);
    expect(used.status).toBe(200);
    expect(used.headers.get("Cache-Control")).toContain("no-store");
  });
  it("executes the twice-obfuscated loader through init, CDN payload and heartbeat", () => {
    const lua = obfuscateLua(buildLoaderLua(id, origin), 2);
    const result = spawnSync("lua", ["-"], {
      input: `local requests=0
warn=function(m) error(m) end
getgenv=function() return {script_key="TEST_KEY",hwid="TEST_HWID"} end
local players={LocalPlayer={GetJoinData=function() error("no teleport") end}}
local http={JSONDecode=function(self,s)
 if s=="INIT" then return {token="once"} end
 if s=="FETCH" then return {payload="coroutine.yield()",heartbeat_token="alive",interval=30} end
 error("unexpected response") end}
game={GetService=function(self,n) if n=="Players" then return players else return http end end,
HttpGet=function(self,url)
 requests=requests+1
 if requests==1 then assert(url=="${origin}/api/public/session/init?s=${id}&k=TEST_KEY&h=TEST_HWID"); return "INIT" end
 if requests==2 then assert(url=="${origin}${CDN_PAYLOAD_PATH}?token=once"); return "FETCH" end
 assert(url=="${origin}/api/public/heartbeat?t=alive"); return "--ERR:Session revoked" end}
task={spawn=function(f) f() end,wait=function(n) assert(n==30) end}
warn=function(m) assert(m=="[Loader] Heartbeat lost; payload terminated") end
${lua}
assert(requests==3)
print("DELIVERY_OK")`,
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("DELIVERY_OK");
  });
});
