'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth-context'
import StrengthBuilder from '@/components/StrengthBuilder'
import { overlayFixedStrength, buildWeeks } from '@/lib/strengthBuilder'
import type { StrengthTemplate, BuilderConfig } from '@/lib/strengthBuilder'

const GOAL_RACES = [
  { id: 'marathon', label: 'Marathon', emoji: '🏃', desc: '42.2km · 16 week plan', weeks: 16 },
  { id: 'half_marathon', label: 'Half Marathon', emoji: '🏅', desc: '21.1km · 12 week plan', weeks: 12 },
  { id: '5k', label: '5K PR', emoji: '⚡', desc: '5km · chase a new PR · 8 week plan', weeks: 8 },
  { id: 'hyrox', label: 'Hyrox', emoji: '🏋️', desc: '8km + 8 stations · 12 week plan', weeks: 12 },
  { id: 'hyrox_doubles', label: 'Hyrox Doubles', emoji: '👥', desc: 'Team of 2 · 12 week plan', weeks: 12 },
  { id: 'hybrid', label: 'Hybrid Athlete', emoji: '⚡', desc: 'Lift + run · ongoing 8 week blocks', weeks: 8 },
  { id: 'strength', label: 'Strength Training', emoji: '🏋️', desc: 'Build muscle & strength · no running', weeks: 8 },
]

const FITNESS_LEVELS = [
  { id: 'beginner', label: 'Beginner', desc: 'New to structured training' },
  { id: 'intermediate', label: 'Intermediate', desc: 'Training 3–4x per week' },
  { id: 'advanced', label: 'Advanced', desc: 'Competing regularly' },
]

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

const TIME_GOALS: Record<string, { label: string; options: string[] }> = {
  marathon: {
    label: 'Marathon goal time',
    options: ['Sub 3:00', 'Sub 3:30', 'Sub 4:00', 'Sub 4:30', 'Sub 5:00', 'Finish strong']
  },
  half_marathon: {
    label: 'Half marathon goal time',
    options: ['Sub 1:30', 'Sub 1:45', 'Sub 2:00', 'Sub 2:15', 'Sub 2:30', 'Finish strong']
  },
  '5k': {
    label: '5K goal time',
    options: ['Sub 18:00', 'Sub 20:00', 'Sub 22:30', 'Sub 25:00', 'Sub 30:00', 'Just finish']
  },
  hyrox: {
    label: 'Hyrox goal time',
    options: ['Sub 1:00', 'Sub 1:15', 'Sub 1:30', 'Sub 1:45', 'Sub 2:00', 'Finish strong']
  },
  hyrox_doubles: {
    label: 'Hyrox Doubles goal time',
    options: ['Sub 1:15', 'Sub 1:30', 'Sub 1:45', 'Sub 2:00', 'Sub 2:15', 'Finish strong']
  },
  hybrid: {
    label: 'Primary focus',
    options: ['Build strength', 'Improve running', 'Equal balance', 'Conditioning focus']
  }
}

// Recommended PEAK weekly running volume (km) by goal + time goal. The peak is the
// single biggest week in the block; everything else scales off it. Tuned to what each
// goal realistically demands (e.g. a sub-3 marathon wants ~100km+, not 70).
const PEAK_VOLUME: Record<string, Record<string, number>> = {
  marathon: { 'Sub 3:00': 105, 'Sub 3:30': 90, 'Sub 4:00': 75, 'Sub 4:30': 65, 'Sub 5:00': 55, 'Finish strong': 50 },
  half_marathon: { 'Sub 1:30': 85, 'Sub 1:45': 70, 'Sub 2:00': 60, 'Sub 2:15': 50, 'Sub 2:30': 45, 'Finish strong': 40 },
  '5k': { 'Sub 18:00': 80, 'Sub 20:00': 65, 'Sub 22:30': 55, 'Sub 25:00': 45, 'Sub 30:00': 35, 'Just finish': 25 },
  hyrox: { 'Sub 1:00': 70, 'Sub 1:15': 60, 'Sub 1:30': 50, 'Sub 1:45': 45, 'Sub 2:00': 40, 'Finish strong': 35 },
  hyrox_doubles: { 'Sub 1:15': 65, 'Sub 1:30': 55, 'Sub 1:45': 48, 'Sub 2:00': 42, 'Sub 2:15': 38, 'Finish strong': 35 },
  hybrid: { 'Build strength': 35, 'Improve running': 60, 'Equal balance': 45, 'Conditioning focus': 40 },
}
const FITNESS_VOL_MULT: Record<string, number> = { beginner: 0.8, intermediate: 1, advanced: 1.15 }
const roundTo5 = (n: number) => Math.max(15, Math.round(n / 5) * 5)

