// src/routes/api/public/loader.$scriptId.ts
import { createFileRoute } from '@tanstack/react-router'

const API_BASE = 'https://api-luavail.lovable.app'

export const Route = createFileRoute('/api/public/loader/$scriptId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const scriptId = params.scriptId

        const lua = `
local SCRIPT_ID = "${scriptId}"
local API_BASE  = "${API_BASE}"

local function getParam(name)
    local ok, val = pcall(function()
        return game:GetService("Players").LocalPlayer:GetJoinData().TeleportData[name]
    end)
    if ok and val and val ~= "" then return val end
    local genv = getgenv and getgenv() or {}
    return genv[name] or ""
end

local HWID = getParam("hwid")
if HWID == "" then
    local ok, id = pcall(function()
        return game:GetService("RbxAnalyticsService"):GetClientId()
    end)
    HWID = ok and id or ""
end
local KEY = getParam("key")

-- ── Step 1: init session ──────────────────────────────────────────
local initUrl = string.format(
    "%s/api/public/session/init?s=%s&k=%s&h=%s",
    API_BASE, SCRIPT_ID, KEY, HWID
)

local okInit, tokenOrErr = pcall(function()
    return game:HttpGet(initUrl, true)
end)

if not okInit then
    warn("[Loader] Network error during session init")
    return
end

if tokenOrErr:sub(1, 5) == "--ERR" then
    warn("[Loader] " .. tokenOrErr)
    return
end

local token = tokenOrErr

-- ── Step 2: fetch payload with the one‑time token ────────────────
local fetchUrl = string.format(
    "%s/api/public/fetch?token=%s",
    API_BASE, token
)

local okFetch, payloadOrErr = pcall(function()
    return game:HttpGet(fetchUrl, true)
end)

if not okFetch then
    warn("[Loader] Network error during fetch")
    return
end

if payloadOrErr:sub(1, 5) == "--ERR" then
    warn("[Loader] " .. payloadOrErr)
    return
end

-- ── Step 3: execute the delivered Lua ────────────────────────────
local chunk, loadErr = loadstring(payloadOrErr)
if not chunk then
    warn("[Loader] Failed to compile payload: " .. tostring(loadErr))
    return
end

local okRun, runErr = pcall(chunk)
if not okRun then
    warn("[Loader] Runtime error: " .. tostring(runErr))
end
`

        return new Response(lua, {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      },
    },
  },
})