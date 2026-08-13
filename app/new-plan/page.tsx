'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'

export default function NewPlanPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleReset = async () => {
    if (!user) return
    setLoading(true)
    await supabase.from('training_plans').delete().eq('user_id', user.id)
    router.push('/onboarding')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ maxWidth: 420, width: '100%' }}>
        <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: '28px 24px 20px', textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 22 }}>
              ⚡
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>Start a new plan?</h2>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              This will delete your current training plan. You'll go through onboarding again to generate a fresh one.
            </p>
          </div>
          <div style={{ padding: '16px 24px' }}>
            <div style={{ background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
              <p style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.6 }}>
                Your logged workouts and coach comments will also be removed. This cannot be undone.
              </p>
            </div>
            <button onClick={handleReset} disabled={loading}
              style={{ width: '100%', background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 10, padding: '13px', fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 10, opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Deleting plan...' : 'Build my plan →'}
            </button>
            <button onClick={() => router.push('/import')} disabled={loading}
              style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--accent)', borderRadius: 10, padding: '13px', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 10 }}>
              📥 Import my own plan (file)
            </button>
            <button onClick={() => router.push('/blank-plan')} disabled={loading}
              style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--accent)', borderRadius: 10, padding: '13px', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 10 }}>
              🗒️ Start a blank plan (build it yourself)
            </button>
            <button onClick={() => router.push('/dashboard')}
              style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '13px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
