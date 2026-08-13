'use client'
import { useState } from 'react'
import { SPLITS, byName, byPattern, defaultDays, WEEKDAYS } from '@/lib/exerciseLibrary'
import type { SplitId, Pattern } from '@/lib/exerciseLibrary'
import type { StrengthTemplate, TemplateDay, TemplateExercise, BuilderConfig, Progression } from '@/lib/strengthBuilder'

const ROLE_LABEL: Record<string, string> = { push: 'Push', pull: 'Pull', legs: 'Legs', upper: 'Upper', lower: 'Lower', full: 'Full Body' }

function seedExercises(names: string[]): TemplateExercise[] {
  return names.map(n => {
    const e = byName(n)
    return { name: n, sets: e?.defaultSets ?? 3, reps: e?.defaultReps ?? '8-10' }
  })
}

interface Props {
  onComplete: (template: StrengthTemplate, cfg: BuilderConfig) => void | Promise<void>
  onCancel: () => void
  ctaLabel?: string
  showLength?: boolean   // hide block-length when an AI plan already sets the duration
  showName?: boolean
  prefDays?: string[]    // seed the split's weekdays from the athlete's pinned lift days
  prefCount?: number     // force the number of lift days to the athlete's chosen lift count
}

const ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Reusable split builder. Captures a recurring strength template + progression config
// and hands it back via onComplete — the caller decides whether to save it as a plan
// or feed it to the AI running generator.
export default function StrengthBuilder({ onComplete, onCancel, ctaLabel = 'Save & view my plan', showLength = true, showName = true, prefDays, prefCount }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [splitId, setSplitId] = useState<SplitId | null>(null)
  const [days, setDays] = useState<TemplateDay[]>([])
  const [planName, setPlanName] = useState('My Strength Plan')
  const [weeks, setWeeks] = useState(8)
  const [progression, setProgression] = useState<Progression>('linear')
  const [deload, setDeload] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [picker, setPicker] = useState<{ dayIdx: number; exIdx: number | null } | null>(null)

  const chooseSplit = (id: SplitId, freq: number) => {
    const useFreq = prefCount && prefCount > 0 ? prefCount : freq
    const cycle = SPLITS[id].days
    // Seed weekdays from the athlete's pinned lift days when available, so the builder
    // matches what they already selected in onboarding.
    const wk = (prefDays && prefDays.length >= useFreq)
      ? [...prefDays].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).slice(0, useFreq)
      : defaultDays(useFreq)
    setSplitId(id)
    setDays(wk.map((day, i) => {
      const c = cycle[i % cycle.length]
      return { day, label: c.label, role: c.role, exercises: seedExercises(c.seed) }
    }))
    setStep(2)
  }

  const patternsForDay = (i: number): Pattern[] => {
    const role = days[i].role
    return SPLITS[splitId!].days.find(d => d.role === role)?.patterns ?? ['push', 'pull', 'legs', 'core']
  }

  const updateDays = (fn: (d: TemplateDay[]) => TemplateDay[]) => setDays(prev => fn(prev.map(d => ({ ...d, exercises: [...d.exercises] }))))
  const removeExercise = (di: number, ei: number) => updateDays(d => { d[di].exercises.splice(ei, 1); return d })
  const moveExercise = (di: number, ei: number, dir: -1 | 1) => updateDays(d => {
    const arr = d[di].exercises; const j = ei + dir
    if (j < 0 || j >= arr.length) return d
    ;[arr[ei], arr[j]] = [arr[j], arr[ei]]; return d
  })
  const setFieldVal = (di: number, ei: number, field: 'sets' | 'reps', val: string) => updateDays(d => {
    d[di].exercises[ei] = { ...d[di].exercises[ei], [field]: field === 'sets' ? Math.max(1, Math.min(10, parseInt(val) || 1)) : val }
    return d
  })

  const pickExercise = (name: string) => {
    if (!picker) return
    const { dayIdx, exIdx } = picker
    const role = days[dayIdx].role
    const sameRole = days.filter(d => d.role === role).length
    const ex = byName(name)
    const fresh: TemplateExercise = { name, sets: ex?.defaultSets ?? 3, reps: ex?.defaultReps ?? '8-10' }
    if (exIdx === null) {
      let applyAll = false
      if (sameRole > 1) applyAll = window.confirm(`Add ${name} to all ${ROLE_LABEL[role]} days?`)
      updateDays(d => { d.forEach((day, i) => { if (i === dayIdx || (applyAll && day.role === role)) { if (!day.exercises.some(e => e.name === name)) day.exercises.push({ ...fresh }) } }); return d })
    } else {
      const oldName = days[dayIdx].exercises[exIdx].name
      let applyAll = false
      if (sameRole > 1) applyAll = window.confirm(`Replace ${oldName} with ${name} on all ${ROLE_LABEL[role]} days?`)
      updateDays(d => {
        if (applyAll) d.forEach(day => { if (day.role === role) day.exercises = day.exercises.map(e => e.name === oldName ? { ...fresh } : e) })
        else d[dayIdx].exercises[exIdx] = { ...fresh }
        return d
      })
    }
    setPicker(null)
  }

  const changeWeekday = (di: number, nd: string) => updateDays(d => { d[di] = { ...d[di], day: nd }; return d })
  const usedDays = new Set(days.map(d => d.day))

  const submit = async () => {
    if (!splitId) return
    setSubmitting(true)
    await onComplete({ splitId, days }, { planName, weeks, progression, deload })
    setSubmitting(false)
  }

  const card: React.CSSProperties = { background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16 }
  const roleTint: Record<string, string> = { push: 'var(--run)', pull: 'var(--lift)', legs: 'var(--hyrox)', upper: 'var(--lift)', lower: 'var(--hyrox)', full: 'var(--accent)' }

  return (
    <div style={{ position: 'relative' }}>
      <style>{`
        @keyframes mbFade { from { opacity: 0; transform: translateY(7px) } to { opacity: 1; transform: none } }
        @keyframes mbSheet { from { transform: translateY(100%) } to { transform: none } }
        @keyframes mbScrim { from { opacity: 0 } to { opacity: 1 } }
        .mb-row { animation: mbFade .22s ease both }
        .mb-card { animation: mbFade .28s ease both }
        .mb-tap { transition: transform .08s ease, background .15s ease, border-color .15s ease }
        .mb-tap:active { transform: scale(.96) }
        .mb-sheet { animation: mbSheet .3s cubic-bezier(.22,1,.36,1) both }
        .mb-scrim { animation: mbScrim .2s ease both }
        .mb-day { transition: transform .12s ease, box-shadow .15s ease }
        .mb-day:active { transform: scale(.97) }
      `}</style>
      <nav style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <button onClick={() => (step === 1 ? onCancel() : setStep((step - 1) as 1 | 2))}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>←</button>
        <span style={{ color: 'var(--text)', fontWeight: 500 }}>Build your strength</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-faint)' }}>Step {step}/3</span>
      </nav>

      {/* STEP 1 */}
      {step === 1 && (
        <div className="mb-animate">
          <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.3px' }}>Pick a split</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>Choose a structure, then make it yours. You can swap, add and reorder every lift next.</p>
          {(Object.keys(SPLITS) as SplitId[]).map(id => {
            const s = SPLITS[id]
            // When the lift count is fixed from onboarding, offer a single button at that count.
            const freqs = prefCount && prefCount > 0 ? [prefCount] : id === 'ppl' ? [3, 6] : id === 'upper_lower' ? [2, 4] : [3]
            return (
              <div key={id} style={{ ...card, padding: '16px', marginBottom: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.4 }}>{s.desc}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {freqs.map(f => (
                    <button key={f} onClick={() => chooseSplit(id, f)}
                      style={{ background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{prefCount ? `Use this · ${f} days →` : `${f}× / week →`}</button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && splitId && (
        <div className="mb-animate">
          <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.3px' }}>Build your week</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>Tap ✎ to swap a lift, + to add one. Swaps and adds can apply to every day of the same type.</p>

          {/* Week overview — lift days coloured by type, free days shown as Rest. Tap a Rest
              day to scroll to a training day (gentle nudge that the day is a rest day). */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 18 }}>
            {ORDER.map(wd => {
              const d = days.find(x => x.day === wd)
              const tint = d ? (roleTint[d.role] ?? 'var(--accent)') : null
              return (
                <div key={wd} className="mb-day" title={d ? d.label : 'Rest day'}
                  style={{ borderRadius: 10, padding: '8px 2px', textAlign: 'center', border: `0.5px solid ${d ? tint! : 'var(--border)'}`, background: d ? `color-mix(in srgb, ${tint} 14%, transparent)` : 'transparent' }}>
                  <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px', color: 'var(--text-faint)' }}>{wd}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, marginTop: 3, color: d ? tint! : 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d ? d.label.split(' ')[0] : 'Rest'}</div>
                </div>
              )
            })}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 16, lineHeight: 1.5 }}>
            {days.length < 7 ? `${ORDER.filter(wd => !days.some(d => d.day === wd)).join(', ')} will be rest days. Change any day above with the dropdown on its card.` : 'Every day is a training day.'}
          </p>

          {days.map((day, di) => (
            <div key={di} className="mb-card" style={{ ...card, padding: '14px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{day.label}</span>
                <select value={day.day} onChange={e => changeWeekday(di, e.target.value)}
                  style={{ marginLeft: 'auto', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '5px 8px', fontSize: 12, color: 'var(--text)' }}>
                  {WEEKDAYS.map(wd => <option key={wd} value={wd} disabled={wd !== day.day && usedDays.has(wd)}>{wd}</option>)}
                </select>
              </div>
              {day.exercises.map((ex, ei) => (
                <div key={ex.name + ei} className="mb-row" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <button onClick={() => moveExercise(di, ei, -1)} disabled={ei === 0} style={{ background: 'none', border: 'none', cursor: ei === 0 ? 'default' : 'pointer', color: 'var(--text-faint)', fontSize: 9, lineHeight: 1, opacity: ei === 0 ? 0.3 : 1, padding: 0 }}>▲</button>
                    <button onClick={() => moveExercise(di, ei, 1)} disabled={ei === day.exercises.length - 1} style={{ background: 'none', border: 'none', cursor: ei === day.exercises.length - 1 ? 'default' : 'pointer', color: 'var(--text-faint)', fontSize: 9, lineHeight: 1, opacity: ei === day.exercises.length - 1 ? 0.3 : 1, padding: 0 }}>▼</button>
                  </div>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ex.name}</span>
                  <input value={ex.sets} onChange={e => setFieldVal(di, ei, 'sets', e.target.value)} inputMode="numeric" style={{ width: 30, textAlign: 'center', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '4px 2px', fontSize: 12, color: 'var(--text)' }} />
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>×</span>
                  <input value={ex.reps} onChange={e => setFieldVal(di, ei, 'reps', e.target.value)} style={{ width: 44, textAlign: 'center', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '4px 2px', fontSize: 12, color: 'var(--text)' }} />
                  <button onClick={() => setPicker({ dayIdx: di, exIdx: ei })} title="Swap" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 13, padding: '0 2px' }}>✎</button>
                  <button onClick={() => removeExercise(di, ei)} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 15, padding: '0 2px' }}>×</button>
                </div>
              ))}
              <button className="mb-tap" onClick={() => setPicker({ dayIdx: di, exIdx: null })} style={{ marginTop: 6, background: 'var(--bg)', border: '0.5px dashed var(--border)', borderRadius: 8, padding: '8px', width: '100%', fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>+ Add exercise</button>
            </div>
          ))}
          <button onClick={() => setStep(3)} style={{ width: '100%', background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 6 }}>Next: progression →</button>
        </div>
      )}

      {/* STEP 3 */}
      {step === 3 && (
        <div className="mb-animate">
          <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)', marginBottom: 18, letterSpacing: '-0.3px' }}>Progression{showLength ? ' & length' : ''}</h1>
          {showName && (
            <div style={{ ...card, padding: '16px', marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Plan name</label>
              <input value={planName} onChange={e => setPlanName(e.target.value)} style={{ width: '100%', marginTop: 8, background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: 14, color: 'var(--text)' }} />
            </div>
          )}
          {showLength && (
            <div style={{ ...card, padding: '16px', marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Block length</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{weeks} weeks</span>
              </div>
              <input type="range" min={4} max={16} value={weeks} onChange={e => setWeeks(parseInt(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
            </div>
          )}
          <div style={{ ...card, padding: '16px', marginBottom: 14 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>How load progresses</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {([['linear', 'Linear', 'Add a little weight each week, same sets & reps.'], ['percent', '% of 1RM', 'Ramp intensity as a percentage of your max.'], ['rpe', 'RPE-based', 'Progress by target effort (RPE) each week.']] as [Progression, string, string][]).map(([id, label, desc]) => (
                <div key={id} onClick={() => setProgression(id)} style={{ padding: '11px 13px', borderRadius: 10, cursor: 'pointer', border: `${progression === id ? '1.5px' : '0.5px'} solid ${progression === id ? 'var(--accent)' : 'var(--border)'}`, background: progression === id ? 'var(--bg)' : 'transparent' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{desc}</div>
                </div>
              ))}
            </div>
            <div onClick={() => setDeload(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, cursor: 'pointer' }}>
              <div style={{ width: 38, height: 22, borderRadius: 11, background: deload ? 'var(--accent)' : 'var(--border)', position: 'relative', transition: 'background 0.15s' }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: deload ? 18 : 2, transition: 'left 0.15s' }} />
              </div>
              <span style={{ fontSize: 13, color: 'var(--text)' }}>Add a deload every 4th week</span>
            </div>
          </div>
          <button onClick={submit} disabled={submitting} style={{ width: '100%', background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Working…' : ctaLabel}
          </button>
        </div>
      )}

      {/* Picker overlay */}
      {picker && (
        <div className="mb-scrim" onClick={() => setPicker(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div className="mb-sheet" onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderTopLeftRadius: 20, borderTopRightRadius: 20, width: '100%', maxWidth: 560, maxHeight: '70vh', overflowY: 'auto', padding: '18px 16px 28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{picker.exIdx === null ? 'Add exercise' : 'Swap to…'}</span>
              <button onClick={() => setPicker(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            {byPattern(patternsForDay(picker.dayIdx)).map(ex => (
              <div key={ex.name} className="mb-row mb-tap" onClick={() => pickExercise(ex.name)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 10, cursor: 'pointer', marginBottom: 4, border: '0.5px solid var(--border)', background: 'var(--bg-card)' }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{ex.name}</span>
                {ex.main && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Main</span>}
                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{ex.defaultSets}×{ex.defaultReps}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
