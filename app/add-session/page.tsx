'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { EXERCISES, byPattern } from '@/lib/exerciseLibrary'
import type { Pattern } from '@/lib/exerciseLibrary'
import { RUN_TYPES, runTypeById, buildRunSession, buildLiftSession, addRecurringSession } from '@/lib/addSession'
import type { LiftPick } from '@/lib/addSession'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function AddSessionPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [plan, setPlan] = useState<any>(null)
  const [startWeekIndex, setStartWeekIndex] = useState(0)
  const [totalWeeks, setTotalWeeks] = useState(0)

  const [mode, setMode] = useState<'run' | 'lift'>('run')
  const [runType, setRunType] = useState('easy')
  const [km, setKm] = useState(8)
  const today = new Date().toLocaleDateString('en', { weekday: 'short' })
  const [weekday, setWeekday] = useState(WEEKDAYS.includes(today) ? today : 'Mon')
  const [recur, setRecur] = useState(1)
  const [progress, setProgress] = useState(false)
  const [liftTitle, setLiftTitle] = useState('Strength')
  const [picks, setPicks] = useState<LiftPick[]>([])
  const [picker, setPicker] = useState<Pattern | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase.from('training_plans').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).single().then(({ data }) => {
      if (!data) return
      setPlan(data)
      const weeks = data.plan_data?.weeks ?? []
      setTotalWeeks(weeks.length)
      const sm = data.plan_data?.startMonday
      if (sm) {
        const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const now = new Date(); const dow = now.getDay()
        const monday = new Date(now); monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1))
        const delta = Math.round((Date.parse(iso(monday)) - Date.parse(sm)) / (7 * 86400000))
        setStartWeekIndex(Math.max(0, Math.min(delta, weeks.length - 1)))
      }
    })
  }, [user])

  // keep the distance in step with the chosen run type's default
  useEffect(() => { setKm(runTypeById(runType).defaultKm) }, [runType])

  const addPick = (name: string) => {
    const ex = EXERCISES.find(e => e.name === name)
    if (!ex || picks.some(p => p.name === name)) { setPicker(null); return }
    setPicks(prev => [...prev, { name, sets: ex.defaultSets, reps: ex.defaultReps }])
    setPicker(null)
  }
  const updatePick = (i: number, field: 'sets' | 'reps', val: string) =>
    setPicks(prev => prev.map((p, j) => j === i ? { ...p, [field]: field === 'sets' ? Math.max(1, Math.min(10, parseInt(val) || 1)) : val } : p))
  const removePick = (i: number) => setPicks(prev => prev.filter((_, j) => j !== i))

  const recurOptions = (() => {
    const remaining = Math.max(1, totalWeeks - startWeekIndex)
    return [
      { n: 1, label: 'Just this week' },
      { n: Math.min(4, remaining), label: 'Next 4 weeks' },
      { n: Math.min(8, remaining), label: 'Next 8 weeks' },
      { n: remaining, label: 'Rest of plan' },
    ].filter((o, i, a) => o.n > 0 && a.findIndex(x => x.n === o.n) === i)
  })()

  const canSave = mode === 'run' ? km > 0 : picks.length > 0

  const save = async () => {
    if (!user || !plan || !canSave) return
    setBusy(true)
    const weeks = plan.plan_data?.weeks ?? []
    const newWeeks = addRecurringSession(weeks, {
      weekday, startWeekIndex, recurWeeks: recur, progress,
      build: (off) => mode === 'run'
        ? buildRunSession(runType, km, off, progress)
        : buildLiftSession(liftTitle, picks, off, progress),
    })
    await supabase.from('training_plans').update({ plan_data: { ...plan.plan_data, weeks: newWeeks } }).eq('id', plan.id)
    router.push('/dashboard')
  }

  const card: React.CSSProperties = { background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14, padding: '14px 16px', marginBottom: 12 }
  const seg = (active: boolean): React.CSSProperties => ({ flex: 1, padding: '10px', borderRadius: 10, textAlign: 'center', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `${active ? '1.5px' : '0.5px'} solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--bg)' : 'transparent', color: active ? 'var(--text)' : 'var(--text-muted)' })

  if (!plan) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading your plan…</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 40 }}>
      <nav style={{ background: 'var(--bg-nav)', borderBottom: '0.5px solid var(--border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => router.push('/dashboard')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>←</button>
        <span style={{ color: 'var(--text)', fontWeight: 500 }}>Add a session</span>
      </nav>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '18px 16px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <div onClick={() => setMode('run')} style={seg(mode === 'run')}>🏃 Run</div>
          <div onClick={() => setMode('lift')} style={seg(mode === 'lift')}>🏋️ Lift</div>
        </div>

        {mode === 'run' ? (
          <>
            <div style={card}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Run type</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {RUN_TYPES.map(t => (
                  <div key={t.id} onClick={() => setRunType(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', border: `${runType === t.id ? '1.5px' : '0.5px'} solid ${runType === t.id ? 'var(--accent)' : 'var(--border)'}`, background: runType === t.id ? 'var(--bg)' : 'transparent' }}>
                    <span>{t.emoji}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{t.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Distance</label>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>{km} km</span>
              </div>
              <input type="range" min={1} max={45} step={0.5} value={km} onChange={e => setKm(parseFloat(e.target.value))} style={{ width: '100%', marginTop: 10, accentColor: 'var(--accent)' }} />
            </div>
          </>
        ) : (
          <>
            <div style={card}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Session name</label>
              <input value={liftTitle} onChange={e => setLiftTitle(e.target.value)} placeholder="e.g. Push, Legs" style={{ width: '100%', marginTop: 8, background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 14, color: 'var(--text)' }} />
            </div>
            <div style={card}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Exercises</label>
              {picks.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <input value={p.sets} onChange={e => updatePick(i, 'sets', e.target.value)} inputMode="numeric" style={{ width: 30, textAlign: 'center', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '4px 2px', fontSize: 12, color: 'var(--text)' }} />
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>×</span>
                  <input value={p.reps} onChange={e => updatePick(i, 'reps', e.target.value)} style={{ width: 44, textAlign: 'center', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '4px 2px', fontSize: 12, color: 'var(--text)' }} />
                  <button onClick={() => removePick(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 15 }}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {(['push', 'pull', 'legs', 'core'] as Pattern[]).map(pat => (
                  <button key={pat} onClick={() => setPicker(pat)} style={{ background: 'var(--bg)', border: '0.5px dashed var(--border)', borderRadius: 8, padding: '7px 11px', fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer', textTransform: 'capitalize' }}>+ {pat}</button>
                ))}
              </div>
            </div>
          </>
        )}

        <div style={card}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Day</label>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 10 }}>
            {WEEKDAYS.map(d => (
              <button key={d} onClick={() => setWeekday(d)} style={{ padding: '7px 11px', borderRadius: 8, border: `0.5px solid ${weekday === d ? 'var(--accent)' : 'var(--border)'}`, fontSize: 12, fontWeight: 500, cursor: 'pointer', background: weekday === d ? 'var(--accent)' : 'var(--bg-card)', color: weekday === d ? 'var(--accent-fg)' : 'var(--text-muted)' }}>{d}</button>
            ))}
          </div>
        </div>

        <div style={card}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Repeat</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {recurOptions.map(o => (
              <div key={o.label} onClick={() => setRecur(o.n)} style={{ padding: '10px 12px', borderRadius: 10, cursor: 'pointer', border: `${recur === o.n ? '1.5px' : '0.5px'} solid ${recur === o.n ? 'var(--accent)' : 'var(--border)'}`, background: recur === o.n ? 'var(--bg)' : 'transparent', fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{o.label}{o.n > 1 ? ` · ${o.n}×` : ''}</div>
            ))}
          </div>
          {recur > 1 && runTypeById(runType).progressable !== 'none' && mode === 'run' && (
            <div onClick={() => setProgress(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, cursor: 'pointer' }}>
              <div style={{ width: 38, height: 22, borderRadius: 11, background: progress ? 'var(--accent)' : 'var(--border)', position: 'relative', transition: 'background 0.15s' }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: progress ? 18 : 2, transition: 'left 0.15s' }} />
              </div>
              <span style={{ fontSize: 13, color: 'var(--text)' }}>Progress each week ({runTypeById(runType).progressable === 'distance' ? 'build distance' : 'build pace'})</span>
            </div>
          )}
          {recur > 1 && mode === 'lift' && (
            <div onClick={() => setProgress(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, cursor: 'pointer' }}>
              <div style={{ width: 38, height: 22, borderRadius: 11, background: progress ? 'var(--accent)' : 'var(--border)', position: 'relative', transition: 'background 0.15s' }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: progress ? 18 : 2, transition: 'left 0.15s' }} />
              </div>
              <span style={{ fontSize: 13, color: 'var(--text)' }}>Add load each week (progressive overload)</span>
            </div>
          )}
        </div>

        <button onClick={save} disabled={!canSave || busy}
          style={{ width: '100%', background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 600, cursor: !canSave || busy ? 'not-allowed' : 'pointer', opacity: !canSave || busy ? 0.6 : 1 }}>
          {busy ? 'Adding…' : `Add to ${recur > 1 ? `${recur} weeks` : 'this week'}`}
        </button>
      </div>

      {picker && (
        <div onClick={() => setPicker(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderTopLeftRadius: 20, borderTopRightRadius: 20, width: '100%', maxWidth: 480, maxHeight: '70vh', overflowY: 'auto', padding: '18px 16px 28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', textTransform: 'capitalize' }}>Add {picker}</span>
              <button onClick={() => setPicker(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            {byPattern([picker]).map(ex => (
              <div key={ex.name} onClick={() => addPick(ex.name)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 10, cursor: 'pointer', marginBottom: 4, border: '0.5px solid var(--border)', background: 'var(--bg-card)' }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{ex.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{ex.defaultSets}×{ex.defaultReps}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
