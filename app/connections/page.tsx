'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// Connections — external services & notifications, moved out of Settings so the
// theme picker and integrations don't crowd one page.
export default function ConnectionsPage() {
  const router = useRouter()

  // ── Strava ──
  const [strava, setStrava] = useState<{ loading: boolean; connected: boolean; athleteName: string | null }>({ loading: true, connected: false, athleteName: null })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { router.push('/login'); return }
        const res = await fetch('/api/strava/status', { headers: { Authorization: `Bearer ${session.access_token}` } })
        const data = await res.json()
        setStrava({ loading: false, connected: !!data.connected, athleteName: data.athleteName ?? null })
      } catch { setStrava(s => ({ ...s, loading: false })) }
    })()
  }, [router])

  const connectStrava = () => {
    const clientId = process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID
    if (!clientId) { alert('Strava is not configured yet (missing client ID).'); return }
    const redirect = `${window.location.origin}/strava/callback`
    window.location.href = `https://www.strava.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&approval_prompt=auto&scope=activity:write,activity:read,read`
  }

  const disconnectStrava = async () => {
    if (!window.confirm('Disconnect Strava? New workouts will no longer be posted to your feed.')) return
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) await fetch('/api/strava/disconnect', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } })
      setStrava({ loading: false, connected: false, athleteName: null })
    } finally { setBusy(false) }
  }

  // ── Daily reminder (web push) ──
  const [push, setPush] = useState<{ supported: boolean; enabled: boolean; busy: boolean }>({ supported: false, enabled: false, busy: false })

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    setPush(p => ({ ...p, supported: true }))
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => {
      setPush(p => ({ ...p, enabled: !!sub }))
    }).catch(() => {})
  }, [])

  const urlBase64ToUint8Array = (base64: string) => {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw = window.atob(b64)
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
  }

  const togglePush = async () => {
    const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapid) { alert('Reminders are not configured yet (missing VAPID key).'); return }
    setPush(p => ({ ...p, busy: true }))
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      if (push.enabled && existing) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        })
        await existing.unsubscribe()
        setPush(p => ({ ...p, enabled: false }))
      } else {
        const perm = await Notification.requestPermission()
        if (perm !== 'granted') return
        const sub = existing ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapid) })
        const json = sub.toJSON()
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ endpoint: sub.endpoint, keys: json.keys }),
        })
        setPush(p => ({ ...p, enabled: true }))
      }
    } catch { /* leave state as-is */ } finally {
      setPush(p => ({ ...p, busy: false }))
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 40 }}>
      <nav style={{ background: 'var(--bg-nav)', borderBottom: '0.5px solid var(--border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => router.push('/dashboard')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>←</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'var(--accent-fg)', fontSize: 9, fontWeight: 500 }}>MB</span>
          </div>
          <span style={{ color: 'var(--text)', fontWeight: 500 }}>Connections</span>
        </div>
      </nav>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 16px' }}>
        <h2 style={{ color: 'var(--text)', fontWeight: 500, fontSize: 18, marginBottom: 6 }}>Services</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14 }}>Completed workouts post to your Strava feed automatically.</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 14, border: '0.5px solid var(--border)', background: 'var(--bg-card)', marginBottom: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#fc4c02', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>S</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Strava</div>
            <div style={{ fontSize: 11, color: strava.connected ? 'var(--hyrox)' : 'var(--text-muted)', marginTop: 1 }}>
              {strava.loading ? 'Checking…' : strava.connected ? `Connected${strava.athleteName ? ` · ${strava.athleteName}` : ''}` : 'Not connected'}
            </div>
          </div>
          {!strava.loading && (
            strava.connected ? (
              <button onClick={disconnectStrava} disabled={busy}
                style={{ background: 'transparent', color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                Disconnect
              </button>
            ) : (
              <button onClick={connectStrava}
                style={{ background: '#fc4c02', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Connect
              </button>
            )
          )}
        </div>

        <h2 style={{ color: 'var(--text)', fontWeight: 500, fontSize: 18, marginBottom: 6, marginTop: 28 }}>Notifications</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14 }}>
          {push.supported ? 'A morning nudge with today’s session.' : 'Add IBM Fitness to your Home Screen to enable reminders.'}
        </p>
        {push.supported && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 14, border: '0.5px solid var(--border)', background: 'var(--bg-card)' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg)', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>🔔</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Daily reminder</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Sent each morning on training days</div>
            </div>
            <button onClick={togglePush} disabled={push.busy}
              style={{ background: push.enabled ? 'var(--accent)' : 'transparent', color: push.enabled ? 'var(--accent-fg)' : 'var(--text-muted)', border: push.enabled ? 'none' : '0.5px solid var(--border)', borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: push.busy ? 0.6 : 1 }}>
              {push.busy ? '…' : push.enabled ? 'On' : 'Off'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
