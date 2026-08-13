'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { coerceImportedPlan } from '@/lib/importPlan'
import StrengthBuilder from '@/components/StrengthBuilder'
import { overlayFixedStrength } from '@/lib/strengthBuilder'
import type { StrengthTemplate, BuilderConfig } from '@/lib/strengthBuilder'

export default function ImportPage() {
  const { user } = useAuth()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ name: string; weeks: number; sessions: number } | null>(null)
  const [parsed, setParsed] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [addStrength, setAddStrength] = useState(false)
  const [building, setBuilding] = useState(false)

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    setError(''); setPreview(null); setParsed(null)
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const raw = JSON.parse(typeof ev.target?.result === 'string' ? ev.target.result : '')
        const res = coerceImportedPlan(raw)
        if (!res.ok || !res.plan) { setError(res.error || 'Could not read that plan.'); return }
        const sessions = res.plan.plan_data.weeks.reduce((a: number, w: any) => a + w.sessions.length, 0)
        setParsed(res.plan)
        setPreview({ name: res.plan.plan_name, weeks: res.plan.plan_data.weeks.length, sessions })
      } catch {
        setError('That file isn\'t valid JSON. Export your plan as a Milkbag plan file (.json).')
      }
    }
    reader.onerror = () => setError('Could not read that file.')
    reader.readAsText(file)
  }

  const savePlan = async (weeks: any[], template?: StrengthTemplate) => {
    if (!user || !parsed) return
    setBusy(true)
    await supabase.from('profiles').upsert({ id: user.id, goal_race: parsed.goal_race, goal_race_date: parsed.goal_race_date })
    await supabase.from('training_plans').delete().eq('user_id', user.id)
    await supabase.from('training_plans').insert({
      user_id: user.id,
      plan_name: parsed.plan_name,
      plan_type: parsed.plan_type,
      start_date: parsed.start_date,
      end_date: parsed.end_date,
      plan_data: { ...parsed.plan_data, weeks, ...(template ? { builder: 'imported+strength', strengthTemplate: template } : {}) },
    })
    router.push('/dashboard')
  }

  const doImport = async () => {
    if (!parsed) return
    if (addStrength) { setBuilding(true); return }
    await savePlan(parsed.plan_data.weeks)
  }

  const onStrengthComplete = async (template: StrengthTemplate, cfg: BuilderConfig) => {
    const weeks = overlayFixedStrength(parsed.plan_data.weeks, template, cfg, { hyroxCircuits: false })
    await savePlan(weeks, template)
  }

  if (building) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 40 }}>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '20px 16px' }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>Build the strength days to layer onto <b style={{ color: 'var(--text)' }}>{preview?.name}</b>. They&apos;ll sit beside your runs.</p>
          <StrengthBuilder showLength={false} showName={false} ctaLabel="Add strength & import →"
            onCancel={() => setBuilding(false)} onComplete={onStrengthComplete} />
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ maxWidth: 440, width: '100%' }}>
        <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '28px 24px' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 22 }}>📥</div>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', textAlign: 'center', marginBottom: 6 }}>Import a plan</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6, marginBottom: 20 }}>
            Already follow a plan (Pfitzinger, Higdon, your coach&apos;s)? Load it as a Milkbag plan file (.json) and track every session in one place.
          </p>

          <input ref={inputRef} type="file" accept=".json,application/json" onChange={onFile} style={{ display: 'none' }} />
          <button onClick={() => inputRef.current?.click()}
            style={{ width: '100%', background: 'var(--bg)', border: '1px dashed var(--accent)', borderRadius: 12, padding: '16px', fontSize: 14, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer', marginBottom: 14 }}>
            Choose plan file…
          </button>

          {error && <p style={{ fontSize: 12, color: '#cc4433', lineHeight: 1.5, marginBottom: 12 }}>{error}</p>}

          {preview && (
            <>
              <div style={{ background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '14px', marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{preview.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{preview.weeks} weeks · {preview.sessions} sessions ready to import</div>
              </div>

              <div onClick={() => setAddStrength(v => !v)} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, border: `1.5px solid ${addStrength ? 'var(--accent)' : 'var(--border)'}`, background: addStrength ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {addStrength && <span style={{ color: 'var(--accent-fg)', fontSize: 13 }}>✓</span>}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Add my own strength training</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>Layer your lifting days onto this plan after importing.</div>
                </div>
              </div>

              <button onClick={doImport} disabled={busy}
                style={{ width: '100%', background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1, marginBottom: 10 }}>
                {busy ? 'Importing…' : addStrength ? 'Next: build strength →' : 'Import & view my plan'}
              </button>
              <p style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center', marginBottom: 10 }}>This replaces your current plan and clears its logged workouts.</p>
            </>
          )}

          <button onClick={() => router.push('/dashboard')}
            style={{ width: '100%', background: 'transparent', color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
