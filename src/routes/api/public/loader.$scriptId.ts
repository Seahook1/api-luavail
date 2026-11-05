import { createFileRoute } from '@tanstack/react-router'
import { isBrowserNavigation, browserBlockedPage } from '@/lib/browser-page'
import { obfuscateLua } from '@/lib/obfuscate'

const API_BASE = 'https://api-luavail.lovable.app'

export const Route = createFileRoute('/api/public/loader/$scriptId')({
  server: { handlers: { GET: async ({ params, request }) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.scriptId)) {
      return new Response('--ERR:Script not found', { status: 200 })
    }
    if (isBrowserNavigation(request)) {
      return new Response(browserBlockedPage(`${API_BASE}/api/public/loader/${params.scriptId}`), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }
    const lua = `
local SCRIPT_ID = "${params.scriptId}"
local API_BASE  = "${API_BASE}"

local function getParam(n)
  local ok, v = pcall(function()
    return game:GetService("Players").LocalPlayer:GetJoinData().TeleportData[n]
  end)
  if ok and v and v ~= "" then return v end
  local g = getgenv and getgenv() or {}
  return g[n] or ""
end

local HWID = getParam("hwid")
if HWID == "" then
  local ok, id = pcall(function()
    return game:GetService("RbxAnalyticsService"):GetClientId()
  end)
  HWID = ok and id or ""
end
local KEY = getParam("key")
if KEY == "" then KEY = getParam("script_key") end
KEY = tostring(KEY):gsub("[^%w_%-]", "")

-- ── Step 1: init ────────────────────────────────────────────────
local okI, initResp = pcall(function()
  return game:HttpGet(API_BASE .. "/api/public/session/init?s=" .. SCRIPT_ID .. "&k=" .. KEY .. "&h=" .. HWID, true)
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
  return game:HttpGet(API_BASE .. "/api/public/fetch?token=" .. initData.token, true)
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
`

    return new Response(obfuscateLua(lua, 2), {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }}},
})
