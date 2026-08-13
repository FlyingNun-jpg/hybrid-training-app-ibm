'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function BlankPlanPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [planName, setPlanName] = useState('My Plan')
  const [weeks, setWeeks] = useState(8)
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!user) return
    setBusy(true)
    // Empty shell: every day a rest day the athlete fills via "Add a run or lift".
    const planWeeks = Array.from({ length: weeks }, (_, i) => ({
      weekNumber: i + 1,
      focus: 'Build it yourself',
      sessions: DAYS.map(d => ({ day: d, type: 'rest', title: 'Rest', details: 'Open “Add a run or lift” to fill this day.', duration: 0, distance: 0 })),
    }))
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const dow = now.getDay()
    const thisMonday = new Date(now); thisMonday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1))
    const startMonday = iso(thisMonday)
    const activeFrom = iso(now)

    await supabase.from('profiles').upsert({ id: user.id, goal_race: null, goal_race_date: null })
    await supabase.from('training_plans').delete().eq('user_id', user.id)
    await supabase.from('training_plans').insert({
      user_id: user.id, plan_name: planName, plan_type: 'custom', start_date: activeFrom, end_date: null,
      plan_data: { planName, weeks: planWeeks, startMonday, activeFrom, timeGoal: '', builder: 'blank' },
    })
    router.push('/dashboard')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ maxWidth: 420, width: '100%' }}>
        <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '28px 24px' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 22 }}>🗒️</div>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', textAlign: 'center', marginBottom: 6 }}>Start a blank plan</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6, marginBottom: 20 }}>
            An empty block you fill yourself — add runs and lifts day by day with &ldquo;Add a run or lift.&rdquo; No AI involved.
          </p>

          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Plan name</label>
          <input value={planName} onChange={e => setPlanName(e.target.value)} style={{ width: '100%', margin: '8px 0 16px', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: 14, color: 'var(--text)' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Length</label>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{weeks} weeks</span>
          </div>
          <input type="range" min={2} max={20} value={weeks} onChange={e => setWeeks(parseInt(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)', marginBottom: 20 }} />

          <button onClick={create} disabled={busy}
            style={{ width: '100%', background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1, marginBottom: 10 }}>
            {busy ? 'Creating…' : 'Create blank plan'}
          </button>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center', marginBottom: 12 }}>This replaces your current plan and clears its logged workouts.</p>
          <button onClick={() => router.push('/new-plan')}
            style={{ width: '100%', background: 'transparent', color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
            Back
          </button>
        </div>
      </div>
    </div>
  )
}
