// src/routes/api/public/session/init.ts
import { createFileRoute } from '@tanstack/react-router'
import { getRequestIP } from '@tanstack/react-start/server'
import { randomBytes } from 'node:crypto'
import { supabaseAdmin } from '~/lib/supabase-admin' // your service‑role client

// In‑memory rate‑limit store (replace with Redis in production)
const RATE_WINDOW_MS = 30_000
const MAX_INIT_PER_WINDOW = 5
const rateBuckets = new Map<string, { count: number; windowStart: number }>()

function isRateLimited(key: string): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    rateBuckets.set(key, { count: 1, windowStart: now })
    return false
  }
  if (bucket.count >= MAX_INIT_PER_WINDOW) return true
  bucket.count += 1
  return false
}

async function handleInit(request: Request): Promise<Response> {
  try {
    // ── 1. Parse parameters (GET or POST) ────────────────────────────
    let scriptId: string | null = null
    let licenseKey: string | null = null
    let hwid: string | null = null

    if (request.method === 'GET') {
      const url = new URL(request.url)
      scriptId = url.searchParams.get('s')
      licenseKey = url.searchParams.get('k')          // optional
      hwid = url.searchParams.get('h')
    } else {
      const body = await request.json().catch(() => ({}))
      scriptId = body.script_id ?? body.s ?? null
      licenseKey = body.key ?? body.k ?? null
      hwid = body.hwid ?? body.h ?? null
    }

    if (!scriptId || !hwid) {
      return new Response('--ERR:Missing script_id or hwid', { status: 200 })
    }

    // ── 2. Rate limiting ────────────────────────────────────────────
    const ip = getRequestIP({ xForwardedFor: true }) ?? 'unknown' // [reference:5]
    const rateKey = `${ip}:${hwid}`
    if (isRateLimited(rateKey)) {
      return new Response('--ERR:Rate limit exceeded (max 5 per 30s)', { status: 200 })
    }

    // ── 3. Validate script ──────────────────────────────────────────
    const { data: script, error: scriptErr } = await supabaseAdmin
      .from('scripts')
      .select('id, enabled, moderation_disabled, keyless')
      .eq('id', scriptId)
      .maybeSingle()

    if (scriptErr || !script) {
      return new Response('--ERR:Script not found', { status: 200 })
    }
    if (!script.enabled || script.moderation_disabled) {
      return new Response('--ERR:Script is disabled or moderated', { status: 200 })
    }

    // ── 4. Validate license key (unless keyless) ────────────────────
    let keyId: string | null = null

    if (!script.keyless) {
      if (!licenseKey) {
        return new Response('--ERR:Missing license key', { status: 200 })
      }

      const { data: keyRow, error: keyErr } = await supabaseAdmin
        .from('license_keys')
        .select('id, banned, expires_at, hwid')
        .eq('script_id', scriptId)
        .eq('key', licenseKey)
        .maybeSingle()

      if (keyErr || !keyRow) {
        return new Response('--ERR:Invalid license key', { status: 200 })
      }
      if (keyRow.banned) {
        return new Response('--ERR:License key is banned', { status: 200 })
      }
      if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
        return new Response('--ERR:License key has expired', { status: 200 })
      }

      // HWID binding
      if (!keyRow.hwid) {
        // First run → bind HWID
        const { error: bindErr } = await supabaseAdmin
          .from('license_keys')
          .update({ hwid })
          .eq('id', keyRow.id)
        if (bindErr) {
          return new Response('--ERR:Failed to bind HWID', { status: 200 })
        }
      } else if (keyRow.hwid !== hwid) {
        return new Response('--ERR:HWID mismatch', { status: 200 })
      }

      keyId = keyRow.id
    }

    // ── 5. Generate a 64‑character cryptographically secure token ──
    const token = randomBytes(32).toString('hex') // 64 hex chars [reference:6]

    // ── 6. Insert the ephemeral token (30‑second TTL) ──────────────
    const { error: insertErr } = await supabaseAdmin
      .from('execution_tokens')
      .insert({
        token,
        script_id: scriptId,
        key_id: keyId,
        hwid,
        ip,
        expires_at: new Date(Date.now() + 30_000).toISOString(),
        consumed: false,
      })

    if (insertErr) {
      console.error('execution_tokens insert error:', insertErr)
      return new Response('--ERR:Internal error creating token', { status: 200 })
    }

    // ── 7. Return the token (plain text) ────────────────────────────
    return new Response(token, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  } catch (err) {
    console.error('session/init fatal:', err)
    return new Response('--ERR:Internal server error', { status: 200 })
  }
}

export const Route = createFileRoute('/api/public/session/init')({
  server: {
    handlers: {
      GET: async ({ request }) => handleInit(request),
      POST: async ({ request }) => handleInit(request),
    },
  },
})