export default function OnboardingPage() {
  const { user } = useAuth()
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState(1)
  const [goalRace, setGoalRace] = useState('')
  const [raceDate, setRaceDate] = useState('')
  const [fitnessLevel, setFitnessLevel] = useState('')
  const [timeGoal, setTimeGoal] = useState('')
  // 5K only: the athlete's CURRENT 5k PR (mm:ss) drives VDOT-accurate training paces.
  // 'Unsure' (or blank) falls back to fitness-level defaults on the server.
  const [currentPr, setCurrentPr] = useState('')
  const [prUnsure, setPrUnsure] = useState(false)
  const [runDays, setRunDays] = useState<string[]>([])
  const [liftDays, setLiftDays] = useState<string[]>([])
  const [runCount, setRunCount] = useState<number | null>(null)
  const [liftCount, setLiftCount] = useState<number | null>(null)
  const [peakKm, setPeakKm] = useState<number | null>(null)
  const [hasGym, setHasGym] = useState<boolean | null>(null)
  const [longRunDay, setLongRunDay] = useState<string | null>(null)
  const [canDoubleUp, setCanDoubleUp] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [importedFile, setImportedFile] = useState<{name:string;content:string}|null>(null)
  const [startMode, setStartMode] = useState<'next_monday' | 'today'>('next_monday')
  // Strength source: 'ai' = AI programs the lifts (full gym or home, via hasGym);
  // 'manual' = the athlete builds their own recurring lift days and the AI programs
  // running/conditioning around them.
  const [strengthSource, setStrengthSource] = useState<'ai' | 'manual' | null>(null)
  const [strengthTemplate, setStrengthTemplate] = useState<StrengthTemplate | null>(null)
  const [strengthCfg, setStrengthCfg] = useState<BuilderConfig | null>(null)
  const [hyroxCircuits, setHyroxCircuits] = useState(false)
  const [buildingStrength, setBuildingStrength] = useState(false)
  const [strengthOnlyBuild, setStrengthOnlyBuild] = useState(false)
  const [restDays, setRestDays] = useState<number>(1)

  // Mid-week plan generation: if today isn't Monday, the athlete chooses whether
  // Week 1 begins next Monday (clean start) or this Monday with already-passed
  // days skipped. On a Monday both are identical, so the choice is hidden.
  const todayIsMonday = new Date().getDay() === 1

  const selectedRace = GOAL_RACES.find(r => r.id === goalRace)
  const MIN_RUNS: Record<string, number> = { marathon: 4, half_marathon: 3, '5k': 3, hyrox: 3, hyrox_doubles: 3, hybrid: 0 }
  const minRuns = MIN_RUNS[goalRace] ?? 0
  const showLongRunPin = ['marathon','half_marathon','5k','hyrox','hyrox_doubles'].includes(goalRace)
  const isHybrid = goalRace === 'hybrid'

  // Recommended peak weekly running volume, tailored to goal + time + fitness level.
  const recommendedPeak = () => {
    const base = PEAK_VOLUME[goalRace]?.[timeGoal] ?? 60
    return roundTo5(base * (FITNESS_VOL_MULT[fitnessLevel] ?? 1))
  }
  // Three selectable bands around the recommendation: conservative / recommended / ambitious.
  const peakBands = () => {
    const rec = recommendedPeak()
    return [roundTo5(rec * 0.8), rec, roundTo5(rec * 1.2)]
  }
  const kmToMi = (km: number) => Math.round(km / 1.609)

  // Pinning is capped at the chosen count — you can't pin more run days than runs (or
  // lift days than lifts), which would otherwise contradict the plan and throw it off.
  const toggleDay = (day: string, type: 'run'|'lift') => {
    if (type === 'run') setRunDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : (runCount != null && prev.length >= runCount ? prev : [...prev, day]))
    else setLiftDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : (liftCount != null && prev.length >= liftCount ? prev : [...prev, day]))
  }

  // Max rest days offered, tightened for stronger athletes and more aggressive goals.
  const maxRestDays = (): number => {
    const opts = TIME_GOALS[goalRace]?.options ?? []
    const idx = opts.indexOf(timeGoal)
    const aggressive = idx >= 0 && idx <= 1 // top two time goals are the aggressive ones
    let m = fitnessLevel === 'beginner' ? 3 : fitnessLevel === 'advanced' ? 1 : 2
    if (aggressive && m > 1) m -= 1
    return Math.max(1, m)
  }

  const getWeeksForPlan = () => {
    if (isHybrid) return 8
    if (!raceDate) return selectedRace?.weeks ?? 8
    const weeksOut = Math.ceil((new Date(raceDate).getTime() - Date.now()) / (86400000 * 7))
    return Math.min(Math.max(weeksOut, 4), selectedRace?.weeks ?? 12)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setImportedFile({ name: file.name, content: ev.target?.result as string })
    reader.readAsText(file)
  }

  const handleFinish = async () => {
    if (!user) return
    setLoading(true)
    setLoadingMsg('Saving your profile...')
    await supabase.from('profiles').upsert({
      id: user.id,
      goal_race: goalRace,
      goal_race_date: isHybrid ? null : raceDate,
      fitness_level: fitnessLevel,
      days_per_week: (runCount ?? 0) + (liftCount ?? 0)
    })

    setLoadingMsg(importedFile ? 'Importing your training file...' : 'Milkbag is building your plan...')
    const weeks = getWeeksForPlan()
    // If the athlete runs but didn't pick a volume, fall back to the recommendation.
    const resolvedPeak = (runCount ?? 0) > 0 ? (peakKm ?? recommendedPeak()) : null
    const safeRestDays = Math.min(restDays, maxRestDays())
    const endpoint = importedFile ? '/api/import-plan' : '/api/generate-plan'
    // 5K: send the current PR (mm:ss) so the server can derive VDOT paces. Null when unsure/blank.
    const resolvedPr = goalRace === '5k' && !prUnsure && currentPr.trim() ? currentPr.trim() : null
    const body = importedFile
      ? { fileContent: importedFile.content, fileName: importedFile.name, goalRace, raceDate, fitnessLevel, runCount, liftCount, runDays, liftDays, longRunDay, peakKm: resolvedPeak, canDoubleUp, hasGym, weeks, timeGoal, currentPr: resolvedPr }
      : { goalRace, raceDate, fitnessLevel, runCount, liftCount, runDays, liftDays, longRunDay, peakKm: resolvedPeak, canDoubleUp, hasGym, weeks, timeGoal, currentPr: resolvedPr, restDays: safeRestDays, fixedStrength: strengthSource === 'manual' ? strengthTemplate : undefined }

    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(body)
    })

    let plan: any = null
    if (res.body && res.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          const trimmed = part.trim()
          if (!trimmed.startsWith('data:')) continue
          try {
            const evt = JSON.parse(trimmed.slice(5).trim())
            if (evt.type === 'progress') setLoadingMsg(evt.message)
            else if (evt.type === 'complete') plan = evt.plan
            else if (evt.type === 'error') throw new Error(evt.error)
          } catch { /* ignore partial chunk */ }
        }
      }
    } else {
      plan = await res.json()
    }

    if (!plan || !plan.weeks?.length) {
      setLoading(false)
      alert('Plan generation failed. Please try again.')
      return
    }

    // Self-built strength: overlay the user's exact lift days onto the AI's running
    // weeks so the lifts (and their demo images) are guaranteed untouched.
    if (strengthSource === 'manual' && strengthTemplate && strengthCfg) {
      plan.weeks = overlayFixedStrength(plan.weeks, strengthTemplate, strengthCfg, { hyroxCircuits: hyroxCircuits && ['hyrox', 'hyrox_doubles'].includes(goalRace) })
    }

    // Anchor the plan to a Week-1 Monday so the dashboard aligns plan weeks to the
    // calendar. startMonday = Monday of Week 1; activeFrom = first day that counts
    // (today for a mid-week "start today" plan, otherwise the same Monday).
    const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const now = new Date()
    const dow = now.getDay() // 0 = Sun … 6 = Sat
    const thisMonday = new Date(now); thisMonday.setHours(0, 0, 0, 0); thisMonday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1))
    const nextMonday = new Date(thisMonday); nextMonday.setDate(thisMonday.getDate() + 7)
    const startToday = todayIsMonday || startMode === 'today'
    const startMonday = isoDate(startToday ? thisMonday : nextMonday)
    const todayMidnight = new Date(now); todayMidnight.setHours(0, 0, 0, 0)
    const activeFrom = startToday ? isoDate(todayMidnight) : isoDate(nextMonday)

    setLoadingMsg('Saving your plan...')
    await supabase.from('training_plans').delete().eq('user_id', user.id)
    await supabase.from('training_plans').insert({
      user_id: user.id,
      plan_name: plan.planName,
      plan_type: goalRace,
      start_date: activeFrom,
      end_date: isHybrid ? null : raceDate,
      plan_data: { ...plan, timeGoal, startMonday, activeFrom, ...(strengthSource === 'manual' && strengthTemplate ? { builder: 'manual-strength-hybrid', strengthTemplate } : {}) }
    })
    router.push('/dashboard')
  }

  // Strength-only goal: no running. Save the built template directly as a strength plan.
  const saveStrengthOnly = async (template: StrengthTemplate, cfg: BuilderConfig) => {
    if (!user) return
    await supabase.from('profiles').upsert({
      id: user.id, goal_race: 'strength', goal_race_date: null,
      fitness_level: fitnessLevel || 'intermediate', days_per_week: template.days.length,
    })
    const planWeeks = buildWeeks(template, cfg)
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const dow = now.getDay()
    const thisMonday = new Date(now); thisMonday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1))
    const startMonday = iso(thisMonday)
    const activeFrom = iso(now)
    await supabase.from('training_plans').delete().eq('user_id', user.id)
    await supabase.from('training_plans').insert({
      user_id: user.id, plan_name: cfg.planName, plan_type: 'strength', start_date: activeFrom, end_date: null,
      plan_data: { planName: cfg.planName, weeks: planWeeks, startMonday, activeFrom, timeGoal: '', builder: 'manual-strength', strengthTemplate: template },
    })
    router.push('/dashboard')
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>⚡</div>
      <h2 style={{ color: 'var(--text)', fontWeight: 500, fontSize: 20 }}>Building your plan</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>{loadingMsg}</p>
      <div style={{ height: 3, width: 220, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: '60%', background: 'var(--accent)', borderRadius: 2, animation: 'pulse 1.5s infinite' }} />
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:0.5}50%{opacity:1}}`}</style>
    </div>
  )

  const s = (n: number) => (
    <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
      {[1,2,3,4,5,6].map(i => <div key={i} style={{ height: 3, flex: 1, borderRadius: 2, background: i <= n ? 'var(--accent)' : 'var(--border)' }} />)}
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 520 }}>

        {strengthOnlyBuild ? (
          <StrengthBuilder ctaLabel="Save & start training"
            onCancel={() => setStrengthOnlyBuild(false)}
            onComplete={saveStrengthOnly} />
        ) : buildingStrength ? (
          <StrengthBuilder showLength={false} showName={false} ctaLabel="Use this & continue →"
            prefDays={liftDays} prefCount={liftCount ?? undefined}
            onCancel={() => setBuildingStrength(false)}
            onComplete={(template, cfg) => { setStrengthTemplate(template); setStrengthCfg(cfg); setLiftCount(template.days.length); setLiftDays(template.days.map(d => d.day)); setBuildingStrength(false); setStep(6) }} />
        ) : (
        <>

        {step === 1 && (
          <div>
            {s(1)}
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Step 1 of 6</p>
            <h2 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>What are you training for?</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>We'll build the right plan around your goal.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {GOAL_RACES.map(race => (
                <div key={race.id} onClick={() => setGoalRace(race.id)}
                  style={{ cursor: 'pointer', borderRadius: 12, padding: '14px 16px', border: `${goalRace === race.id ? '1.5px' : '0.5px'} solid ${goalRace === race.id ? 'var(--accent)' : 'var(--border)'}`, background: goalRace === race.id ? 'var(--bg-card)' : 'transparent', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ fontSize: 24 }}>{race.emoji}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{race.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{race.desc}</div>
                  </div>
                  {goalRace === race.id && <span style={{ color: 'var(--accent)', fontSize: 16 }}>✓</span>}
                </div>
              ))}
            </div>
            <div style={{ border: '0.5px dashed var(--border-strong)', borderRadius: 12, padding: 14, marginBottom: 16, textAlign: 'center' }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Already have a plan? Import it instead.</p>
              <input ref={fileRef} type="file" accept=".txt,.csv,.pdf,.xlsx,.xls,.doc,.docx" onChange={handleFileUpload} style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()}
                style={{ fontSize: 12, fontWeight: 500, padding: '7px 14px', borderRadius: 8, border: '0.5px solid var(--border-strong)', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                Upload file
              </button>
              {importedFile && <p style={{ fontSize: 12, color: 'var(--accent)', marginTop: 6 }}>✓ {importedFile.name}</p>}
            </div>
            <Button onClick={() => goalRace === 'strength' ? setStrengthOnlyBuild(true) : setStep(2)} disabled={!goalRace && !importedFile}
              style={{ width: '100%', background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', fontWeight: 500, height: 44 }}>
              {goalRace === 'strength' ? 'Build my strength plan →' : 'Next'}
            </Button>
          </div>
        )}

        {step === 2 && (
          <div>
            {s(2)}
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Step 2 of 6</p>
            {!isHybrid ? (
              <>
                <h2 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>When's race day?</h2>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>Your plan will be exactly {getWeeksForPlan()} weeks — built to peak on race day.</p>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>Race date</label>
                <div style={{ position: 'relative', marginBottom: 20 }}>
                  <input type="date" value={raceDate} onChange={e => setRaceDate(e.target.value)}
                    style={{ width: '100%', background: 'var(--bg-card)', border: `1px solid ${raceDate ? 'var(--accent)' : 'var(--border-strong)'}`, color: 'var(--text)', borderRadius: 12, padding: '15px 16px', fontSize: 16, outline: 'none', fontWeight: 500 }} />
                  {!raceDate && <span style={{ position: 'absolute', right: 44, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-faint)', pointerEvents: 'none' }}>Tap to choose</span>}
                </div>
              </>
            ) : (
              <>
                <h2 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>Hybrid athlete plan</h2>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>8 week rolling blocks — strength, aerobic base, and conditioning. Regenerate any time.</p>
              </>
            )}
            <h3 style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 12 }}>Your fitness level</h3>
            {FITNESS_LEVELS.map(level => (
              <div key={level.id} onClick={() => setFitnessLevel(level.id)}
                style={{ cursor: 'pointer', borderRadius: 10, padding: '12px 14px', marginBottom: 8, border: `${fitnessLevel === level.id ? '1.5px' : '0.5px'} solid ${fitnessLevel === level.id ? 'var(--accent)' : 'var(--border)'}`, background: fitnessLevel === level.id ? 'var(--bg-card)' : 'transparent', transition: 'all 0.15s' }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{level.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{level.desc}</div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <Button onClick={() => setStep(1)} variant="outline" style={{ flex: 1, borderColor: 'var(--border)', color: 'var(--text-muted)' }}>Back</Button>
              <Button onClick={() => setStep(3)} disabled={!isHybrid && !raceDate || !fitnessLevel}
                style={{ flex: 1, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', fontWeight: 500 }}>Next</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            {s(3)}
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Step 3 of 6</p>
            <h2 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>
              {TIME_GOALS[goalRace]?.label ?? 'What\'s your goal?'}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              The AI uses this to set your training paces, distances, and weekly targets precisely.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {(TIME_GOALS[goalRace]?.options ?? []).map(opt => (
                <div key={opt} onClick={() => setTimeGoal(opt)}
                  style={{ cursor: 'pointer', borderRadius: 12, padding: '14px 16px', border: `${timeGoal === opt ? '1.5px' : '0.5px'} solid ${timeGoal === opt ? 'var(--accent)' : 'var(--border)'}`, background: timeGoal === opt ? 'var(--bg-card)' : 'transparent', transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{opt}</span>
                  {timeGoal === opt && <span style={{ color: 'var(--accent)' }}>✓</span>}
                </div>
              ))}
            </div>
            {goalRace === '5k' && (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>What's your current 5K PR?</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>Your most recent 5K time sets your exact training paces (VDOT). Not sure? We'll pace you off your fitness level instead.</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="text" inputMode="numeric" placeholder="mm:ss (e.g. 24:30)" value={currentPr}
                    onChange={e => { setCurrentPr(e.target.value); if (e.target.value.trim()) setPrUnsure(false) }}
                    disabled={prUnsure}
                    style={{ flex: 1, background: 'var(--bg-card)', border: `1px solid ${currentPr.trim() && !prUnsure ? 'var(--accent)' : 'var(--border-strong)'}`, color: 'var(--text)', borderRadius: 12, padding: '13px 16px', fontSize: 16, outline: 'none', fontWeight: 500, opacity: prUnsure ? 0.45 : 1 }} />
                  <button onClick={() => { setPrUnsure(v => !v); if (!prUnsure) setCurrentPr('') }}
                    style={{ padding: '13px 16px', borderRadius: 12, border: `${prUnsure ? '1.5px' : '0.5px'} solid ${prUnsure ? 'var(--accent)' : 'var(--border)'}`, background: prUnsure ? 'var(--bg-card)' : 'transparent', color: prUnsure ? 'var(--accent)' : 'var(--text-muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {prUnsure ? '✓ Unsure' : 'Unsure'}
                  </button>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => setStep(2)} variant="outline" style={{ flex: 1, borderColor: 'var(--border)', color: 'var(--text-muted)' }}>Back</Button>
              <Button onClick={() => setStep(4)} disabled={!timeGoal}
                style={{ flex: 1, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', fontWeight: 500 }}>Next</Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            {s(4)}
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Step 4 of 6</p>
            <h2 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>Can you train twice in a day?</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>If yes, we'll pair a lift and run on the same day where it makes sense.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {[
                { val: true, label: 'Yes — I can double up', desc: 'Morning lift + evening run on the same day' },
                { val: false, label: 'No — one session per day', desc: 'Keep each day to a single workout' },
              ].map(opt => (
                <div key={String(opt.val)} onClick={() => setCanDoubleUp(opt.val)}
                  style={{ cursor: 'pointer', borderRadius: 12, padding: '14px 16px', border: `${canDoubleUp === opt.val ? '1.5px' : '0.5px'} solid ${canDoubleUp === opt.val ? 'var(--accent)' : 'var(--border)'}`, background: canDoubleUp === opt.val ? 'var(--bg-card)' : 'transparent', transition: 'all 0.15s' }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{opt.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{opt.desc}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => setStep(3)} variant="outline" style={{ flex: 1, borderColor: 'var(--border)', color: 'var(--text-muted)' }}>Back</Button>
              <Button onClick={() => setStep(5)} disabled={canDoubleUp === null}
                style={{ flex: 1, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', fontWeight: 500 }}>Next</Button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div>
            {s(5)}
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Step 5 of 6</p>
            <h2 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>How many days per week do you want to run?</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>Your coach builds exactly this many runs into every week.</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: minRuns > 0 ? 10 : 28 }}>
              {[0,1,2,3,4,5,6,7].filter(n => n >= minRuns).map(n => (
                <button key={n} onClick={() => { setRunCount(n); setRunDays(prev => prev.slice(0, n)) }}
                  style={{ width: 44, height: 44, borderRadius: 10, border: `${runCount === n ? '1.5px' : '0.5px'} solid ${runCount === n ? 'var(--run)' : 'var(--border)'}`, fontSize: 15, fontWeight: 600, cursor: 'pointer', background: runCount === n ? 'var(--run)' : 'var(--bg-card)', color: runCount === n ? '#fff' : 'var(--text-muted)', transition: 'all 0.15s' }}>{n}</button>
              ))}
            </div>
            {minRuns > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 28, lineHeight: 1.5 }}>
                {selectedRace?.label ?? 'This race'} training needs at least {minRuns} run days per week to build the aerobic base your goal requires.
              </p>
            )}
            {runCount !== null && runCount > 0 && (
              <div style={{ marginBottom: 28 }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Pin specific run days? <span style={{ color: 'var(--text-faint)' }}>(optional · up to {runCount})</span></p>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {DAYS.map(day => {
                    const on = runDays.includes(day)
                    const capped = !on && runCount != null && runDays.length >= runCount
                    return (
                      <button key={day} onClick={() => toggleDay(day, 'run')} disabled={capped}
                        style={{ padding: '7px 11px', borderRadius: 8, border: `0.5px solid ${on ? 'var(--run)' : 'var(--border)'}`, fontSize: 12, fontWeight: 500, cursor: capped ? 'default' : 'pointer', background: on ? 'var(--run)' : 'var(--bg-card)', color: on ? '#fff' : 'var(--text-muted)', opacity: capped ? 0.4 : 1, transition: 'all 0.15s' }}>{day}</button>
                    )
                  })}
                </div>
              </div>
            )}
            {showLongRunPin && runCount !== null && runCount > 0 && (
              <div style={{ marginBottom: 28 }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Pick your weekly long run day? <span style={{ color: 'var(--text-faint)' }}>(optional)</span></p>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {DAYS.map(day => (
                    <button key={day} onClick={() => setLongRunDay(longRunDay === day ? null : day)}
                      style={{ padding: '7px 11px', borderRadius: 8, border: `0.5px solid ${longRunDay === day ? 'var(--accent)' : 'var(--border)'}`, fontSize: 12, fontWeight: 500, cursor: 'pointer', background: longRunDay === day ? 'var(--accent)' : 'var(--bg-card)', color: longRunDay === day ? 'var(--accent-fg)' : 'var(--text-muted)', transition: 'all 0.15s' }}>{day}</button>
                  ))}
                </div>
              </div>
            )}
            {runCount !== null && runCount > 0 && (() => {
              const [low, rec, high] = peakBands()
              const current = peakKm ?? rec
              const avgRun = Math.round(current / runCount)
              return (
                <div style={{ marginBottom: 32 }}>
                  <h2 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>Peak weekly running volume</h2>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 }}>Your biggest training week. We build up to it, deload below it, and taper down from it.</p>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
                    <span style={{ fontSize: 38, fontWeight: 600, color: 'var(--run)', letterSpacing: '-1px', lineHeight: 1 }}>{current}</span>
                    <span style={{ fontSize: 14, color: 'var(--text-faint)' }}>km/week · ~{kmToMi(current)} mi</span>
                  </div>
                  <input type="range" min={low} max={high} step={5} value={current}
                    onChange={e => setPeakKm(parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--run)', height: 24, cursor: 'pointer', outline: 'none' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, gap: 6 }}>
                    {([['Conservative', low], ['Recommended', rec], ['Ambitious', high]] as [string, number][]).map(([label, km]) => {
                      const active = current === km
                      return (
                        <button key={label} onClick={() => setPeakKm(km)}
                          style={{ flex: 1, background: active ? 'var(--bg-card)' : 'transparent', border: `${active ? '1px' : '0.5px'} solid ${active ? 'var(--run)' : 'var(--border)'}`, borderRadius: 10, padding: '8px 4px', cursor: 'pointer', transition: 'all 0.15s' }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: active ? 'var(--run)' : 'var(--text)' }}>{km}</div>
                          <div style={{ fontSize: 9, fontWeight: 500, color: active ? 'var(--run)' : 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2 }}>{label}</div>
                        </button>
                      )
                    })}
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 12, lineHeight: 1.5 }}>
                    Across your {runCount} run{runCount > 1 ? 's' : ''}/week that's about {avgRun} km per run at peak.{avgRun >= 20 ? ' That means some long midweek runs — add run days if you’d prefer shorter ones.' : ''}
                  </p>
                </div>
              )
            })()}
            <h2 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>How many days per week do you want to lift?</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>Strength sessions are programmed to support your running and durability.</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 28 }}>
              {[0,1,2,3,4,5,6,7].map(n => (
                <button key={n} onClick={() => { setLiftCount(n); setLiftDays(prev => prev.slice(0, n)) }}
                  style={{ width: 44, height: 44, borderRadius: 10, border: `${liftCount === n ? '1.5px' : '0.5px'} solid ${liftCount === n ? 'var(--lift)' : 'var(--border)'}`, fontSize: 15, fontWeight: 600, cursor: 'pointer', background: liftCount === n ? 'var(--lift)' : 'var(--bg-card)', color: liftCount === n ? '#fff' : 'var(--text-muted)', transition: 'all 0.15s' }}>{n}</button>
              ))}
            </div>
            {liftCount !== null && liftCount > 0 && (
              <div style={{ marginBottom: 24 }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Pin specific lift days? <span style={{ color: 'var(--text-faint)' }}>(optional · up to {liftCount})</span></p>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {DAYS.map(day => {
                    const on = liftDays.includes(day)
                    const capped = !on && liftCount != null && liftDays.length >= liftCount
                    return (
                      <button key={day} onClick={() => toggleDay(day, 'lift')} disabled={capped}
                        style={{ padding: '7px 11px', borderRadius: 8, border: `0.5px solid ${on ? 'var(--lift)' : 'var(--border)'}`, fontSize: 12, fontWeight: 500, cursor: capped ? 'default' : 'pointer', background: on ? 'var(--lift)' : 'var(--bg-card)', color: on ? '#fff' : 'var(--text-muted)', opacity: capped ? 0.4 : 1, transition: 'all 0.15s' }}>{day}</button>
                    )
                  })}
                </div>
              </div>
            )}
            {((liftCount ?? 0) > 0 || ['hyrox','hyrox_doubles'].includes(goalRace)) && (
              <div style={{ marginBottom: 28 }}>
                <h2 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>How should we handle strength?</h2>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>Let Milkbag program your lifts, or build your own and we&apos;ll program the running around them.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { src: 'ai' as const, gym: true, label: 'Milkbag builds it — full gym', desc: 'Barbells, machines, sled, erg available' },
                    { src: 'ai' as const, gym: false, label: 'Milkbag builds it — home / bodyweight', desc: 'Bodyweight, backpack, jugs — we adapt every movement' },
                    { src: 'manual' as const, gym: true, label: '🏋️ Build my own strength plan', desc: 'Pick your split & lifts; we build the running around them' },
                  ].map(opt => {
                    const selected = opt.src === 'manual' ? strengthSource === 'manual' : (strengthSource === 'ai' && hasGym === opt.gym)
                    return (
                      <div key={opt.label} onClick={() => { setStrengthSource(opt.src); setHasGym(opt.gym); if (opt.src === 'ai') { setStrengthTemplate(null); setStrengthCfg(null) } }}
                        style={{ cursor: 'pointer', borderRadius: 12, padding: '14px 16px', border: `${selected ? '1.5px' : '0.5px'} solid ${selected ? 'var(--accent)' : 'var(--border)'}`, background: selected ? 'var(--bg-card)' : 'transparent', transition: 'all 0.15s' }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{opt.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{opt.desc}</div>
                        {opt.src === 'manual' && selected && strengthTemplate && (
                          <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 6, fontWeight: 500 }}>✓ {strengthTemplate.days.length}-day plan built · tap Next to edit</div>
                        )}
                      </div>
                    )
                  })}
                </div>
                {strengthSource === 'manual' && ['hyrox','hyrox_doubles'].includes(goalRace) && (
                  <div onClick={() => setHyroxCircuits(v => !v)} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14, cursor: 'pointer', background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, border: `1.5px solid ${hyroxCircuits ? 'var(--accent)' : 'var(--border)'}`, background: hyroxCircuits ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {hyroxCircuits && <span style={{ color: 'var(--accent-fg)', fontSize: 13 }}>✓</span>}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Add Hyrox circuits to my lifting days</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>We&apos;ll finish each lift day with stations that match it (e.g. sled &amp; lunges on leg day) to train race-specific fatigue.</div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>Rest days per week?</h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>How many full days off do you want? Pick 0 if you&apos;d rather train every day.{maxRestDays() < 3 ? ` For a ${fitnessLevel} ${timeGoal ? `${timeGoal} ` : ''}goal we cap this lower to protect your progress.` : ''}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                {Array.from({ length: maxRestDays() + 1 }, (_, n) => n).map(n => (
                  <button key={n} onClick={() => setRestDays(n)}
                    style={{ flex: 1, height: 44, borderRadius: 10, border: `${restDays === n ? '1.5px' : '0.5px'} solid ${restDays === n ? 'var(--accent)' : 'var(--border)'}`, fontSize: 15, fontWeight: 600, cursor: 'pointer', background: restDays === n ? 'var(--accent)' : 'var(--bg-card)', color: restDays === n ? 'var(--accent-fg)' : 'var(--text-muted)', transition: 'all 0.15s' }}>{n}</button>
                ))}
              </div>
            </div>
            {runCount !== null && liftCount !== null && (runCount + liftCount > 7) && !canDoubleUp && (
              <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-strong)', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>That's {runCount + liftCount} sessions across 7 days. Since you chose one session per day, some days will pair a run and a lift, or your coach will prioritise the most important sessions.</p>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => setStep(4)} variant="outline" style={{ flex: 1, borderColor: 'var(--border)', color: 'var(--text-muted)' }}>Back</Button>
              <Button onClick={() => { if (strengthSource === 'manual' && !strengthTemplate) setBuildingStrength(true); else setStep(6) }} disabled={runCount === null || liftCount === null || (runCount + liftCount === 0) || (((liftCount ?? 0) > 0 || ['hyrox','hyrox_doubles'].includes(goalRace)) && strengthSource === null)}
                style={{ flex: 1, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', fontWeight: 500 }}>Next</Button>
            </div>
          </div>
        )}

        {step === 6 && (
          <div>
            {s(6)}
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Step 6 of 6</p>
            <h2 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>You're all set!</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>Here's your training summary.</p>
            <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '16px', marginBottom: 20 }}>
              {[
                ['Goal', goalRace.replace(/_/g,' ')],
                ...(!isHybrid && raceDate ? [['Race date', new Date(raceDate).toLocaleDateString()]] : []),
                ['Plan length', `${getWeeksForPlan()} weeks`],
                ['Time goal', timeGoal],
                ...(goalRace === '5k' ? [['Current 5K PR', prUnsure || !currentPr.trim() ? 'Unsure — pace by level' : currentPr.trim()]] : []),
                ['Fitness level', fitnessLevel],
                ['Double up days', canDoubleUp ? 'Yes' : 'No'],
                ['Run days/week', String(runCount ?? 0)],
                ...((runCount ?? 0) > 0 ? [['Peak volume', `${peakKm ?? recommendedPeak()} km/week`]] : []),
                ['Lift days/week', String(liftCount ?? 0)],
                ['Rest days/week', String(restDays)],
                ...(strengthSource === 'manual' && strengthTemplate
                  ? [['Strength', `Self-built · ${strengthTemplate.days.length} days${hyroxCircuits && ['hyrox','hyrox_doubles'].includes(goalRace) ? ' + Hyrox circuits' : ''}`]]
                  : ((liftCount ?? 0) > 0 || ['hyrox','hyrox_doubles'].includes(goalRace)) ? [['Equipment', hasGym === false ? 'Home / bodyweight' : 'Full gym']] : []),
                ...(importedFile ? [['Imported file', importedFile.name]] : []),
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', textTransform: 'capitalize' }}>{value}</span>
                </div>
              ))}
            </div>

            {!todayIsMonday && (
              <div style={{ marginBottom: 20 }}>
                <h3 style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>When should Week 1 start?</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>It’s mid-week, so a few days have already passed. Pick how to begin.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { val: 'next_monday' as const, label: 'Start next Monday', desc: 'Begin Week 1 fresh on Monday — full weeks, nothing missed. Recommended.' },
                    { val: 'today' as const, label: 'Start today', desc: 'Begin this week and skip the days that have already passed.' },
                  ].map(opt => (
                    <div key={opt.val} onClick={() => setStartMode(opt.val)}
                      style={{ cursor: 'pointer', borderRadius: 12, padding: '14px 16px', border: `${startMode === opt.val ? '1.5px' : '0.5px'} solid ${startMode === opt.val ? 'var(--accent)' : 'var(--border)'}`, background: startMode === opt.val ? 'var(--bg-card)' : 'transparent', transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{opt.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{opt.desc}</div>
                      </div>
                      {startMode === opt.val && <span style={{ color: 'var(--accent)', flexShrink: 0 }}>✓</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => setStep(5)} variant="outline" style={{ flex: 1, borderColor: 'var(--border)', color: 'var(--text-muted)' }}>Back</Button>
              <Button onClick={handleFinish}
                style={{ flex: 1, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', fontWeight: 500 }}>
                {importedFile ? 'Import my plan →' : 'Generate my plan →'}
              </Button>
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  )
}
