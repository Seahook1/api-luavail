// src/routes/api/public/fetch.ts
import { createFileRoute } from '@tanstack/react-router'
import { supabaseAdmin } from '~/lib/supabase-admin' // service‑role client

export const Route = createFileRoute('/api/public/fetch')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          // ── 1. Extract token ──────────────────────────────────────
          const url = new URL(request.url)
          const token = url.searchParams.get('token')
          if (!token) {
            return new Response('--ERR:Missing token', { status: 200 })
          }

          // ── 2. Look up the token ──────────────────────────────────
          const { data: row, error: lookupErr } = await supabaseAdmin
            .from('execution_tokens')
            .select(
              'id, script_id, key_id, hwid, ip, expires_at, consumed',
            )
            .eq('token', token)
            .maybeSingle()

          if (lookupErr || !row) {
            return new Response('--ERR:Token expired or already used', {
              status: 200,
            })
          }

          // ── 3. Validate freshness & consumption ───────────────────
          if (row.consumed || new Date(row.expires_at) < new Date()) {
            return new Response('--ERR:Token expired or already used', {
              status: 200,
            })
          }

          // ── 4. Mark consumed (atomic update) ──────────────────────
          const { error: consumeErr } = await supabaseAdmin
            .from('execution_tokens')
            .update({ consumed: true })
            .eq('id', row.id)
            .eq('consumed', false) // guard against double‑spend

          if (consumeErr) {
            console.error('consume token error:', consumeErr)
            return new Response('--ERR:Failed to consume token', {
              status: 200,
            })
          }

          // ── 5. Fetch the script source ─────────────────────────────
          const { data: script, error: scriptErr } = await supabaseAdmin
            .from('scripts')
            .select('id, source, obfuscated_source, version')
            .eq('id', row.script_id)
            .maybeSingle()

          if (scriptErr || !script) {
            return new Response('--ERR:Script not found', { status: 200 })
          }

          const payload = script.obfuscated_source ?? script.source
          if (!payload) {
            return new Response('--ERR:No payload available', {
              status: 200,
            })
          }

          // ── 6. Increment execution counter ────────────────────────
          await supabaseAdmin.rpc('increment_execution_count', {
            p_script_id: row.script_id,
          }).catch((err) => console.error('counter RPC error:', err))

          // ── 7. Write execution log ────────────────────────────────
          await supabaseAdmin.from('execution_logs').insert({
            script_id: row.script_id,
            key_id: row.key_id,
            hwid: row.hwid,
            ip: row.ip,
            executed_at: new Date().toISOString(),
          }).catch((err) => console.error('log insert error:', err))

          // ── 8. Return Lua payload ─────────────────────────────────
          return new Response(payload, {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        } catch (err) {
          console.error('fetch fatal:', err)
          return new Response('--ERR:Internal server error', { status: 200 })
        }
      },
    },
  },
})