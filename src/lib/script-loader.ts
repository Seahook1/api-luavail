import { obfuscateLua } from "@/lib/obfuscate";
import { isBrowserNavigation, browserBlockedPage } from "@/lib/browser-page";
import { CDN_PAYLOAD_PATH, DELIVERY_HEADERS, loaderUrl } from "@/lib/delivery-links";

export function buildLoaderLua(scriptId: string, apiBase: string) {
  const lua = `
local SCRIPT_ID = "${scriptId}"
local API_BASE  = "${apiBase}"

local function getParam(n)
  local ok, v = pcall(function()
    return game:GetService("Players").LocalPlayer:GetJoinData().TeleportData[n]
  end)
  if ok and v and v ~= "" then return v end
  local g = getgenv and getgenv() or {}
  return g[n] or ""
end

local HWID = tostring(getParam("hwid")):gsub("[^%w_%-]", "")
if HWID == "" then
  local ok, id = pcall(function()
    return game:GetService("RbxAnalyticsService"):GetClientId()
  end)
  HWID = ok and id or ""
end
local KEY = getParam("key")
if KEY == "" then KEY = getParam("script_key") end
KEY = tostring(KEY):gsub("[^%w_%-]", "")

local function getExecutor()
  local candidates = {}
  if type(identifyexecutor) == "function" then
    local ok, name = pcall(identifyexecutor)
    if ok and name then table.insert(candidates, name) end
  end
  if type(getexecutorname) == "function" then
    local ok, name = pcall(getexecutorname)
    if ok and name then table.insert(candidates, name) end
  end

  local env = (type(getgenv) == "function" and getgenv()) or _G or {}
  for _, key in ipairs({"executor", "Executor", "EXECUTOR", "executor_name", "ExecutorName"}) do
    local value = env[key]
    if value ~= nil then table.insert(candidates, value) end
  end

  for _, value in ipairs(candidates) do
    if type(value) == "string" and value ~= "" then
      return value:sub(1, 40)
    elseif type(value) == "table" and type(value.Name) == "string" then
      return value.Name:sub(1, 40)
    end
  end
  return "Unknown"
end

local EXECUTOR = getExecutor()
local Players = game:GetService("Players")
local LOCAL_PLAYER = Players.LocalPlayer
local ROBLOX_USERNAME = LOCAL_PLAYER and tostring(LOCAL_PLAYER.Name) or ""
local ROBLOX_DISPLAY_NAME = LOCAL_PLAYER and tostring(LOCAL_PLAYER.DisplayName) or ""
local HttpService = game:GetService("HttpService")

-- ── Step 1: init ────────────────────────────────────────────────
local okI, initResp = pcall(function()
  return game:HttpGet(API_BASE .. "/api/public/session/init?s=" .. SCRIPT_ID .. "&k=" .. KEY .. "&h=" .. HWID .. "&e=" .. HttpService:UrlEncode(EXECUTOR) .. "&u=" .. HttpService:UrlEncode(ROBLOX_USERNAME) .. "&d=" .. HttpService:UrlEncode(ROBLOX_DISPLAY_NAME), true)
end)
if not okI or type(initResp) ~= "string" then warn("[Loader] init network error"); return end
if initResp:sub(1,5) == "--ERR" then warn("[Loader] " .. initResp); return end

local okD, initData = pcall(function()
  return game:GetService("HttpService"):JSONDecode(initResp)
end)
if not okD or type(initData) ~= "table" or not initData.token then
  warn("[Loader] init response malformed"); return
end

-- ── Step 2: fetch ────────────────────────────────────────────────
local okF, fetchResp = pcall(function()
  return game:HttpGet(API_BASE .. "${CDN_PAYLOAD_PATH}?token=" .. initData.token, true)
end)
if not okF or type(fetchResp) ~= "string" then warn("[Loader] fetch network error"); return end
if fetchResp:sub(1,5) == "--ERR" then warn("[Loader] " .. fetchResp); return end

local okD2, fetchData = pcall(function()
  return game:GetService("HttpService"):JSONDecode(fetchResp)
end)
if not okD2 or type(fetchData) ~= "table" or not fetchData.payload then
  warn("[Loader] fetch response malformed"); return
end

-- ── Step 3: run payload in a coroutine ──────────────────────────
local fn, cerr = loadstring(fetchData.payload)
if not fn then warn("[Loader] compile error: " .. tostring(cerr)); return end

local co = coroutine.create(fn)
local okRun, runErr = coroutine.resume(co)
if not okRun then warn("[Loader] runtime: " .. tostring(runErr)); return end

-- ── Step 4: heartbeat kill-switch ───────────────────────────────
task.spawn(function()
  local hbUrl   = API_BASE .. "/api/public/heartbeat?t=" .. fetchData.heartbeat_token
  local interval = tonumber(fetchData.interval) or 30
  while coroutine.status(co) ~= "dead" do
    task.wait(interval)
    local okH, hbResp = pcall(function() return game:HttpGet(hbUrl, true) end)
    if not okH or type(hbResp) ~= "string" or hbResp:sub(1,5) == "--ERR" then
      -- install a per-instruction error hook → payload dies on next opcode
      pcall(function()
        debug.sethook(co, function() error("__HEARTBEAT_LOST__") end, "", 1)
      end)
      warn("[Loader] Heartbeat lost; payload terminated")
      return
    end
  end
end)
`;

  return lua;
}

export function serveLoader(request: Request, scriptId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scriptId)) {
    return new Response("--ERR:Script not found", { status: 200, headers: DELIVERY_HEADERS });
  }
  const url = new URL(request.url);
  const origin = url.origin;
  if (isBrowserNavigation(request)) return browserBlockedPage(loaderUrl(origin, scriptId));

  // Add four same-origin redirect hops before serving the loader.
  const rawHop = url.searchParams.get("hop");
  const hop = rawHop === null ? 4 : Number.parseInt(rawHop, 10);
  if (!Number.isInteger(hop) || hop < 0 || hop > 4) {
    return new Response("--ERR:Invalid loader link", { status: 200, headers: DELIVERY_HEADERS });
  }
  if (hop > 0) {
    const next = new URL(url);
    next.searchParams.set("hop", String(hop - 1));
    return new Response(null, {
      status: 302,
      headers: { ...DELIVERY_HEADERS, Location: next.toString() },
    });
  }

  // Obfuscate the delivered bootstrap with one compatibility-focused wrapper.
  // Avoid VM, control-flow flattening, and anti-tamper layers in the loader path.
  const protectedLoader = obfuscateLua(buildLoaderLua(scriptId, origin), {
    passes: 1,
    mode: "wrap",
    antiTamper: true,
    flatten: false,
    vm: false,
  });

  return new Response(protectedLoader, {
    status: 200,
    headers: { ...DELIVERY_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}
