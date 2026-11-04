import { createFileRoute } from '@tanstack/react-router'
import { supabaseAdmin } from '~/lib/supabase-admin'

export const Route = createFileRoute('/api/public/heartbeat')({
  server: { handlers: { GET: async ({ request }) => {
    const t = new URL(request.url).searchParams.get('t')
    if (!t) return new Response('--ERR:Missing token', { status: 200 })

    const { data: row } = await supabaseAdmin
      .from('execution_tokens')
      .select('id, revoked, session_expires_at')
      .eq('heartbeat_token', t).maybeSingle()

    if (!row || row.revoked ||
        (row.session_expires_at && new Date(row.session_expires_at) < new Date())) {
      return new Response('--ERR:Session revoked or expired', { status: 200 })
    }

    await supabaseAdmin.from('execution_tokens')
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq('id', row.id)

    return new Response('OK', { status: 200 })
  }}},
})
