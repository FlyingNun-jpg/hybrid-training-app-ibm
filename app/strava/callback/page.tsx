'use client'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// Strava redirects here with ?code=… after the athlete approves access. We hand the
// code (plus the logged-in user's JWT) to /api/strava/exchange, which stores tokens
// server-side, then bounce back to Settings.
function CallbackInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'working'|'done'|'error'>('working')
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const code = searchParams.get('code')
    const denied = searchParams.get('error')
    if (denied || !code) { setStatus('error'); return }
    // OAuth codes are single-use: strip it from the URL immediately so a back-swipe
    // or Safari restoring this page can't replay the exchange and show a bogus error.
    try { window.history.replaceState(null, '', '/strava/callback') } catch { /* noop */ }
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { router.push('/login'); return }
        const res = await fetch('/api/strava/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ code }),
        })
        if (!res.ok) {
          // The exchange fails when the code was already used (page revisited). If a
          // connection exists, this athlete IS connected — treat it as success.
          const check = await fetch('/api/strava/status', { headers: { Authorization: `Bearer ${session.access_token}` } })
          const st = await check.json().catch(() => ({}))
          if (!st.connected) throw new Error('exchange failed')
        }
        setStatus('done')
        setTimeout(() => router.replace('/connections'), 1200)
      } catch { setStatus('error') }
    })()
  }, [searchParams, router])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 }}>
      <div style={{ fontSize: 34 }}>{status === 'done' ? '✓' : status === 'error' ? '✕' : '🔗'}</div>
      <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>
        {status === 'working' ? 'Connecting Strava…' : status === 'done' ? 'Strava connected!' : 'Could not connect Strava'}
      </p>
      {status === 'error' && (
        <button onClick={() => router.push('/connections')}
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Back to settings
        </button>
      )}
    </div>
  )
}

export default function StravaCallbackPage() {
  return <Suspense fallback={null}><CallbackInner /></Suspense>
}
