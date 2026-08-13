'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import TrendCharts from '@/components/TrendCharts'
import { detectStruggle } from '@/lib/adaptiveCoach'
import { computeBadges, unseenBadges, markBadgesSeen, type Badge } from '@/lib/achievements'

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const typeDot: Record<string,string> = { run:'var(--run)', lift:'var(--lift)', hyrox:'var(--hyrox)', rest:'var(--text-faint)' }

// Hero-card colour category. run/hyrox come from the session type; lift days are
// split into push/pull/legs from the title (the plan names them "Push", "Pull",
// "Legs — Squat", etc.), falling back to a generic lift colour. Themes that don't
// define --hero-* variables fall back to --accent, so their look is unchanged.
function heroCategory(session: any): string {
  if (session?.type === 'run') return 'run'
  if (session?.type === 'hyrox') return 'hyrox'
  if (session?.type === 'lift') {
    const t = (session.title || '').toLowerCase()
    if (/\bpull\b/.test(t)) return 'pull'
    if (/\bpush\b/.test(t)) return 'push'
    if (/leg|squat|lower|quad|hamstring|glute|posterior/.test(t)) return 'legs'
    return 'lift'
  }
  return 'lift'
}

function getWeekDates(weekOffset: number) {
  const now = new Date()
  const dow = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + weekOffset * 7)
  return DAYS.map((_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d })
}

function fmt(d: Date) { return d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) }

// Local-timezone YYYY-MM-DD. workout_date is stored in local time, so every date
// key derived from a Date must match this — never toISOString(), which is UTC and
// shifts the day for non-UTC users (breaking week totals and streaks).
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Project race times with the Riegel endurance model (T2 = T1 * (D2/D1)^1.06).
// For each target distance we project from the logged run CLOSEST in distance — the
// most reliable extrapolation — rather than averaging pace across all runs (which
// unfairly blends a fast 5k with a slow long run and produces nonsense).
function calcProjectedTimes(logs: any[]) {
  const runs = logs
    .filter(l => l.workout_type === 'run')
    .map(l => ({ d: parseFloat(l.log_data?.runLog?.distance ?? l.log_data?.distance), t: parseFloat(l.log_data?.runLog?.duration ?? l.log_data?.duration) }))
    .filter(r => r.d >= 2 && r.t > 0 && !isNaN(r.d) && !isNaN(r.t))
  if (runs.length === 0) return null

  const fmtT = (mins: number) => {
    const h = Math.floor(mins / 60), m = Math.floor(mins % 60), s = Math.round((mins % 1) * 60)
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`
  }
  const fmtPace = (pace: number) => {
    const m = Math.floor(pace), s = Math.round((pace % 1) * 60)
    return `${m}:${String(s).padStart(2,'0')}/km`
  }
  const R = 1.06
  const targets: [string, number][] = [['5km', 5], ['10km', 10], ['21km', 21.1], ['42km', 42.2]]
  const out: Record<string, { time: string; pace: string; from: number }> = {}
  for (const [label, D] of targets) {
    // reference run = closest to the target by log-distance ratio (Riegel is most
    // accurate over nearby distances); ties broken by faster effort.
    let ref = runs[0], bestErr = Infinity
    for (const r of runs) {
      const err = Math.abs(Math.log(r.d / D))
      if (err < bestErr - 1e-9 || (Math.abs(err - bestErr) < 1e-9 && (r.t / r.d) < (ref.t / ref.d))) { bestErr = err; ref = r }
    }
    const predT = ref.t * Math.pow(D / ref.d, R)
    out[label] = { time: fmtT(predT), pace: fmtPace(predT / D), from: Math.round(ref.d * 10) / 10 }
  }
  return out
}

function parsePlannedKm(sessions: any[]): number {
  // Prefer the explicit numeric distance field; fall back to parsing details for
  // older plans generated before the distance field existed.
  let total = 0
  for (const s of sessions) {
    if (s.type !== 'run') continue
    if (typeof s.distance === 'number' && s.distance > 0) { total += s.distance; continue }
    const m = (s.details || '').match(/(\d+(?:\.\d+)?)\s?km/i)
    if (m) total += parseFloat(m[1])
  }
  return Math.round(total * 10) / 10
}

function sessionDistance(s: any): number | null {
  if (typeof s?.distance === 'number' && s.distance > 0) return s.distance
  const m = (s?.details || '').match(/(\d+(?:\.\d+)?)\s?km/i)
  return m ? parseFloat(m[1]) : null
}

function loggedKmForWeek(logs: any[], weekDates: Date[]): number {
  const dates = weekDates.map(isoLocal)
  let total = 0
  for (const l of logs) {
    if (l.workout_type !== 'run') continue
    if (!dates.includes(l.workout_date)) continue
    const d = parseFloat(l.log_data?.distance ?? l.log_data?.runLog?.distance)
    if (!isNaN(d)) total += d
  }
  return Math.round(total * 10) / 10
}

function logSummary(log: any): string {
  const d = log.log_data ?? {}
  if (log.workout_type === 'run') {
    const r = d.runLog ?? {}
    const dist = r.distance || d.distance
    const dur = r.duration || d.duration
    const pace = r.pace || d.pace
    const parts = [dist ? `${dist} km` : null, pace ? `${pace}/km` : null, dur ? `${dur} min` : null].filter(Boolean)
    return parts.join(' · ') || 'Run logged'
  }
  if (log.workout_type === 'lift') {
    const sets = d.logs ? Object.values(d.logs).reduce((acc: number, ex: any) => acc + (ex?.sets?.filter((s: any) => s.reps || s.weight).length ?? 0), 0) : 0
    return sets > 0 ? `${sets} sets logged · ${d.unit ?? 'lbs'}` : 'Strength session'
  }
  if (log.workout_type === 'hyrox') {
    const t = d.hyroxLog?.['Total time']
    return t ? `Total ${t}` : 'Hyrox session'
  }
  return 'Session complete'
}

function coachProse(comment: string): string {
  return (comment || '').split('[')[0].trim()
}

// Consecutive days ending today (or yesterday, as grace before today's session)
// with at least one completed workout.
function computeStreak(completedDates: string[]): number {
  const set = new Set(completedDates)
  const iso = isoLocal
  const d = new Date()
  if (!set.has(iso(d))) d.setDate(d.getDate() - 1)
  let streak = 0
  while (set.has(iso(d))) { streak++; d.setDate(d.getDate() - 1) }
  return streak
}

const RUN_PB_DISTANCES = [
  { key: '5k', label: '5K', d: 5 },
  { key: '10k', label: '10K', d: 10 },
  { key: '15k', label: '15K', d: 15 },
  { key: '20k', label: '20K', d: 20 },
  { key: 'half', label: 'Half Marathon', d: 21.1 },
  { key: '30k', label: '30K', d: 30 },
  { key: 'marathon', label: 'Marathon', d: 42.2 },
  { key: 'ultra50', label: 'Ultra 50K', d: 50 },
  { key: 'ultra100', label: 'Ultra 100K', d: 100 },
]

const COMPOUND_LIFTS: { key: string; label: string; test: (n: string) => boolean }[] = [
  { key: 'squat', label: 'Squat', test: n => /squat/.test(n) && !/(split|bulgarian|goblet|single|pistol)/.test(n) },
  { key: 'bench', label: 'Bench Press', test: n => /bench/.test(n) },
  { key: 'deadlift', label: 'Deadlift', test: n => /dead\s?lift|trap\s?bar/.test(n) },
  { key: 'ohp', label: 'Overhead Press', test: n => /(overhead|shoulder|military|strict)\s*press|\bohp\b/.test(n) },
  { key: 'row', label: 'Barbell Row', test: n => /\brow\b/.test(n) && !/erg|rowing machine/.test(n) },
]

function fmtClock(mins: number): string {
  const h = Math.floor(mins / 60), m = Math.floor(mins % 60), s = Math.round((mins % 1) * 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
function fmtPBDate(d: string): string {
  return d ? new Date(d + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

// Best (fastest) time logged at each standard distance — a run is matched to the
// closest standard within 8% of its logged distance.
function computeRunPBs(logs: any[]): Record<string, any> {
  const runs = logs.filter(l => l.workout_type === 'run').map(l => {
    const r = l.log_data?.runLog ?? {}
    const dist = parseFloat(r.distance ?? l.log_data?.distance)
    const dur = parseFloat(r.duration ?? l.log_data?.duration)
    return { dist, dur, date: l.workout_date, pace: r.pace ?? l.log_data?.pace, id: l.id }
  }).filter(x => x.dist > 0 && x.dur > 0)
  const best: Record<string, any> = {}
  for (const x of runs) {
    let closest = RUN_PB_DISTANCES[0]
    for (const s of RUN_PB_DISTANCES) if (Math.abs(s.d - x.dist) < Math.abs(closest.d - x.dist)) closest = s
    // Only count a run toward a distance PB if it was genuinely run at (close to) that
    // distance — within 4%. Each run feeds at most ONE bucket; runs are never combined.
    if (Math.abs(x.dist - closest.d) / closest.d > 0.04) continue
    if (!best[closest.key] || x.dur < best[closest.key].dur) best[closest.key] = x
  }
  return best
}

// Heaviest single set logged for each compound lift, with the date achieved.
function computeLiftPBs(logs: any[]): Record<string, any> {
  const best: Record<string, any> = {}
  for (const l of logs) {
    if (l.workout_type !== 'lift') continue
    const unit = l.log_data?.unit ?? 'lbs'
    const exMap = l.log_data?.logs ?? {}
    for (const [exName, exData] of Object.entries<any>(exMap)) {
      const comp = COMPOUND_LIFTS.find(c => c.test(exName.toLowerCase()))
      if (!comp) continue
      let topW = 0, topReps = ''
      for (const s of exData?.sets ?? []) {
        const w = parseFloat(s.weight) || 0
        if (w > topW) { topW = w; topReps = s.reps || '' }
      }
      if (topW <= 0) continue
      if (!best[comp.key] || topW > best[comp.key].weight) best[comp.key] = { weight: topW, reps: topReps, unit, date: l.workout_date, exercise: exName, id: l.id }
    }
  }
  return best
}

// Hyrox times are logged as free text. Parse only clock-formatted values (must contain
// a colon) into seconds so rep counts like "85" aren't mistaken for a time.
function clockToSec(v: string): number | null {
  if (!v || !v.includes(':')) return null
  const parts = v.trim().split(':').map(Number)
  if (parts.some(p => isNaN(p) || p < 0)) return null
  let s = 0
  for (const p of parts) s = s * 60 + p
  return s > 0 ? s : null
}
function secToClock(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

// Canonical display order for station PBs (matches the logger's station names).
const HYROX_STATIONS = ['Run', 'SkiErg', 'Sled Push', 'Sled Pull', 'Burpee Broad Jump', 'Row', 'Farmers Carry', 'Sandbag Lunges', 'Wall Balls']

// Fastest logged time for the overall race, the running split, and each station. Stations
// are now logged as structured sets ({ sets:[{time,weight}] }) — we take the best set time.
function computeHyroxPBs(logs: any[]): Record<string, { sec: number; date: string; id: string }> {
  const best: Record<string, { sec: number; date: string; id: string }> = {}
  const consider = (k: string, sec: number | null, date: string, id: string) => {
    if (sec == null || sec <= 0) return
    if (!best[k] || sec < best[k].sec) best[k] = { sec, date, id }
  }
  for (const l of logs) {
    if (l.workout_type !== 'hyrox') continue
    const hl = l.log_data?.hyroxLog ?? {}
    for (const [k, v] of Object.entries<any>(hl)) {
      if (k === 'Total time' || k === 'Running time') { consider(k, clockToSec(typeof v === 'string' ? v : ''), l.workout_date, l.id); continue }
      if (v && Array.isArray(v.sets)) {
        const times = v.sets.map((s: any) => clockToSec(s?.time ?? '')).filter((x: number | null): x is number => x != null)
        if (times.length) consider(k, Math.min(...times), l.workout_date, l.id)
      } else if (typeof v === 'string') {
        consider(k, clockToSec(v), l.workout_date, l.id)
      }
    }
  }
  return best
}

export default function DashboardPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [profile, setProfile] = useState<any>(null)
  const [plan, setPlan] = useState<any>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [moveTarget, setMoveTarget] = useState<any>(null)
  const [selectedDay, setSelectedDay] = useState('')
  const [activeTab, setActiveTab] = useState<'home'|'history'|'pbs'|'more'>('home')
  const [expandedLog, setExpandedLog] = useState<number | null>(null)
  const [historyLimit, setHistoryLimit] = useState(50)
  const [editProfile, setEditProfile] = useState(false)
  const [editName, setEditName] = useState('')
  const [editRaceDate, setEditRaceDate] = useState('')
  const [completedDays, setCompletedDays] = useState<string[]>([])
  const [allLogs, setAllLogs] = useState<any[]>([])
  // Adaptive coach card state. dismissedAdjust starts true so the card never
  // flashes before localStorage has been checked.
  const [adjustState, setAdjustState] = useState<'idle'|'loading'|'done'|'error'>('idle')
  const [adjustSummary, setAdjustSummary] = useState('')
  const [dismissedAdjust, setDismissedAdjust] = useState(true)
  const [newBadges, setNewBadges] = useState<Badge[]>([])
  const [recapDismissed, setRecapDismissed] = useState(true)
  // Strava import inbox: recent Strava activities not yet linked to a IBM Fitness log.
  const [stravaInbox, setStravaInbox] = useState<any[]>([])
  const [stravaNeedsReconnect, setStravaNeedsReconnect] = useState(false)
  const [dismissedStrava, setDismissedStrava] = useState<Set<string>>(new Set())
  const [importSel, setImportSel] = useState<Record<string, string>>({})
  const [importingId, setImportingId] = useState<string | null>(null)
  const today = new Date().toLocaleDateString('en', { weekday: 'short' })

  useEffect(() => { if (!loading && !user) router.push('/login') }, [user, loading, router])
  useEffect(() => { setSelectedDay(today) }, [today])

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('*').eq('id', user.id).single().then(({ data }) => setProfile(data))
    supabase.from('training_plans').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).single().then(({ data }) => { if (data) setPlan(data) })
    supabase.from('workout_logs').select('*').eq('user_id', user.id).eq('completed', true)
      .order('workout_date', { ascending: false }).limit(1000)
      .then(({ data }) => {
        if (data) {
          setAllLogs(data)
          setCompletedDays(data.map((d: any) => d.workout_date))
        }
      })
  }, [user])

  // Pull recent Strava activities for the import inbox (no-op if not connected).
  useEffect(() => {
    if (!user) return
    try { setDismissedStrava(new Set(JSON.parse(localStorage.getItem('mb-strava-dismissed') || '[]'))) } catch { /* noop */ }
    ;(async () => {
      try {
        const { data: { session: s } } = await supabase.auth.getSession()
        if (!s) return
        const res = await fetch('/api/strava/activities', { headers: { Authorization: `Bearer ${s.access_token}` } })
        const d = await res.json()
        if (d.needsReconnect) setStravaNeedsReconnect(true)
        setStravaInbox(Array.isArray(d.activities) ? d.activities : [])
      } catch { /* Strava is optional */ }
    })()
  }, [user])

  // When a plan starts in the future (e.g. "start next Monday" chosen mid-week),
  // open the dashboard on Week 1 rather than the empty current week.
  useEffect(() => {
    const sm = plan?.plan_data?.startMonday
    if (!sm) return
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const bd = Math.round((Date.parse(iso(getWeekDates(0)[0])) - Date.parse(sm)) / (7 * 86400000))
    if (bd < 0) setWeekOffset(-bd)
  }, [plan])

  const allWeeks = plan?.plan_data?.weeks ?? []
  const totalWeeks = allWeeks.length

  // Plan anchoring: align plan weeks to the calendar from the stored Week-1 Monday.
  const localISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  // Monday of the week containing an ISO date (local time).
  const mondayOfISO = (s: string) => {
    const d = new Date(s + 'T00:00:00'); const dow = d.getDay()
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); return localISO(d)
  }
  // Prefer the stored startMonday. Legacy plans created before anchoring existed have
  // no startMonday — without an anchor baseDelta was always 0, so the dashboard kept
  // recomputing "Week 1 = this week" every Monday and the week number never advanced.
  // Fall back to the Monday of the row's start_date so legacy plans count forward too.
  const startMondayStr: string | null = plan?.plan_data?.startMonday ?? (plan?.start_date ? mondayOfISO(plan.start_date) : null)
  const activeFromStr: string | null = plan?.plan_data?.activeFrom ?? null
  const weekDates = getWeekDates(weekOffset)
  const weekDateStrs = weekDates.map(localISO)
  // baseDelta = plan-week index of the CURRENT calendar week (0 ⇒ Week 1 is this week).
  const baseDelta = startMondayStr ? Math.round((Date.parse(localISO(getWeekDates(0)[0])) - Date.parse(startMondayStr)) / (7 * 86400000)) : 0
  const rawWeekIndex = baseDelta + weekOffset
  const beforePlan = rawWeekIndex < 0
  // afterPlan = the calendar has moved past the final plan week. Without this the week
  // index clamps to the last week forever, repeating it every week instead of ending.
  const afterPlan = totalWeeks > 0 && rawWeekIndex > totalWeeks - 1
  const currentWeekIndex = Math.max(0, Math.min(rawWeekIndex, totalWeeks - 1))
  const currentWeek = allWeeks[currentWeekIndex]
  // A day in Week 1 that falls before the plan's active-from date is "skipped".
  const isSkippedDay = (i: number) => !!activeFromStr && !beforePlan && rawWeekIndex === 0 && i >= 0 && weekDateStrs[i] < activeFromStr
  const sessions = (beforePlan || afterPlan) ? [] : (currentWeek?.sessions ?? [])
  const isCurrentWeek = weekOffset === 0

  const getSessionsForDay = (day: string) => sessions.filter((s: any) => s.day === day)
  const selectedSessions = getSessionsForDay(selectedDay)
  const selectedSkipped = isSkippedDay(DAYS.indexOf(selectedDay))
  const daysToRace = profile?.goal_race_date ? Math.ceil((new Date(profile.goal_race_date).getTime() - Date.now()) / 86400000) : null
  // Completion is tracked PER SESSION, keyed by (date, title) — not per day — so a
  // single log no longer marks every session that day (or a same-named session in
  // another week) as done.
  const completedKeys = new Set(allLogs.map((l: any) => `${l.workout_date}::${String(l.title || '').trim().toLowerCase()}`))
  const isSessionDone = (dateStr: string, title: string) => completedKeys.has(`${dateStr}::${String(title || '').trim().toLowerCase()}`)
  // Lookup of the actual logged workout for a (date, title) — used so a completed hero
  // card shows what was really logged, not the plan's target (which can differ).
  const logByKey = new Map<string, any>(allLogs.map((l: any) => [`${l.workout_date}::${String(l.title || '').trim().toLowerCase()}`, l]))
  // Sessions on non-skipped days only — the fair denominator for this week's progress.
  const weekSessions = sessions.filter((s: any) => !isSkippedDay(DAYS.indexOf(s.day)))
  const weekTrainable = weekSessions.filter((s: any) => s.type !== 'rest')
  const completedThisWeek = weekTrainable.filter((s: any) => isSessionDone(weekDateStrs[DAYS.indexOf(s.day)], s.title)).length
  const projectedTimes = calcProjectedTimes(allLogs)
  const plannedKm = parsePlannedKm(weekSessions)
  const loggedKm = loggedKmForWeek(allLogs, weekDates)
  const timeGoal = plan?.plan_data?.timeGoal ?? ''
  const runPBs = computeRunPBs(allLogs)
  const liftPBs = computeLiftPBs(allLogs)
  const hyroxPBs = computeHyroxPBs(allLogs)
  const streak = computeStreak(completedDays)

  // ── Achievements: computed live from logs; fresh unlocks celebrated once. ──
  const badges = computeBadges(allLogs, streak)
  const earnedBadges = badges.filter(b => b.earned)
  useEffect(() => {
    if (allLogs.length === 0) return
    setNewBadges(unseenBadges(computeBadges(allLogs, computeStreak(allLogs.map((d: any) => d.workout_date)))))
  }, [allLogs])
  const dismissNewBadges = () => { markBadgesSeen(badges.filter(b => b.earned)); setNewBadges([]) }

  // ── Weekly recap: last calendar week's numbers, shareable as an image. ──
  const lastWeekDates = getWeekDates(-1)
  const lastWeekStrs = lastWeekDates.map(isoLocal)
  const lwLogs = allLogs.filter((l: any) => lastWeekStrs.includes(l.workout_date))
  const lwKm = loggedKmForWeek(allLogs, lastWeekDates)
  const recapKey = `mb-recap-dismiss-${lastWeekStrs[0]}`
  useEffect(() => {
    try { setRecapDismissed(!!localStorage.getItem(recapKey)) } catch { setRecapDismissed(false) }
  }, [recapKey])
  const dismissRecap = () => { try { localStorage.setItem(recapKey, '1') } catch { /* noop */ } setRecapDismissed(true) }

  const shareRecap = async () => {
    const themeColors = getComputedStyle(document.documentElement)
    const bg = themeColors.getPropertyValue('--bg').trim() || '#0a0b0d'
    const accent = themeColors.getPropertyValue('--accent').trim() || '#d8f64a'
    const text = themeColors.getPropertyValue('--text').trim() || '#f5f6f7'
    const muted = themeColors.getPropertyValue('--text-muted').trim() || '#9aa1aa'
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1080
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 1080, 1080)
    ctx.fillStyle = accent; ctx.fillRect(80, 96, 64, 64)
    ctx.fillStyle = bg; ctx.font = '600 24px -apple-system, system-ui, sans-serif'; ctx.fillText('MB', 94, 136)
    ctx.fillStyle = text; ctx.font = '600 56px -apple-system, system-ui, sans-serif'; ctx.fillText('IBM Fitness', 168, 142)
    ctx.fillStyle = muted; ctx.font = '400 40px -apple-system, system-ui, sans-serif'
    ctx.fillText(`Week of ${lastWeekDates[0].toLocaleDateString('en', { day: 'numeric', month: 'short' })}`, 80, 240)
    const stats: [string, string][] = [
      [String(lwLogs.length), lwLogs.length === 1 ? 'session' : 'sessions'],
      [`${lwKm}`, 'km run'],
      [String(streak), 'day streak'],
    ]
    stats.forEach(([v, l], i) => {
      const y = 420 + i * 190
      ctx.fillStyle = accent; ctx.font = '700 110px ui-monospace, Menlo, monospace'; ctx.fillText(v, 80, y)
      ctx.fillStyle = muted; ctx.font = '400 44px -apple-system, system-ui, sans-serif'; ctx.fillText(l, 90 + ctx.measureText(v).width + 110, y)
    })
    ctx.fillStyle = muted; ctx.font = '400 34px -apple-system, system-ui, sans-serif'
    ctx.fillText('Run far. Lift heavy. Race hard.', 80, 1000)
    const blob: Blob | null = await new Promise(r => c.toBlob(r, 'image/png'))
    if (!blob) return
    const file = new File([blob], 'ibm-fitness-week.png', { type: 'image/png' })
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'My training week' }); return }
    } catch { /* fall through to download */ }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ibm-fitness-week.png'; a.click()
  }

  // ── Strava import inbox helpers ──
  // Planned (non-rest, not-yet-logged) sessions for an arbitrary calendar date.
  const sessionsForDate = (dateStr: string) => {
    if (!startMondayStr || totalWeeks === 0) return []
    const wi = Math.round((Date.parse(mondayOfISO(dateStr)) - Date.parse(startMondayStr)) / (7 * 86400000))
    if (wi < 0 || wi > totalWeeks - 1) return []
    const d = new Date(dateStr + 'T00:00:00')
    const abbrev = DAYS[(d.getDay() + 6) % 7]
    return (allWeeks[wi].sessions ?? []).filter((s: any) => s.day === abbrev && s.type !== 'rest' && !isSessionDone(dateStr, s.title))
  }

  // Activities worth prompting about: mappable type, not already linked to a log,
  // not dismissed on this device. Each one prompts independently, so a run AND a
  // lift on the same day both get their own card.
  const linkedStravaIds = new Set(allLogs.map((l: any) => String(l.log_data?.stravaActivityId ?? '')).filter(Boolean))
  const stravaCandidates = stravaInbox.filter(a => !linkedStravaIds.has(String(a.id)) && !dismissedStrava.has(String(a.id))).slice(0, 10)
  // Grouped by calendar date — cards render ON their day, not as a global pile.
  const stravaByDate = new Map<string, any[]>()
  for (const a of stravaCandidates) { const arr = stravaByDate.get(a.date) ?? []; arr.push(a); stravaByDate.set(a.date, arr) }
  const selectedDateStr = weekDateStrs[DAYS.indexOf(selectedDay)]
  const selectedStrava = stravaByDate.get(selectedDateStr) ?? []

  // Jump the week strip to an activity's day (it may be in a previous week).
  const goToStravaActivity = (a: any) => {
    const off = Math.round((Date.parse(mondayOfISO(a.date)) - Date.parse(localISO(getWeekDates(0)[0]))) / (7 * 86400000))
    setWeekOffset(off)
    const d = new Date(a.date + 'T00:00:00')
    setSelectedDay(DAYS[(d.getDay() + 6) % 7])
  }

  const dismissStravaActivity = (id: any) => {
    const next = new Set(dismissedStrava); next.add(String(id))
    setDismissedStrava(next)
    try { localStorage.setItem('mb-strava-dismissed', JSON.stringify([...next])) } catch { /* noop */ }
  }

  const importStravaActivity = async (a: any) => {
    if (!user) return
    setImportingId(String(a.id))
    try {
      const sel = importSel[String(a.id)] ?? sessionsForDate(a.date)[0]?.title ?? ''
      const target = sel ? sessionsForDate(a.date).find((s: any) => s.title === sel) : null
      const title = target?.title ?? a.name
      const wtype = target?.type ?? a.type
      const runLog = a.type === 'run' ? {
        distance: a.distanceKm != null ? String(a.distanceKm) : '',
        duration: a.movingMin != null ? String(a.movingMin) : '',
        pace: a.paceMinKm ?? '',
        heartRate: a.avgHr != null ? String(a.avgHr) : '',
        cadence: a.avgCadence != null ? String(a.avgCadence) : '',
      } : null
      const log_data: any = {
        logs: {},
        unit: 'kg',
        session: target ?? { day: DAYS[(new Date(a.date + 'T00:00:00').getDay() + 6) % 7], type: wtype, title, details: `Imported from Strava (${a.sportType})`, duration: a.movingMin ?? 0 },
        coachComment: null,
        feel: null,
        stravaActivityId: a.id,
        source: 'strava-import',
        runLog,
        distance: a.type === 'run' ? a.distanceKm : null,
        duration: a.movingMin ?? null,
        pace: a.type === 'run' ? a.paceMinKm : null,
        avgHr: a.avgHr ?? null,
      }
      const { data: ins } = await supabase.from('workout_logs').insert({
        user_id: user.id, workout_date: a.date, workout_type: wtype, title, completed: true, log_data,
      }).select('*').single()
      if (ins) {
        setAllLogs(prev => [ins, ...prev])
        setCompletedDays(prev => [...prev, ins.workout_date])
      }
    } finally { setImportingId(null) }
  }

  // ── Adaptive coach: propose easing the REAL next plan week when recent logs show
  // struggle (hard-feeling sessions stacking up, or run paces repeatedly missed).
  // The athlete always approves — nothing is changed silently.
  const struggle = detectStruggle(allLogs)
  const nextWeekIndex = baseDelta + 1 // independent of the week being browsed
  const nextWeekAdjusted = !!allWeeks[nextWeekIndex]?.adjusted
  const canAdjust = totalWeeks > 0 && baseDelta >= 0 && baseDelta <= totalWeeks - 1 && nextWeekIndex <= totalWeeks - 1
  const showAdjustCard = canAdjust && (adjustState !== 'idle' || (struggle.triggered && !nextWeekAdjusted && !dismissedAdjust))

  useEffect(() => {
    if (!plan) return
    try { setDismissedAdjust(!!localStorage.getItem(`mb-adjust-dismiss-${plan.id}-${nextWeekIndex}`)) } catch { setDismissedAdjust(false) }
  }, [plan, nextWeekIndex])

  const dismissAdjust = () => {
    try { if (plan) localStorage.setItem(`mb-adjust-dismiss-${plan.id}-${nextWeekIndex}`, '1') } catch { /* noop */ }
    setDismissedAdjust(true)
  }

  const applyAdjustment = async () => {
    if (!user || !plan || !allWeeks[nextWeekIndex]) return
    setAdjustState('loading')
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const res = await fetch('/api/adjust-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {}),
        },
        body: JSON.stringify({ week: allWeeks[nextWeekIndex], reasons: struggle.reasons, evidence: struggle.evidence, profile }),
      })
      const data = await res.json()
      if (!res.ok || !Array.isArray(data.sessions)) throw new Error(data.error || 'adjustment failed')
      const newWeeks = allWeeks.map((w: any, i: number) =>
        i === nextWeekIndex ? { ...w, sessions: data.sessions, adjusted: { date: localISO(new Date()), summary: data.summary } } : w)
      const newPlanData = { ...plan.plan_data, weeks: newWeeks }
      await supabase.from('training_plans').update({ plan_data: newPlanData }).eq('id', plan.id)
      setPlan({ ...plan, plan_data: newPlanData })
      setAdjustSummary(data.summary || 'Next week eased.')
      setAdjustState('done')
    } catch { setAdjustState('error') }
  }

  // Move a single session to another weekday in the CURRENT week — for anyone whose
  // schedule shifts (e.g. shift workers). A rest on the destination day is replaced.
  const moveSession = async (session: any, newDay: string) => {
    if (!user || !plan || newDay === session.day) { setMoveTarget(null); return }
    const weeks = plan.plan_data?.weeks ?? []
    const wi = currentWeekIndex
    if (!weeks[wi]) { setMoveTarget(null); return }
    let matched = false
    const moved = (weeks[wi].sessions ?? []).map((s: any) => {
      if (!matched && s.day === session.day && s.title === session.title && s.type === session.type && s.details === session.details) { matched = true; return { ...s, day: newDay } }
      return s
    })
    const cleaned = moved.filter((s: any) => !(s.type === 'rest' && s.day === newDay))
    const newWeeks = weeks.map((w: any, i: number) => i === wi ? { ...w, sessions: cleaned } : w)
    const newPlanData = { ...plan.plan_data, weeks: newWeeks }
    await supabase.from('training_plans').update({ plan_data: newPlanData }).eq('id', plan.id)
    setPlan({ ...plan, plan_data: newPlanData })
    setMoveTarget(null)
    setSelectedDay(newDay)
  }

  // Re-anchor the plan so Week 1 starts on the CURRENT calendar Monday — fixes a plan that
  // was set to start next week, so today maps to the right day.
  const startPlanThisWeek = async () => {
    if (!user || !plan) return
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const dow = now.getDay()
    const monday = new Date(now); monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1))
    const startMonday = iso(monday)
    const newPlanData = { ...plan.plan_data, startMonday, activeFrom: startMonday }
    await supabase.from('training_plans').update({ plan_data: newPlanData, start_date: startMonday }).eq('id', plan.id)
    setPlan({ ...plan, plan_data: newPlanData })
    setWeekOffset(0)
  }

  const deleteLog = async (id: string) => {
    if (!user || !id) return
    if (typeof window !== 'undefined' && !window.confirm('Delete this logged workout? This cannot be undone.')) return
    await supabase.from('workout_logs').delete().eq('id', id)
    const remaining = allLogs.filter(l => l.id !== id)
    setAllLogs(remaining)
    setCompletedDays(remaining.map((d: any) => d.workout_date))
    setExpandedLog(null)
  }

  // Reset a single personal best by removing the workout that set it. The next-best
  // logged effort for that distance/lift then becomes the new PB (PBs are derived live).
  const resetPB = async (id: string, label: string) => {
    if (!user || !id) return
    if (typeof window !== 'undefined' && !window.confirm(`Reset your ${label} PB? This deletes the workout that set it (your next-best effort becomes the PB).`)) return
    await supabase.from('workout_logs').delete().eq('id', id)
    const remaining = allLogs.filter(l => l.id !== id)
    setAllLogs(remaining)
    setCompletedDays(remaining.map((d: any) => d.workout_date))
  }

  const saveProfile = async () => {
    if (!user) return
    await supabase.from('profiles').upsert({ id: user.id, full_name: editName, goal_race_date: editRaceDate || null })
    setProfile((p: any) => ({ ...(p ?? {}), full_name: editName, goal_race_date: editRaceDate || null }))
    setEditProfile(false)
  }

  const resetRecords = async () => {
    if (!user) return
    if (typeof window !== 'undefined' && !window.confirm('Reset all records? This permanently deletes your logged workouts — your Personal Bests, history and lifetime stats are all calculated from them. This cannot be undone.')) return
    await supabase.from('workout_logs').delete().eq('user_id', user.id)
    setAllLogs([])
    setCompletedDays([])
    setExpandedLog(null)
  }

  const isToday = selectedDay === today && isCurrentWeek
  const selectedLabel = isToday ? 'Today' : `${selectedDay === 'Mon' ? 'Monday' : selectedDay === 'Tue' ? 'Tuesday' : selectedDay === 'Wed' ? 'Wednesday' : selectedDay === 'Thu' ? 'Thursday' : selectedDay === 'Fri' ? 'Friday' : selectedDay === 'Sat' ? 'Saturday' : 'Sunday'}`

  // A day shows the ✓ only when ALL its (non-rest) sessions are individually logged.
  function isDayCompleted(day: string, i: number) {
    const ss = getSessionsForDay(day).filter((s: any) => s.type !== 'rest')
    return ss.length > 0 && ss.every((s: any) => isSessionDone(weekDateStrs[i], s.title))
  }
  function getDots(day: string) { return getSessionsForDay(day).map((s: any) => s.type) }

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening'
  const firstName = profile?.full_name?.split(' ')[0] ?? 'Athlete'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 72 }}>
      <nav style={{ background: 'var(--bg-nav)', borderBottom: '0.5px solid var(--border)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'var(--accent-fg)', fontSize: 11, fontWeight: 500, letterSpacing: '-0.5px' }}>MB</span>
          </div>
          <span style={{ color: 'var(--text)', fontWeight: 500, fontSize: 17, letterSpacing: '-0.3px' }}>IBM Fitness</span>
        </div>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-card)', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          onClick={() => setActiveTab('more')}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>{firstName.slice(0,2).toUpperCase()}</span>
        </div>
      </nav>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '20px 16px 24px' }}>

        {activeTab === 'home' && (
          <div key="tab-home" className="mb-animate">
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                {new Date().toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              <h1 style={{ fontSize: 30, fontWeight: 500, color: 'var(--text)', marginBottom: 12, letterSpacing: '-0.5px', lineHeight: 1.1 }}>
                {greeting},<br />{firstName}
              </h1>
              {(profile?.goal_race || timeGoal) && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '6px 12px', marginBottom: 16 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--run)' }} />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
                    {profile?.goal_race?.replace(/_/g,' ')}
                    {timeGoal && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>{timeGoal}</span>}
                    {daysToRace !== null && <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>· {daysToRace}d</span>}
                  </span>
                </div>
              )}
              {streak > 0 && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '6px 12px', marginBottom: 16, marginLeft: (profile?.goal_race || timeGoal) ? 8 : 0 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--hyrox)' }} />
                  <span className="mb-num" style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{streak}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>day{streak > 1 ? 's' : ''} streak</span>
                </div>
              )}
              {totalWeeks > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                      {afterPlan ? `Plan complete · ${totalWeeks} weeks done 🎉` : beforePlan ? `Plan starts ${new Date((activeFromStr ?? '') + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' })}` : `Week ${currentWeekIndex + 1} of ${totalWeeks} · ${currentWeek?.focus ?? ''}`}
                    </span>
                    {!beforePlan && !afterPlan && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{completedThisWeek}/{weekTrainable.length}</span>}
                  </div>
                  <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 20 }}>
                    <div style={{ height: '100%', width: `${weekTrainable.length > 0 ? (completedThisWeek/weekTrainable.length)*100 : 0}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 0.6s cubic-bezier(0.22, 1, 0.36, 1)' }} />
                  </div>
                </>
              )}
            </div>

            {/* Weekly distance */}
            {totalWeeks > 0 && plannedKm > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14, padding: '12px 16px', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 3 }}>Distance this week</div>
                  <div className="mb-num" style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>
                    {loggedKm}<span style={{ color: 'var(--text-faint)', fontSize: 14, fontWeight: 500 }}> of {plannedKm} km</span>
                  </div>
                </div>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: `conic-gradient(var(--run) ${Math.min(plannedKm > 0 ? (loggedKm/plannedKm)*360 : 0, 360)}deg, var(--border) 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="mb-num" style={{ fontSize: 10, fontWeight: 600, color: 'var(--run)' }}>{plannedKm > 0 ? Math.min(Math.round((loggedKm/plannedKm)*100), 999) : 0}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* New badge celebration */}
            {newBadges.length > 0 && (
              <div className="mb-animate-scale" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--accent)', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 14 }}>🎉</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    {newBadges.length === 1 ? 'Badge unlocked' : `${newBadges.length} badges unlocked`}
                  </span>
                  <button onClick={dismissNewBadges} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: 2 }}>×</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {newBadges.slice(0, 6).map(b => (
                    <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '6px 12px' }}>
                      <span style={{ fontSize: 15 }}>{b.emoji}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{b.name}</span>
                    </div>
                  ))}
                  {newBadges.length > 6 && <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>+{newBadges.length - 6} more in Bests</span>}
                </div>
              </div>
            )}

            {/* Weekly recap — last week's numbers, shareable */}
            {lwLogs.length > 0 && !recapDismissed && (
              <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Last week</span>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{fmt(lastWeekDates[0])} – {fmt(lastWeekDates[6])}</span>
                  <button onClick={dismissRecap} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: 2 }}>×</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 10 }}>
                  {([[String(lwLogs.length), lwLogs.length === 1 ? 'session' : 'sessions'], [`${lwKm}`, 'km run'], [String(streak), 'day streak']] as [string, string][]).map(([v, l]) => (
                    <div key={l} style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
                      <div className="mb-num" style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>{v}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>{l}</div>
                    </div>
                  ))}
                </div>
                <button onClick={shareRecap}
                  style={{ width: '100%', background: 'var(--bg)', color: 'var(--text)', border: '0.5px solid var(--border-strong)', borderRadius: 10, padding: '9px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Share as image
                </button>
              </div>
            )}

            {/* Strava import inbox — activities recorded on Strava, offered as logs here */}
            {stravaNeedsReconnect && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
                <span style={{ fontSize: 14 }}>⚠️</span>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)' }}>Strava importing needs an updated permission — reconnect once to enable it.</span>
                <button onClick={() => router.push('/connections')}
                  style={{ background: '#fc4c02', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>Reconnect</button>
              </div>
            )}
            {/* Compact pointer to pending Strava imports (cards live on their day) */}
            {stravaCandidates.length > 0 && selectedStrava.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14, padding: '11px 14px', marginBottom: 14 }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: '#fc4c02', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>S</span>
                </div>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)' }}>
                  {stravaCandidates.length} Strava {stravaCandidates.length === 1 ? 'activity' : 'activities'} ready to import
                </span>
                <button onClick={() => goToStravaActivity(stravaCandidates[0])}
                  style={{ background: 'transparent', color: 'var(--accent)', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>Review ›</button>
              </div>
            )}

            {/* Adaptive coach — proposes easing next week when recent sessions look like overreaching */}
            {showAdjustCard && (
              <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-strong)', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14 }}>🤖</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Coach check-in</span>
                  {adjustState === 'idle' && (
                    <button onClick={dismissAdjust} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: 2 }}>×</button>
                  )}
                </div>
                {adjustState === 'done' ? (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--hyrox)', fontWeight: 600 }}>✓ Week {nextWeekIndex + 1} adjusted.</span> {adjustSummary}
                  </p>
                ) : (
                  <>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
                      {struggle.reasons.join('. ')}. I can ease Week {nextWeekIndex + 1} — trim some volume and set paces you can actually hold — so you recover and stay on track.
                    </p>
                    {adjustState === 'error' && (
                      <p style={{ fontSize: 11, color: '#cc4433', marginBottom: 8 }}>Couldn&apos;t generate the adjustment — your plan is unchanged. Try again.</p>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={applyAdjustment} disabled={adjustState === 'loading'}
                        style={{ flex: 1, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 10, padding: '10px 12px', fontSize: 12, fontWeight: 600, cursor: adjustState === 'loading' ? 'default' : 'pointer', opacity: adjustState === 'loading' ? 0.7 : 1 }}>
                        {adjustState === 'loading' ? 'Adjusting…' : `Ease Week ${nextWeekIndex + 1}`}
                      </button>
                      <button onClick={dismissAdjust} disabled={adjustState === 'loading'}
                        style={{ flex: 1, background: 'transparent', color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                        Keep as planned
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Plan starts in the future — offer to re-anchor to this week */}
            {totalWeeks > 0 && baseDelta < 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-card)', border: '0.5px solid var(--accent)', borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>This plan starts {new Date(startMondayStr + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>That&apos;s why today shows as upcoming. Start it this week instead?</div>
                </div>
                <button onClick={startPlanThisWeek} style={{ background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>Start this week</button>
              </div>
            )}

            {/* Week navigator */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <button onClick={() => setWeekOffset(w => w - 1)} disabled={rawWeekIndex <= 0}
                style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 8, width: 32, height: 32, fontSize: 15, color: rawWeekIndex <= 0 ? 'var(--text-faint)' : 'var(--text-muted)', cursor: rawWeekIndex <= 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: rawWeekIndex <= 0 ? 0.4 : 1 }}>‹</button>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.2px' }}>
                  {afterPlan ? 'Plan complete' : beforePlan ? 'Before plan starts' : isCurrentWeek ? `This week · Week ${currentWeekIndex + 1}` : `Week ${currentWeekIndex + 1}`}
                  {!beforePlan && !afterPlan && currentWeek?.adjusted && (
                    <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--hyrox)', border: '0.5px solid var(--hyrox)', borderRadius: 8, padding: '1px 6px', verticalAlign: 'middle' }}>eased</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 1 }}>{fmt(weekDates[0])} – {fmt(weekDates[6])}</div>
              </div>
              <button onClick={() => setWeekOffset(w => w + 1)} disabled={rawWeekIndex >= totalWeeks - 1}
                style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 8, width: 32, height: 32, fontSize: 15, color: rawWeekIndex >= totalWeeks - 1 ? 'var(--text-faint)' : 'var(--text-muted)', cursor: rawWeekIndex >= totalWeeks - 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: rawWeekIndex >= totalWeeks - 1 ? 0.4 : 1 }}>›</button>
            </div>

            {/* Week strip — selects day inline */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 20 }}>
              {DAYS.map((day, i) => {
                const isSel = day === selectedDay
                const isTodayCell = day === today && isCurrentWeek
                const completed = isDayCompleted(day, i)
                const skipped = isSkippedDay(i)
                const dots = getDots(day)
                return (
                  <div key={day} onClick={() => setSelectedDay(day)}
                    style={{ position: 'relative', borderRadius: 10, padding: '7px 2px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', border: `${isSel ? '1.5px' : '0.5px'} solid ${isSel ? 'var(--accent)' : isTodayCell ? 'var(--border-strong)' : 'var(--border)'}`, background: isSel ? 'var(--bg-card)' : 'transparent', opacity: skipped ? 0.45 : 1, transition: 'all 0.15s' }}>
                    {stravaByDate.has(weekDateStrs[i]) && <div title="Strava activity to import" style={{ position: 'absolute', top: 3, right: 3, width: 6, height: 6, borderRadius: '50%', background: '#fc4c02' }} />}
                    <span style={{ fontSize: 9, fontWeight: 500, color: isTodayCell ? 'var(--accent)' : 'var(--text-faint)', textTransform: 'uppercase' }}>{day}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: isTodayCell ? 'var(--accent)' : isSel ? 'var(--text)' : 'var(--text-faint)' }}>{weekDates[i].getDate()}</span>
                    {skipped ? <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>–</span>
                      : completed ? <span style={{ fontSize: 10, color: 'var(--hyrox)' }}>✓</span>
                      : dots.length > 1 ? <div style={{ display: 'flex', gap: 2 }}>{dots.map((t: string, di: number) => <div key={di} style={{ width: 4, height: 4, borderRadius: '50%', background: typeDot[t] }} />)}</div>
                      : <div style={{ width: 5, height: 5, borderRadius: '50%', background: dots[0] ? typeDot[dots[0]] : 'var(--border)' }} />}
                  </div>
                )
              })}
            </div>

            {/* Selected day's sessions — the hero */}
            <div key={`${selectedDay}-${weekOffset}`} className="mb-animate" style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>
                {selectedLabel}{selectedSessions.length > 1 ? `'s sessions (${selectedSessions.length})` : "'s session"}
              </p>

              {/* Strava activities recorded this day, offered as one-tap imports */}
              {selectedStrava.map((a: any) => {
                const options = sessionsForDate(a.date)
                const sel = importSel[String(a.id)] ?? options[0]?.title ?? ''
                const stats = [a.distanceKm ? `${a.distanceKm} km` : null, a.paceMinKm ? `${a.paceMinKm}/km` : null, a.movingMin ? `${a.movingMin} min` : null, a.avgHr ? `${a.avgHr} bpm` : null].filter(Boolean).join(' · ')
                return (
                  <div key={a.id} style={{ background: 'var(--bg-card)', border: '0.5px solid #fc4c02', borderRadius: 14, padding: '14px 16px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <div style={{ width: 22, height: 22, borderRadius: 6, background: '#fc4c02', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>S</span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flex: 1 }}>{a.name}</span>
                      <button onClick={() => dismissStravaActivity(a.id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: 2 }}>×</button>
                    </div>
                    {stats && <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>{stats}</p>}
                    {options.length > 0 && (
                      <select value={sel} onChange={e => setImportSel(prev => ({ ...prev, [String(a.id)]: e.target.value }))}
                        style={{ width: '100%', background: 'var(--bg)', border: '0.5px solid var(--border)', color: 'var(--text)', borderRadius: 10, padding: '10px 12px', fontSize: 13, marginBottom: 8 }}>
                        {options.map((s: any) => <option key={s.title} value={s.title}>Count as: {s.title}</option>)}
                        <option value="">Log as extra session</option>
                      </select>
                    )}
                    <button onClick={() => importStravaActivity(a)} disabled={importingId === String(a.id)}
                      style={{ width: '100%', background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 10, padding: '10px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: importingId === String(a.id) ? 0.6 : 1 }}>
                      {importingId === String(a.id) ? 'Importing…' : options.length > 0 && sel ? 'Import & mark complete' : 'Import to IBM Fitness'}
                    </button>
                    {a.type === 'lift' && (
                      <p style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6, lineHeight: 1.4 }}>Strava only tracks time & heart rate for lifts — open the session afterwards to add your sets.</p>
                    )}
                  </div>
                )
              })}
              {afterPlan ? (
                <div style={{ background: 'var(--accent)', borderRadius: 20, padding: '32px 22px', textAlign: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>🏁</div>
                  <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent-fg)', marginBottom: 6 }}>Plan complete</p>
                  <p style={{ fontSize: 13, color: 'var(--accent-fg)', opacity: 0.85, lineHeight: 1.5, marginBottom: 18 }}>
                    You finished all {totalWeeks} weeks. Time to race, recover, or build your next block.
                  </p>
                  <button onClick={() => router.push('/onboarding')}
                    style={{ background: 'var(--accent-fg)', color: 'var(--accent)', border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                    Build my next plan
                  </button>
                </div>
              ) : beforePlan ? (
                <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '28px 20px', textAlign: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>📅</div>
                  <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>Your plan starts {new Date((activeFromStr ?? '') + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>Enjoy the rest of this week — Week 1 kicks off then. Tap › to preview it.</p>
                </div>
              ) : selectedSkipped ? (
                <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '28px 20px', textAlign: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>⏭️</div>
                  <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>Skipped</p>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>This day passed before your plan began on {new Date((activeFromStr ?? '') + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'long' })}. Your week starts from there.</p>
                </div>
              ) : selectedSessions.length > 0 ? selectedSessions.map((session: any, idx: number) => {
                const completed = session.type !== 'rest' && isSessionDone(weekDateStrs[DAYS.indexOf(selectedDay)], session.title)
                if (session.type === 'rest') {
                  return (
                    <div key={idx} style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '24px 20px', marginBottom: 10, textAlign: 'center' }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>🛌</div>
                      <h2 style={{ fontSize: 17, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>{session.title || 'Rest day'}</h2>
                      <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{session.details || 'Recovery is part of the plan.'}</p>
                    </div>
                  )
                }
                const cat = heroCategory(session)
                const heroBg = `var(--hero-${cat}, var(--accent))`
                const heroFg = `var(--hero-${cat}-fg, var(--accent-fg))`
                return (
                  <div key={idx} onClick={() => router.push(`/workout/${plan?.id}/${session.day}?session=${idx}&week=${currentWeekIndex}&date=${weekDateStrs[DAYS.indexOf(selectedDay)]}`)}
                    style={{ background: completed ? 'var(--bg-card)' : heroBg, borderRadius: 20, padding: '20px', marginBottom: 10, cursor: 'pointer', border: completed ? '0.5px solid var(--border)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', padding: '4px 8px', borderRadius: 10, background: completed ? `${typeDot[session.type]}18` : 'rgba(0,0,0,0.15)', color: completed ? typeDot[session.type] : 'rgba(0,0,0,0.5)' }}>{session.type}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {!completed && (
                          <button onClick={(e) => { e.stopPropagation(); setMoveTarget(session) }}
                            style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.5)', background: 'rgba(0,0,0,0.12)', border: 'none', padding: '4px 9px', borderRadius: 10, cursor: 'pointer' }}>⇄ Move</button>
                        )}
                        {completed
                          ? <span style={{ fontSize: 12, color: 'var(--hyrox)', fontWeight: 500 }}>✓ Done</span>
                          : <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(0,0,0,0.12)', padding: '4px 9px', borderRadius: 10 }}>{selectedSessions.length > 1 ? `${idx + 1}/${selectedSessions.length} · ` : ''}Tap to log ›</span>}
                      </div>
                    </div>
                    <h2 style={{ fontSize: 22, fontWeight: 500, color: completed ? 'var(--text)' : heroFg, marginBottom: 6, letterSpacing: '-0.3px', textDecoration: completed ? 'line-through' : 'none' }}>{session.title}</h2>
                    <p style={{ fontSize: 13, color: completed ? 'var(--text-muted)' : 'rgba(0,0,0,0.55)', marginBottom: 14, lineHeight: 1.5 }}>{session.details}</p>
                    {(() => {
                      // When done, show what was actually logged; otherwise the plan target.
                      const log = completed ? logByKey.get(`${weekDateStrs[DAYS.indexOf(selectedDay)]}::${String(session.title || '').trim().toLowerCase()}`) : null
                      const loggedDist = log ? parseFloat(log.log_data?.distance ?? log.log_data?.runLog?.distance) : NaN
                      const loggedDur = log ? parseFloat(log.log_data?.duration ?? log.log_data?.runLog?.duration) : NaN
                      const dist = !isNaN(loggedDist) ? loggedDist : sessionDistance(session)
                      const durStr = !isNaN(loggedDur) ? `${loggedDur}m` : `${session.duration}m`
                      const stats: [string, string][] = session.type === 'run'
                        ? [['Distance', dist ? `${dist} km` : '—'], ['Type', session.type], ['Duration', durStr]]
                        : [['Type', session.type], ['Duration', durStr]]
                      return (
                        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stats.length}, 1fr)`, gap: 6 }}>
                          {stats.map(([l,v]) => (
                            <div key={l} style={{ background: completed ? 'var(--bg)' : 'rgba(0,0,0,0.12)', borderRadius: 10, padding: '8px 10px' }}>
                              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px', color: completed ? 'var(--text-faint)' : 'rgba(0,0,0,0.4)', marginBottom: 2 }}>{l}</div>
                              <div style={{ fontSize: 13, fontWeight: 500, color: completed ? 'var(--text)' : heroFg, textTransform: 'capitalize' }}>{v}</div>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                )
              }) : (
                <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '28px 20px', textAlign: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>🛌</div>
                  <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>Rest day</p>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Recovery is part of the plan.</p>
                </div>
              )}
              {totalWeeks === 0 && (
                <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '28px 20px', textAlign: 'center' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>No plan yet</p>
                  <button onClick={() => router.push('/onboarding')} style={{ background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Build my plan</button>
                </div>
              )}

            </div>

            {/* Projected race times */}
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>Projected race times</p>
              {projectedTimes ? (
                <div className="mb-stagger" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {Object.entries(projectedTimes).map(([dist, data]: [string, any]) => (
                    <div key={dist} style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14, padding: '14px' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>{dist}</div>
                      <div className="mb-num" style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>{data.time}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{data.pace}</div>
                      <div style={{ fontSize: 10, color: 'var(--hyrox)', marginTop: 4, fontWeight: 500 }}>based on your {data.from}km</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14, padding: '16px', textAlign: 'center' }}>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>No run data yet</p>
                  <p style={{ fontSize: 12, color: 'var(--text-faint)' }}>Log a run with distance and duration to see your projected race times.</p>
                </div>
              )}
            </div>

            {/* Coming up — next 3 sessions after today (current week only) */}
            {isCurrentWeek && (() => {
              const todayIdx = DAYS.indexOf(today)
              const upcoming = DAYS.slice(todayIdx + 1).flatMap(day => getSessionsForDay(day).filter((s: any) => s.type !== 'rest').map((s: any) => ({ ...s, day }))).slice(0, 3)
              if (upcoming.length === 0) return null
              return (
                <div>
                  <p style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>Coming up</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {upcoming.map((s: any, i: number) => (
                      <div key={i} onClick={() => setSelectedDay(s.day)}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '10px 14px', cursor: 'pointer' }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: typeDot[s.type], flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', flex: 1 }}>{s.title}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{s.day}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 500 }}>{s.duration}m</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {activeTab === 'history' && (
          <div key="tab-history" className="mb-animate">
            <div style={{ marginBottom: 18 }}>
              <h1 style={{ fontSize: 26, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.5px', marginBottom: 4 }}>History</h1>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {allLogs.length > 0 ? `${allLogs.length} session${allLogs.length > 1 ? 's' : ''} logged` : 'Your completed workouts will appear here.'}
              </p>
            </div>
            {allLogs.length === 0 ? (
              <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '32px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📈</div>
                <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>No workouts yet</p>
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Complete a session and it’ll show up here with your coach’s notes.</p>
              </div>
            ) : (
              <>
              <div className="mb-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[...allLogs]
                  .sort((a, b) => (b.workout_date || '').localeCompare(a.workout_date || '') || (b.created_at || '').localeCompare(a.created_at || ''))
                  .slice(0, historyLimit)
                  .map((log, i) => {
                    const prose = coachProse(log.log_data?.coachComment)
                    const dateLabel = log.workout_date ? new Date(log.workout_date + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) : ''
                    const expanded = expandedLog === i
                    const d = log.log_data ?? {}
                    return (
                      <div key={i} onClick={() => setExpandedLog(expanded ? null : i)}
                        style={{ background: 'var(--bg-card)', border: `0.5px solid ${expanded ? 'var(--border-strong)' : 'var(--border)'}`, borderRadius: 16, padding: '14px 16px', cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 20, background: `${typeDot[log.workout_type] ?? 'var(--text-faint)'}1a`, color: typeDot[log.workout_type] ?? 'var(--text-faint)' }}>{log.workout_type}</span>
                          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', flex: 1, letterSpacing: '-0.2px' }}>{log.title}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{dateLabel}</span>
                          <span style={{ fontSize: 13, color: 'var(--text-faint)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>›</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{logSummary(log)}</div>

                        {expanded && (
                          <div className="mb-animate" style={{ marginTop: 12, paddingTop: 12, borderTop: '0.5px solid var(--border)' }}>
                            {/* Lift detail */}
                            {log.workout_type === 'lift' && d.logs && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {Object.entries<any>(d.logs).map(([ex, exData]) => {
                                  const sets = (exData?.sets ?? []).filter((s: any) => s.reps || s.weight)
                                  if (sets.length === 0) return null
                                  return (
                                    <div key={ex}>
                                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', marginBottom: 5 }}>{ex}</div>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                        {sets.map((s: any, si: number) => (
                                          <span key={si} style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 7, padding: '4px 8px' }}>
                                            {s.reps || '—'} × {s.weight || '—'}{s.weight ? ` ${d.unit ?? 'lbs'}` : ''}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                            {/* Run detail */}
                            {log.workout_type === 'run' && (d.runLog || d.distance) && (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
                                {[['Distance', (d.runLog?.distance || d.distance) ? `${d.runLog?.distance || d.distance} km` : null],
                                  ['Time', (d.runLog?.duration || d.duration) ? `${d.runLog?.duration || d.duration} min` : null],
                                  ['Pace', (d.runLog?.pace || d.pace) ? `${d.runLog?.pace || d.pace}/km` : null],
                                  ['Avg HR', d.runLog?.heartRate || null],
                                  ['Cadence', d.runLog?.cadence ? `${d.runLog.cadence} spm` : null],
                                ].filter(([, v]) => v).map(([l, v]) => (
                                  <div key={l as string} style={{ background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                                    <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-faint)', marginBottom: 2 }}>{l}</div>
                                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{v}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {/* Hyrox detail */}
                            {log.workout_type === 'hyrox' && d.hyroxLog && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {Object.entries<any>(d.hyroxLog).filter(([, v]) => v).map(([station, v]) => (
                                  <div key={station} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                    <span style={{ color: 'var(--text-muted)' }}>{station}</span>
                                    <span style={{ color: 'var(--text)', fontWeight: 500 }}>{v}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {prose && (
                              <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '0.5px solid var(--border)' }}>
                                <span style={{ fontSize: 12, flexShrink: 0 }}>🤖</span>
                                <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{prose}</p>
                              </div>
                            )}
                            <button onClick={(e) => { e.stopPropagation(); deleteLog(log.id) }}
                              style={{ marginTop: 12, background: 'transparent', color: '#cc4433', border: '0.5px solid rgba(204,68,51,0.3)', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                              Delete this entry
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
              {allLogs.length > historyLimit && (
                <button onClick={() => setHistoryLimit(n => n + 50)}
                  style={{ width: '100%', marginTop: 10, background: 'var(--bg-card)', color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 12, padding: 12, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                  Show more ({allLogs.length - historyLimit} older)
                </button>
              )}
              </>
            )}
          </div>
        )}

        {activeTab === 'pbs' && (
          <div key="tab-pbs" className="mb-animate">
            <div style={{ marginBottom: 18 }}>
              <h1 style={{ fontSize: 26, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.5px', marginBottom: 4 }}>Personal Bests</h1>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Your records and trends, pulled automatically from logged workouts.</p>
            </div>

            {/* Badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px' }}>Badges · {earnedBadges.length}/{badges.length}</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 28 }}>
              {badges.map(b => (
                <div key={b.id} title={b.desc} style={{ background: 'var(--bg-card)', border: `0.5px solid ${b.earned ? 'var(--border-strong)' : 'var(--border)'}`, borderRadius: 12, padding: '12px 6px', textAlign: 'center', opacity: b.earned ? 1 : 0.35 }}>
                  <div style={{ fontSize: 22, filter: b.earned ? 'none' : 'grayscale(1)' }}>{b.emoji}</div>
                  <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text)', marginTop: 4, lineHeight: 1.2 }}>{b.name}</div>
                  <div style={{ fontSize: 8, color: 'var(--text-faint)', marginTop: 2, lineHeight: 1.25 }}>{b.earned && b.date ? fmtPBDate(b.date) : b.desc}</div>
                </div>
              ))}
            </div>

            {/* Trends */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px' }}>Trends</p>
            </div>
            <TrendCharts logs={allLogs} />

            {/* Hyrox PBs */}
            {Object.keys(hyroxPBs).length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--hyrox)' }} />
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px' }}>Hyrox</p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                  {(['Total time', 'Running time'] as const).map(f => {
                    const pb = hyroxPBs[f]
                    return (
                      <div key={f} style={{ position: 'relative', background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14, padding: '13px 14px', opacity: pb ? 1 : 0.55 }}>
                        {pb && <button onClick={() => resetPB(pb.id, f)} title={`Reset ${f} PB`} style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 13, cursor: 'pointer', padding: 2, lineHeight: 1 }}>↺</button>}
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>{f}</div>
                        {pb ? (
                          <>
                            <div className="mb-num" style={{ fontSize: 20, fontWeight: 600, color: 'var(--hyrox)' }}>{secToClock(pb.sec)}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{fmtPBDate(pb.date)}</div>
                          </>
                        ) : <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-faint)', marginTop: 2 }}>—</div>}
                      </div>
                    )
                  })}
                </div>
                <div className="mb-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 28 }}>
                  {HYROX_STATIONS.filter(st => hyroxPBs[st]).map(st => (
                    <div key={st} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '11px 14px' }}>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{st}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{fmtPBDate(hyroxPBs[st].date)}</span>
                      <span className="mb-num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--hyrox)' }}>{secToClock(hyroxPBs[st].sec)}</span>
                      <button onClick={() => resetPB(hyroxPBs[st].id, st)} title={`Reset ${st} PB`} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 13, cursor: 'pointer', padding: 2, lineHeight: 1 }}>↺</button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Running PBs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--run)' }} />
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px' }}>Running</p>
            </div>
            <div className="mb-stagger" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 28 }}>
              {RUN_PB_DISTANCES.map(dist => {
                const pb = runPBs[dist.key]
                return (
                  <div key={dist.key} style={{ position: 'relative', background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14, padding: '13px 14px', opacity: pb ? 1 : 0.55 }}>
                    {pb && <button onClick={() => resetPB(pb.id, dist.label)} title={`Reset ${dist.label} PB`} style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 13, cursor: 'pointer', padding: 2, lineHeight: 1 }}>↺</button>}
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>{dist.label}</div>
                    {pb ? (
                      <>
                        <div className="mb-num" style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>{fmtClock(pb.dur)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{pb.pace ? `${pb.pace}/km · ` : ''}from your {Math.round(pb.dist * 10) / 10}km · {fmtPBDate(pb.date)}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-faint)', marginTop: 2 }}>—</div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Strength PBs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--lift)' }} />
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px' }}>Strength · heaviest set</p>
            </div>
            <div className="mb-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {COMPOUND_LIFTS.map(lift => {
                const pb = liftPBs[lift.key]
                return (
                  <div key={lift.key} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14, padding: '13px 16px', opacity: pb ? 1 : 0.55 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.2px' }}>{lift.label}</div>
                      {pb && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{pb.reps ? `× ${pb.reps} reps · ` : ''}{fmtPBDate(pb.date)}</div>}
                    </div>
                    {pb ? (
                      <div className="mb-num" style={{ fontSize: 20, fontWeight: 600, color: 'var(--lift)' }}>{pb.weight}<span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-faint)' }}> {pb.unit}</span></div>
                    ) : (
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-faint)' }}>—</div>
                    )}
                    {pb && <button onClick={() => resetPB(pb.id, lift.label)} title={`Reset ${lift.label} PB`} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 14, cursor: 'pointer', padding: 2, lineHeight: 1 }}>↺</button>}
                  </div>
                )
              })}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 16, lineHeight: 1.5 }}>
              Running bests match each logged run to the closest standard distance. Strength bests track the heaviest single set logged for each compound lift.
            </p>
            {allLogs.length > 0 && (
              <button onClick={resetRecords}
                style={{ width: '100%', marginTop: 20, background: 'transparent', color: '#cc4433', border: '0.5px solid rgba(204,68,51,0.35)', borderRadius: 12, padding: 12, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                Reset records
              </button>
            )}
            <p style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 8, lineHeight: 1.5, textAlign: 'center' }}>
              Resetting clears all logged workouts (history, bests and stats are calculated from them). This can’t be undone.
            </p>
          </div>
        )}

        {activeTab === 'more' && (
          <div key="tab-more" className="mb-animate mb-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14, padding: '16px', display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: 'var(--accent-fg)', fontSize: 16, fontWeight: 500 }}>{firstName.slice(0,2).toUpperCase()}</span>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.2px' }}>{profile?.full_name ?? firstName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{profile?.goal_race?.replace(/_/g,' ')} · {timeGoal}</div>
              </div>
            </div>
            {editProfile && (
              <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-strong)', borderRadius: 14, padding: '16px' }}>
                <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 12 }}>Edit profile</h3>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Your name"
                  style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border-strong)', color: 'var(--text)', borderRadius: 10, padding: '12px 14px', fontSize: 16, outline: 'none', marginBottom: 12 }} />
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Race date</label>
                <input type="date" value={editRaceDate} onChange={e => setEditRaceDate(e.target.value)}
                  style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border-strong)', color: 'var(--text)', borderRadius: 10, padding: '12px 14px', fontSize: 16, outline: 'none', marginBottom: 14 }} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setEditProfile(false)} style={{ flex: 1, background: 'var(--bg)', color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={saveProfile} style={{ flex: 2, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 10, padding: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Save</button>
                </div>
              </div>
            )}
            {allLogs.length > 0 && (() => {
              const totalKm = allLogs.filter(l => l.workout_type === 'run').reduce((a, l) => a + (parseFloat(l.log_data?.runLog?.distance ?? l.log_data?.distance) || 0), 0)
              const lifts = allLogs.filter(l => l.workout_type === 'lift').length
              const stats: [string, string][] = [['Sessions', String(allLogs.length)], ['Total km', String(Math.round(totalKm))], ['Lifts', String(lifts)]]
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 4 }}>
                  {stats.map(([l, v]) => (
                    <div key={l} style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14, padding: '14px 12px', textAlign: 'center' }}>
                      <div className="mb-num" style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)' }}>{v}</div>
                      <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px', marginTop: 3 }}>{l}</div>
                    </div>
                  ))}
                </div>
              )
            })()}
            <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
              {[
                ...(totalWeeks > 0 ? [{ label: '➕ Add a run or lift', desc: 'Drop a session onto your plan — once or recurring', action: () => router.push('/add-session') }] : []),
                ...(totalWeeks > 0 ? [{ label: '📆 Start plan this week', desc: 'Re-align Week 1 to the current calendar week', action: startPlanThisWeek }] : []),
                { label: 'Edit profile', desc: 'Update your name & race date', action: () => { setEditName(profile?.full_name ?? ''); setEditRaceDate(profile?.goal_race_date ? String(profile.goal_race_date).split('T')[0] : ''); setEditProfile(true); setActiveTab('more') } },
                { label: '🔗 Connections', desc: 'Strava sync & daily reminders', action: () => router.push('/connections') },
                { label: 'Theme', desc: 'Change app appearance', action: () => router.push('/settings') },
                { label: 'New plan', desc: 'Generate a fresh training plan', action: () => router.push('/new-plan') },
              ].map((item, i, arr) => (
                <div key={i} onClick={item.action}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: i < arr.length - 1 ? '0.5px solid var(--border)' : 'none', cursor: 'pointer' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.2px' }}>{item.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>{item.desc}</div>
                  </div>
                  <span style={{ color: 'var(--text-faint)', fontSize: 16 }}>›</span>
                </div>
              ))}
            </div>
            <button onClick={() => supabase.auth.signOut().then(() => router.push('/login'))}
              style={{ background: 'var(--bg-card)', color: '#cc2200', border: '0.5px solid rgba(204,34,0,0.2)', borderRadius: 14, padding: '14px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
              Sign out
            </button>
          </div>
        )}
      </div>

      {/* Bottom nav — Plan tab removed */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--bg-nav)', borderTop: '0.5px solid var(--border)', display: 'flex', zIndex: 20, paddingBottom: 'env(safe-area-inset-bottom,8px)' }}>
        {([
          { id: 'home', label: 'Home' },
          { id: 'history', label: 'History' },
          { id: 'pbs', label: 'Bests' },
          { id: 'more', label: 'More' },
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ flex: 1, padding: '12px 0 10px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-faint)', letterSpacing: '0.3px' }}>{tab.label}</span>
            {activeTab === tab.id && <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)' }} />}
          </button>
        ))}
      </div>

      {/* Move a session to another day this week */}
      {moveTarget && (
        <div onClick={() => setMoveTarget(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderTopLeftRadius: 20, borderTopRightRadius: 20, width: '100%', maxWidth: 600, padding: '20px 18px 32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Move “{moveTarget.title}”</span>
              <button onClick={() => setMoveTarget(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>Pick a new day for this week. A rest day there will be replaced.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
              {DAYS.filter(d => d !== moveTarget.day).map(d => (
                <button key={d} onClick={() => moveSession(moveTarget, d)} style={{ padding: '12px 0', borderRadius: 10, border: '0.5px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{d}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
