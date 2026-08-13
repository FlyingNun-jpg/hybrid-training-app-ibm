'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import RunTracker, { type RunResult } from '@/components/RunTracker'
import { parseActivityText } from '@/lib/parseActivity'

interface SetLog { reps: string; weight: string }
interface ExerciseLog { sets: SetLog[] }
interface RunLog { distance: string; duration: string; pace: string; heartRate: string; cadence: string }

const typeColor: Record<string, string> = {
  run: 'var(--run)', lift: 'var(--lift)', hyrox: 'var(--hyrox)', rest: 'var(--text-faint)'
}

// Post-workout "how did that feel?" scale. Stored in log_data.feel and used by the
// adaptive coach to spot overreaching (several hard sessions stacking up).
const FEELS = [
  { key: 'very_easy', emoji: '😌', label: 'Very easy' },
  { key: 'easy',      emoji: '🙂', label: 'Easy' },
  { key: 'medium',    emoji: '😅', label: 'Medium' },
  { key: 'hard',      emoji: '🥵', label: 'Hard' },
  { key: 'very_hard', emoji: '😵', label: 'Very hard' },
] as const

// Strip set/load notation from an exercise string to get the movement name only,
// e.g. "Back Squat — PRIMARY heavy (early 4-5x3-5 @82-88% 1RM)" → "Back Squat".
function cleanExerciseName(raw: string): string {
  return (raw || '')
    .split(/[—(]/)[0]
    .replace(/\b\d+\s*[x×]\s*\d+(?:\s*[-–]\s*\d+)?\b/gi, '')
    .replace(/@\s*\d+%?/g, '')
    .replace(/\bPRIMARY|heavy|reps?|RPE|1RM\b/gi, '')
    .replace(/[)\]]/g, '')
    .replace(/\d+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
// Open a demonstration video for an exercise. Uses a YouTube search of the cleaned
// movement name, which reliably returns a relevant how-to for any exercise (gym or
// home substitute) without depending on a paid API or fragile per-exercise mapping.
function demoUrl(raw: string): string {
  const name = cleanExerciseName(raw) || raw
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' proper form technique')}`
}

// ── Public-domain exercise demonstration images (free-exercise-db, Unlicense) ──
// We fetch the combined dataset once, cache a slim {name, frame0, frame1} index in
// localStorage, and match it conservatively to our prescribed exercises. Two frames
// (start/finish) cross-fade for a GIF-like demo. Anything we can't confidently match
// falls back to the demo link, so the UI never shows a wrong or broken image.
type ExImg = { a: string; b: string }
const EXDB_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'
const EXDB_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'
const normN = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Curated movement → candidate EXACT dataset names. First candidate present in the
// dataset wins. This is hard-coded (no fuzzy matching) so a given exercise always
// shows the CORRECT demo — no more "dumbbell curl for incline press". A movement we
// don't map, or whose candidates aren't in the dataset, simply falls back to the link.
// Order matters: most specific first. Regexes are deliberately broad so they also
// catch abbreviated names the model sometimes writes ("Bench", "Incline DB", "Lat raise").
const DEMO_MAP: { re: RegExp; names: string[] }[] = [
  { re: /incline/, names: ['Incline Dumbbell Press', 'Incline Dumbbell Bench Press With Palms Facing In'] },
  { re: /pike/, names: ['Pike Press'] },
  { re: /diamond|close.?grip push|triceps push.?up/, names: ['Push-Ups - Close Triceps Position'] },
  { re: /decline push/, names: ['Decline Push-Up', 'Pushups'] },
  { re: /push.?up|pushup/, names: ['Pushups', 'Push-Ups With Feet Elevated'] },
  { re: /\bbench\b|chest press/, names: ['Barbell Bench Press - Medium Grip', 'Dumbbell Bench Press', 'Barbell Bench Press'] },
  { re: /\bohp\b|overhead|(shoulder|military|strict)\s*press/, names: ['Standing Military Press', 'Dumbbell Shoulder Press', 'Standing Dumbbell Press'] },
  { re: /single.?leg.*(romanian|rdl|deadlift)/, names: ['Single-Leg Stiff-Legged Deadlift', 'Romanian Deadlift'] },
  { re: /romanian|\brdl\b|stiff.?leg/, names: ['Romanian Deadlift', 'Stiff-Legged Barbell Deadlift', 'Romanian Deadlift With Dumbbells'] },
  { re: /trap.?bar/, names: ['Trap Bar Deadlift', 'Barbell Deadlift'] },
  { re: /dead.?lift|\bdl\b/, names: ['Barbell Deadlift'] },
  { re: /inverted row/, names: ['Inverted Row', 'Bodyweight Mid Row'] },
  { re: /\brow\b|pendlay|bent.?over/, names: ['Bent Over Barbell Row', 'Bent Over Two-Dumbbell Row'] },
  { re: /pull.?up|pullup|chin.?up/, names: ['Pullups', 'Wide-Grip Pull-Up', 'Chin-Up'] },
  { re: /lat(?:eral)?\s*raise|side raise|delt raise/, names: ['Side Lateral Raise'] },
  { re: /face pull/, names: ['Face Pull'] },
  { re: /pushdown|press.?down|tricep.*ext/, names: ['Triceps Pushdown', 'Triceps Pushdown - Rope Attachment'] },
  { re: /\bdips?\b/, names: ['Dips - Triceps Version', 'Bench Dips'] },
  // Machine / cable / accessory movements (must precede the generic "curl"/"squat" rules
  // so e.g. "Leg Curl" doesn't resolve to a biceps curl).
  { re: /leg curl|hamstring curl|lying curl/, names: ['Lying Leg Curls', 'Seated Leg Curl'] },
  { re: /leg extension/, names: ['Leg Extensions'] },
  { re: /leg press/, names: ['Leg Press'] },
  { re: /(lat\s*pulldown|pulldown)/, names: ['Wide-Grip Lat Pulldown', 'Close-Grip Front Lat Pulldown'] },
  { re: /push press/, names: ['Push Press', 'Standing Military Press'] },
  { re: /(cable\s*(fly|crossover)|chest fly|pec (deck|fly))/, names: ['Cable Crossover', 'Butterfly'] },
  { re: /shrug/, names: ['Barbell Shrug', 'Dumbbell Shrug'] },
  { re: /(rear[\s-]?delt|reverse fly|rear delt fly)/, names: ['Reverse Flyes', 'Seated Bent-Over Rear Delt Raise'] },
  { re: /\bplank\b/, names: ['Plank'] },
  { re: /russian twist/, names: ['Russian Twist'] },
  { re: /curl/, names: ['Barbell Curl', 'Dumbbell Bicep Curl', 'Dumbbell Alternate Bicep Curl'] },
  { re: /calf/, names: ['Standing Calf Raises', 'Single-Leg Calf Raise', 'Calf Press'] },
  { re: /(leg|knee) raise/, names: ['Hanging Leg Raise', 'Hanging Knee Raise'] },
  { re: /hip thrust/, names: ['Barbell Hip Thrust', 'Butt Lift (Bridge)'] },
  { re: /glute bridge|hip bridge/, names: ['Glute Bridge', 'Butt Lift (Bridge)'] },
  { re: /bulgarian|split squat|rear.?foot/, names: ['Dumbbell Bulgarian Split Squat', 'Bulgarian Split Squat'] },
  { re: /front squat/, names: ['Front Barbell Squat'] },
  { re: /jump squat/, names: ['Freehand Jump Squat'] },
  { re: /wall sit|wall squat/, names: ['Wall Sit', 'Wall Squat'] },
  { re: /squat/, names: ['Barbell Squat', 'Barbell Full Squat', 'Bodyweight Squat'] },
  { re: /lunge/, names: ['Dumbbell Lunges', 'Barbell Lunge', 'Bodyweight Walking Lunge'] },
  { re: /clean/, names: ['Power Clean', 'Hang Clean'] },
  { re: /box jump/, names: ['Box Jump (Multiple Response)'] },
  { re: /swing/, names: ['Kettlebell Swings', 'One-Arm Kettlebell Swings'] },
  { re: /mountain climber/, names: ['Mountain Climbers'] },
  { re: /burpee/, names: ['Burpee', 'Burpees'] },
  { re: /superman/, names: ['Superman'] },
  { re: /(back|hyper).*ext/, names: ['Hyperextensions (Back Extensions)'] },
]

let _exIdxPromise: Promise<{ n: string; a: string; b: string }[] | null> | null = null
async function loadExerciseIndex() {
  if (_exIdxPromise) return _exIdxPromise
  _exIdxPromise = (async () => {
    try { const c = localStorage.getItem('mb-exdb-v2'); if (c) return JSON.parse(c) } catch {}
    try {
      const res = await fetch(EXDB_URL)
      if (!res.ok) return null
      const data = await res.json()
      const idx = (data || []).filter((e: any) => e?.images?.length).map((e: any) => ({ n: normN(e.name), a: EXDB_BASE + e.images[0], b: EXDB_BASE + (e.images[1] || e.images[0]) }))
      try { localStorage.setItem('mb-exdb-v2', JSON.stringify(idx)) } catch {}
      return idx
    } catch { return null }
  })()
  return _exIdxPromise
}
function resolveDemo(raw: string, byName: Map<string, ExImg>): ExImg | null {
  const lc = cleanExerciseName(raw).toLowerCase()
  for (const m of DEMO_MAP) {
    if (m.re.test(lc)) {
      for (const nm of m.names) { const hit = byName.get(normN(nm)); if (hit) return hit }
      return null // movement identified but no demo available → show the link, don't mis-match
    }
  }
  return null
}

// Parse a "sets x reps" scheme out of an exercise string, e.g. "Back squat 4x5 @82% 1RM"
// → { sets: 4, reps: "5" }, or "3x8-12" → { sets: 3, reps: "8-12" }.
function parseSetScheme(ex: string): { sets: number; reps: string } | null {
  const m = (ex || '').match(/(\d+)\s*[x×]\s*(\d+(?:\s*[-–]\s*\d+)?)/i)
  if (!m) return null
  const sets = parseInt(m[1])
  if (!sets || sets < 1 || sets > 12) return null
  return { sets, reps: m[2].replace(/\s/g, '') }
}

// The 8 Hyrox stations (+ compromised run). `weighted` stations get a load input too.
const HYROX_STATION_DEFS: { name: string; re: RegExp; weighted: boolean }[] = [
  { name: 'Run', re: /\b\d+\s?(?:km|m)\s*run\b|compromised run|\brun\s*@/i, weighted: false },
  { name: 'SkiErg', re: /ski\s?erg|\bski\b/i, weighted: false },
  { name: 'Sled Push', re: /sled push/i, weighted: true },
  { name: 'Sled Pull', re: /sled pull/i, weighted: true },
  { name: 'Burpee Broad Jump', re: /burpee/i, weighted: false },
  { name: 'Row', re: /\brow(?:ing|\s?erg)?\b/i, weighted: false },
  { name: 'Farmers Carry', re: /farmer'?s? carry|loaded carry/i, weighted: true },
  { name: 'Sandbag Lunges', re: /sandbag|\blunge/i, weighted: true },
  { name: 'Wall Balls', re: /wall\s?ball/i, weighted: true },
]
interface HyroxStation { name: string; weighted: boolean; sets: number; presc: string }
// Parse ONLY the stations actually prescribed in this session's details, with a sets
// count (from "N rounds" or a per-station "Nx") and a short prescription label.
function parseHyroxStations(details: string): HyroxStation[] {
  const text = details || ''
  const roundsM = text.match(/(\d+)\s*rounds?/i)
  const rounds = roundsM ? Math.min(8, Math.max(1, parseInt(roundsM[1]))) : 1
  const out: HyroxStation[] = []
  for (const st of HYROX_STATION_DEFS) {
    const m = st.re.exec(text)
    if (!m) continue
    const around = text.slice(m.index, m.index + 45)
    const xM = around.match(/(\d+)\s*[x×]/)
    const sets = xM ? Math.min(10, Math.max(1, parseInt(xM[1]))) : rounds
    const presc = text.slice(m.index).split(/[,;.]/)[0].trim()
    out.push({ name: st.name, weighted: st.weighted, sets, presc: presc.length <= 38 ? presc : st.name })
  }
  return out
}

export default function WorkoutDetailPage() {
  const { user } = useAuth()
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const sessionIndex = parseInt(searchParams.get('session') ?? '0')
  // The plan week this session belongs to (passed by the dashboard). Without it we
  // can only scan weeks from the top, which finds week 1's session for that day —
  // wrong whenever weeks differ (e.g. after moving/swapping sessions in a week).
  const weekIndexRaw = searchParams.get('week')
  const weekIndex = weekIndexRaw !== null && /^\d+$/.test(weekIndexRaw) ? parseInt(weekIndexRaw) : null
  // The calendar date this session belongs to (passed by the dashboard). Scoping
  // load + save by date keeps each day's log separate, so a recurring session no
  // longer loads or overwrites another day's entry. Falls back to today.
  const workoutDate = searchParams.get('date') || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
  // Local draft key — caches in-progress entry so leaving the screen never loses it.
  const draftKey = `mb-draft-${params.planId}-${params.day}-${sessionIndex}-${workoutDate}`

  const [session, setSession] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [unit, setUnit] = useState<'lbs'|'kg'>('lbs')
  const [logs, setLogs] = useState<Record<string, ExerciseLog>>({})
  const [exercises, setExercises] = useState<string[]>([])
  const [repTargets, setRepTargets] = useState<Record<string, string>>({})
  const [exImages, setExImages] = useState<Record<string, ExImg>>({})
  const [runLog, setRunLog] = useState<RunLog>({ distance: '', duration: '', pace: '', heartRate: '', cadence: '' })
  // station name -> { sets: [{time, weight}] }, plus 'Total time'/'Running time' strings.
  const [hyroxLog, setHyroxLog] = useState<Record<string, any>>({})
  const [saved, setSaved] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [editing, setEditing] = useState(false)
  const [logId, setLogId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<any>(null)
  const [aiResponse, setAiResponse] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [loggedAt, setLoggedAt] = useState<string | null>(null)
  const [tracking, setTracking] = useState(false)
  const [tracked, setTracked] = useState(false)
  const [captureSrc, setCaptureSrc] = useState<'gps' | 'import' | null>(null)
  const [feel, setFeel] = useState<string | null>(null)
  // Strava auto-sync: connected? / already-posted activity id / current sync state.
  const [stravaConnected, setStravaConnected] = useState(false)
  const [stravaActivityId, setStravaActivityId] = useState<number | null>(null)
  const [stravaStatus, setStravaStatus] = useState<'idle'|'syncing'|'synced'|'failed'>('idle')
  const [importError, setImportError] = useState('')
  const importInputRef = useRef<HTMLInputElement>(null)
  const locked = saved && !editing

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('*').eq('id', user.id).single().then(({ data }) => setProfile(data))
    supabase.from('training_plans').select('*').eq('id', params.planId).single().then(({ data }) => {
      if (!data) return
      let found = null
      const weeks = data.plan_data?.weeks ?? []
      // Prefer the exact week the dashboard sent us to — the same day can hold
      // different sessions in different weeks (and after in-week moves).
      if (weekIndex !== null && weeks[weekIndex]) {
        const daySessions = weeks[weekIndex].sessions?.filter((s: any) => s.day === params.day) ?? []
        if (daySessions[sessionIndex]) found = daySessions[sessionIndex]
        else if (daySessions.length > 0) found = daySessions[0]
      }
      if (!found) for (const week of weeks) {
        const daySessions = week.sessions?.filter((s: any) => s.day === params.day) ?? []
        if (daySessions[sessionIndex]) { found = daySessions[sessionIndex]; break }
      }
      if (!found) {
        for (const week of data.plan_data?.weeks ?? []) {
          const match = week.sessions?.find((s: any) => s.day === params.day)
          if (match) { found = match; break }
        }
      }
      if (found) {
        setSession(found)
        const exs = parseExercises(found.details)
        setExercises(exs)
        const init: Record<string, ExerciseLog> = {}
        const reps: Record<string, string> = {}
        exs.forEach((ex: string) => {
          const scheme = parseSetScheme(ex)
          const n = scheme?.sets ?? 3
          // Pre-create the prescribed number of sets. Prefill reps only when it's a
          // single number (a range like "8-12" is shown as a placeholder instead).
          const repValue = scheme?.reps && /^\d+$/.test(scheme.reps) ? scheme.reps : ''
          init[ex] = { sets: Array.from({ length: n }, () => ({ reps: repValue, weight: '' })) }
          if (scheme?.reps) reps[ex] = scheme.reps
        })
        setLogs(init)
        setRepTargets(reps)
        // Seed the Hyrox station log with the prescribed number of sets per station.
        if (found.type === 'hyrox') {
          const hl: Record<string, any> = {}
          parseHyroxStations(found.details).forEach(st => { hl[st.name] = { sets: Array.from({ length: st.sets }, () => ({ time: '', weight: '' })) } })
          setHyroxLog(hl)
        }
      }
    })
  }, [user, params, sessionIndex, weekIndex])

  useEffect(() => {
    if (!user || !session) return
    supabase.from('workout_logs')
      .select('*')
      .eq('user_id', user.id)
      .eq('title', session.title)
      .eq('workout_date', workoutDate)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const log = data[0]
          setSaved(true)
          setLogId(log.id)
          setLoggedAt(log.created_at)
          if (log.log_data?.logs) setLogs(log.log_data.logs)
          if (log.log_data?.unit) setUnit(log.log_data.unit)
          if (log.log_data?.coachComment) setAiResponse(log.log_data.coachComment)
          if (log.log_data?.runLog) setRunLog({ distance: '', duration: '', pace: '', heartRate: '', ...log.log_data.runLog, cadence: log.log_data.runLog.cadence ?? '' })
          if (log.log_data?.hyroxLog) setHyroxLog(log.log_data.hyroxLog)
          if (log.log_data?.feel) setFeel(log.log_data.feel)
          if (log.log_data?.stravaActivityId) { setStravaActivityId(log.log_data.stravaActivityId); setStravaStatus('synced') }
        } else {
          // No completed log yet — restore any in-progress draft so nothing is lost.
          try {
            const d = typeof window !== 'undefined' ? localStorage.getItem(draftKey) : null
            if (d) {
              const draft = JSON.parse(d)
              if (draft.logs) setLogs(draft.logs)
              if (draft.runLog) setRunLog(draft.runLog)
              if (draft.hyroxLog) setHyroxLog(draft.hyroxLog)
              if (draft.unit) setUnit(draft.unit)
              if (draft.feel) setFeel(draft.feel)
            }
          } catch { /* ignore corrupt draft */ }
        }
        setHydrated(true)
      })
  }, [user, session, workoutDate])

  // Autosave the in-progress entry locally so it survives leaving/returning to the screen.
  useEffect(() => {
    if (!hydrated || saved || typeof window === 'undefined') return
    try { localStorage.setItem(draftKey, JSON.stringify({ logs, runLog, hyroxLog, unit, feel })) } catch { /* quota */ }
  }, [logs, runLog, hyroxLog, unit, feel, hydrated, saved, draftKey])

  // Stations actually in this Hyrox session (only these are shown — not all 8).
  const hyroxStations = session?.type === 'hyrox' ? parseHyroxStations(session.details) : []
  const hyroxSetsFor = (name: string, fallback: number): { time: string; weight: string }[] => {
    const v = hyroxLog[name]
    if (v && Array.isArray(v.sets) && v.sets.length) return v.sets
    if (typeof v === 'string' && v) return [{ time: v, weight: '' }] // legacy flat value
    return Array.from({ length: fallback }, () => ({ time: '', weight: '' }))
  }
  const updateHyroxSet = (name: string, i: number, field: 'time' | 'weight', val: string, fallback: number) =>
    setHyroxLog(prev => {
      const cur = (prev[name] && Array.isArray(prev[name].sets) ? prev[name].sets.slice() : Array.from({ length: fallback }, () => ({ time: '', weight: '' })))
      while (cur.length <= i) cur.push({ time: '', weight: '' })
      cur[i] = { ...cur[i], [field]: val }
      return { ...prev, [name]: { sets: cur } }
    })
  const addHyroxSet = (name: string, fallback: number) =>
    setHyroxLog(prev => {
      const cur = (prev[name] && Array.isArray(prev[name].sets) ? prev[name].sets.slice() : Array.from({ length: fallback }, () => ({ time: '', weight: '' })))
      cur.push({ time: '', weight: '' })
      return { ...prev, [name]: { sets: cur } }
    })

  // Is Strava connected? Checked once so a completed save can auto-post the workout.
  useEffect(() => {
    if (!user) return
    ;(async () => {
      try {
        const { data: { session: s } } = await supabase.auth.getSession()
        if (!s) return
        const res = await fetch('/api/strava/status', { headers: { Authorization: `Bearer ${s.access_token}` } })
        const d = await res.json()
        setStravaConnected(!!d.connected)
      } catch { /* Strava is optional */ }
    })()
  }, [user])

  // Remember the athlete's preferred unit between workouts (a saved log overrides it
  // afterward so a past session still shows the unit it was logged in).
  useEffect(() => {
    const u = typeof window !== 'undefined' ? localStorage.getItem('mb-unit') : null
    if (u === 'lbs' || u === 'kg') setUnit(u)
  }, [])

  // Resolve public-domain demo images for the lift exercises (best-effort; misses
  // simply show the demo link instead).
  useEffect(() => {
    if (session?.type !== 'lift' || exercises.length === 0) return
    let cancelled = false
    loadExerciseIndex().then(idx => {
      if (cancelled || !idx) return
      const byName = new Map<string, ExImg>(idx.map((e: { n: string; a: string; b: string }) => [e.n, { a: e.a, b: e.b }]))
      const map: Record<string, ExImg> = {}
      for (const ex of exercises) { const m = resolveDemo(ex, byName); if (m) map[ex] = m }
      if (Object.keys(map).length) setExImages(map)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [session, exercises])

  // Split a lift's details into individual movements, robust to the formats the AI, the
  // builder and imported plans use (comma-, semicolon- or period-separated). Modifier-only
  // fragments ("RPE 7", "90s rest", "@82% 1RM") are dropped so each row is a real exercise.
  const parseExercises = (details: string) => {
    const segs = (details || '').split(/[,;]|\.\s+|\bthen\b/i).map(s => s.trim()).filter(Boolean)
    const junk = /^(rpe\b|hr\b|rest\b|tempo\b|@|w\/|with\b|jog\b|wu\b|cd\b|warm|cool|drop ?set|super ?set|amrap|\d+\s*(?:s|sec|min)\b)/i
    const list = segs.filter(s => s.length >= 3 && s.length < 80 && /[a-z]{3,}/i.test(s.replace(/[^a-z]/gi, '')) && !junk.test(s))
    return (list.length ? list : segs.filter(s => s.length > 4)).slice(0, 12)
  }

  const addSet = (ex: string) =>
    setLogs(prev => ({ ...prev, [ex]: { sets: [...prev[ex].sets, { reps: '', weight: '' }] } }))

  const removeSet = (ex: string, idx: number) =>
    setLogs(prev => {
      const sets = prev[ex].sets.filter((_, i) => i !== idx)
      return { ...prev, [ex]: { sets: sets.length ? sets : [{ reps: '', weight: '' }] } }
    })

  const updateSet = (ex: string, idx: number, field: 'reps'|'weight', val: string) =>
    setLogs(prev => {
      const sets = [...prev[ex].sets]
      sets[idx] = { ...sets[idx], [field]: val }
      return { ...prev, [ex]: { sets } }
    })

  const updateRunLog = (field: keyof RunLog, val: string) => {
    setRunLog(prev => {
      const updated = { ...prev, [field]: val }
      // Auto-calculate pace from distance + duration
      if ((field === 'distance' || field === 'duration') && updated.distance && updated.duration) {
        const distKm = parseFloat(updated.distance)
        const durMin = parseFloat(updated.duration)
        if (distKm > 0 && durMin > 0) {
          const paceDecimal = durMin / distKm
          const paceMin = Math.floor(paceDecimal)
          const paceSec = Math.round((paceDecimal - paceMin) * 60)
          updated.pace = `${paceMin}:${String(paceSec).padStart(2, '0')}`
        }
      }
      return updated
    })
  }

  // Captured GPS run → prefill the log form (distance, duration, auto-paced) and
  // close the tracker. The athlete reviews, optionally adds HR/cadence, then saves.
  const handleTrackerFinish = (r: RunResult) => {
    setRunLog(prev => ({ ...prev, distance: r.distance, duration: r.durationMin, pace: r.pace, cadence: r.cadence || prev.cadence }))
    setTracked(true)
    setCaptureSrc('gps')
    setTracking(false)
  }

  // Import a Garmin (or other wearable) .gpx/.tcx export and prefill the run log.
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = typeof ev.target?.result === 'string' ? ev.target.result : ''
      const r = parseActivityText(text, file.name)
      if (!r) { setImportError('Could not read that file. In Garmin Connect, open the activity → gear icon → Export to GPX or TCX, then upload that.'); return }
      setImportError('')
      setRunLog(prev => ({
        ...prev,
        distance: r.distance, duration: r.durationMin, pace: r.pace,
        cadence: r.cadence || prev.cadence, heartRate: r.heartRate || prev.heartRate,
      }))
      setTracked(true)
      setCaptureSrc('import')
    }
    reader.onerror = () => setImportError('Could not read that file. Try again.')
    reader.readAsText(file)
  }

  const buildLogData = (coachComment: string | null) => ({
      logs,
      unit,
      session,
      coachComment,
      feel,
      stravaActivityId,
      runLog: session.type === 'run' ? runLog : null,
      hyroxLog: session.type === 'hyrox' ? hyroxLog : null,
      // Top-level fields for projection engine
      distance: session?.type === 'run' ? parseFloat(runLog.distance) || null : null,
      duration: session?.type === 'run' ? parseFloat(runLog.duration) || null : null,
      pace: session?.type === 'run' ? runLog.pace : null,
    })

  // Post this workout to Strava (best-effort, never blocks the log). Duplicate-safe:
  // a log that already has an activity id is never re-posted. Also used by the
  // retry chip when a sync fails.
  const syncToStrava = async (id: string | null, comment: string | null) => {
    if (!session || !stravaConnected || stravaActivityId) return
    setStravaStatus('syncing')
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const elapsedMin = session.type === 'run'
        ? (parseFloat(runLog.duration) || session.duration || 30)
        : (session.duration || 45)
      // Rich description: lifts list every logged set (Strava has no set/weight
      // fields, so the description is where the work lives); hyrox lists stations.
      const detailLines: string[] = []
      if (session.type === 'lift') {
        for (const ex of exercises) {
          const sets = (logs[ex]?.sets ?? []).filter(s => s.reps || s.weight)
          if (!sets.length) continue
          detailLines.push(`${cleanExerciseName(ex) || ex}: ${sets.map(s => `${s.weight || '–'}${s.weight ? unit : ''} × ${s.reps || '?'}`).join(', ')}`)
        }
      }
      if (session.type === 'hyrox') {
        for (const [st, v] of Object.entries<any>(hyroxLog)) {
          if (typeof v === 'string') { if (v) detailLines.push(`${st}: ${v}`); continue }
          const times = (v?.sets ?? []).map((s: any) => s.time && s.weight ? `${s.time} @ ${s.weight}` : s.time || (s.weight ? `@ ${s.weight}` : '')).filter(Boolean)
          if (times.length) detailLines.push(`${st}: ${times.join(', ')}`)
        }
      }
      if (session.type === 'run' && runLog.heartRate) detailLines.push(`Avg HR ${runLog.heartRate} bpm${runLog.cadence ? ` · cadence ${runLog.cadence}` : ''}`)
      const description = [...detailLines, `Logged with Milkbag 🥛${feel ? ` · felt ${feel.replace('_', ' ')}` : ''}`].join('\n')
      const res = await fetch('/api/strava/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {}),
        },
        body: JSON.stringify({
          title: session.title,
          type: session.type,
          date: workoutDate,
          elapsedMin,
          distanceKm: session.type === 'run' ? runLog.distance : null,
          description,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.activityId) throw new Error('sync failed')
      setStravaActivityId(data.activityId)
      setStravaStatus('synced')
      if (id) await supabase.from('workout_logs').update({
        log_data: { ...buildLogData(comment), stravaActivityId: data.activityId },
      }).eq('id', id)
    } catch { setStravaStatus('failed') }
  }

  const handleSave = async () => {
    if (!user || !session) return
    const totalSets = Object.values(logs).reduce((acc, ex) => acc + ex.sets.length, 0)
    setAiLoading(true)
    setSaved(true)
    setEditing(false)
    try { if (typeof window !== 'undefined') localStorage.removeItem(draftKey) } catch { /* noop */ }

    // 1) Persist the log FIRST (update if it already exists, else insert) so the
    //    workout is never lost — even if the coach request fails or the user leaves.
    let currentId = logId
    if (currentId) {
      await supabase.from('workout_logs').update({
        workout_type: session.type, title: session.title, completed: true, log_data: buildLogData(aiResponse || null),
      }).eq('id', currentId)
    } else {
      const { data: ins } = await supabase.from('workout_logs').insert({
        user_id: user.id,
        workout_date: workoutDate,
        workout_type: session.type,
        title: session.title,
        completed: true,
        log_data: buildLogData(aiResponse || null),
      }).select('id').single()
      currentId = ins?.id ?? null
      if (currentId) setLogId(currentId)
    }

    // 2) Fetch fresh coach feedback, then attach it to the saved row.
    const workoutSummary = session.type === 'run'
      ? { session, runLog, unit, feel }
      : session.type === 'hyrox'
      ? { session, hyroxLog, unit, feel }
      : { session, logs, unit, totalSets, feel }

    let latestComment: string | null = aiResponse || null
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const res = await fetch('/api/coach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {}),
        },
        body: JSON.stringify({
          question: `Give me concise coaching feedback on my ${session.title} session.`,
          workoutSummary,
          profile
        })
      })
      const data = await res.json()
      latestComment = data.response
      setAiResponse(data.response)
      if (currentId) await supabase.from('workout_logs').update({ log_data: buildLogData(latestComment) }).eq('id', currentId)
    } catch { /* the log is already saved; coaching is best-effort */ }
    setAiLoading(false)

    // 3) Auto-post to Strava.
    await syncToStrava(currentId, latestComment)
  }

  const formatAiResponse = (text: string) => {
    const parts = text.split(/\[([^\]]+)\]/)
    return { prose: parts[0].trim(), tags: parts.filter((_: string, i: number) => i % 2 === 1) }
  }

  if (!session) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const { prose, tags } = aiResponse ? formatAiResponse(aiResponse) : { prose: '', tags: [] as string[] }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {tracking && (
        <RunTracker
          title={session.title}
          targetKm={session.distance > 0 ? session.distance : undefined}
          onFinish={handleTrackerFinish}
          onCancel={() => setTracking(false)}
        />
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes blink{0%,80%,100%{opacity:0.3}40%{opacity:1}}.dot-anim{animation:blink 1.2s infinite}.dot-anim:nth-child(2){animation-delay:0.2s}.dot-anim:nth-child(3){animation-delay:0.4s}`}</style>

      <nav style={{ background: 'var(--bg-nav)', borderBottom: '0.5px solid var(--border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => router.push('/dashboard')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>←</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'var(--accent-fg)', fontSize: 9, fontWeight: 500 }}>MB</span>
          </div>
          <span style={{ color: 'var(--text)', fontWeight: 500, fontSize: 15, letterSpacing: '-0.2px' }}>Milkbag</span>
        </div>
        {saved && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--hyrox)', fontWeight: 500 }}>
            <span>✓</span> Completed
            {stravaStatus === 'syncing' && <span style={{ color: '#fc4c02', fontWeight: 600 }}>· Strava…</span>}
            {stravaStatus === 'synced' && <span style={{ color: '#fc4c02', fontWeight: 600 }}>· Strava ✓</span>}
            {stravaStatus === 'failed' && (
              <button onClick={() => syncToStrava(logId, aiResponse || null)}
                style={{ background: 'none', border: 'none', color: '#fc4c02', fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: 0 }}>· Strava ↻ retry</button>
            )}
          </div>
        )}
      </nav>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '20px 16px 40px' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: `${typeColor[session.type]}18`, color: typeColor[session.type], textTransform: 'uppercase', letterSpacing: '0.8px' }}>{session.type}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{params.day as string} · {session.duration} min{session.type === 'run' && session.distance > 0 ? ` · ${session.distance} km` : ''}</span>
            {loggedAt && <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 'auto' }}>Logged {new Date(loggedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 500, color: 'var(--text)', marginBottom: 8, letterSpacing: '-0.4px' }}>{session.title}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>{session.details}</p>
        </div>

        {/* LIFT LOGGING */}
        {session.type === 'lift' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Units:</span>
              <div style={{ display: 'flex', background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 2 }}>
                {(['lbs','kg'] as const).map(u => (
                  <button key={u} onClick={() => { if (!locked) { setUnit(u); try { localStorage.setItem('mb-unit', u) } catch {} } }}
                    style={{ padding: '5px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 500, cursor: locked ? 'default' : 'pointer', background: unit === u ? 'var(--accent)' : 'transparent', color: unit === u ? 'var(--accent-fg)' : 'var(--text-muted)', transition: 'all 0.15s' }}>{u}</button>
                ))}
              </div>
              {locked && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Previously logged</span>}
              {editing && <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500 }}>Editing</span>}
            </div>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 12 }}>{locked ? 'Your logged sets' : editing ? 'Edit your sets' : 'Log your sets'}</h2>
              {exercises.map((ex: string) => (
                <div key={ex} style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{ex}</span>
                    {!exImages[ex] && (
                      <a href={demoUrl(ex)} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, fontWeight: 500, color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '4px 10px' }}>▶ Demo</a>
                    )}
                  </div>
                  {exImages[ex] && (
                    <a href={demoUrl(ex)} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'block', position: 'relative', width: '100%', aspectRatio: '3 / 2', borderRadius: 10, overflow: 'hidden', border: '0.5px solid var(--border)', background: '#fff', marginBottom: 12 }}>
                      <img src={exImages[ex].a} alt="" loading="lazy"
                        onError={() => setExImages(prev => { const n = { ...prev }; delete n[ex]; return n })}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                      <img src={exImages[ex].b} alt="" loading="lazy"
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', animation: 'mb-flip 1.8s steps(1, end) infinite' }} />
                      <span style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 10, fontWeight: 600, color: '#fff', background: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: '4px 9px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>▶ Watch demo</span>
                    </a>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr', gap: 6, marginBottom: 6 }}>
                    {['Set','Reps',`Weight (${unit})`].map((h: string) => <span key={h} style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</span>)}
                  </div>
                  {logs[ex]?.sets.map((set, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: locked ? '36px 1fr 1fr' : '36px 1fr 1fr 30px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                      <div style={{ background: 'var(--bg)', borderRadius: 6, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>{idx + 1}</div>
                      <input type="number" value={set.reps} onChange={e => !locked && updateSet(ex, idx, 'reps', e.target.value)} placeholder={repTargets[ex] ?? '0'} readOnly={locked}
                        style={{ background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 6, height: 34, textAlign: 'center', fontSize: 13, color: locked && set.reps ? 'var(--accent)' : 'var(--text)', outline: 'none', width: '100%', opacity: locked && !set.reps ? 0.4 : 1 }} />
                      <input type="number" value={set.weight} onChange={e => !locked && updateSet(ex, idx, 'weight', e.target.value)} placeholder="0" readOnly={locked}
                        style={{ background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 6, height: 34, textAlign: 'center', fontSize: 13, color: locked && set.weight ? 'var(--accent)' : 'var(--text)', outline: 'none', width: '100%', opacity: locked && !set.weight ? 0.4 : 1 }} />
                      {!locked && (
                        <button onClick={() => removeSet(ex, idx)} title="Remove set"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 17, lineHeight: 1, padding: 0 }}>×</button>
                      )}
                    </div>
                  ))}
                  {!locked && <button onClick={() => addSet(ex)} style={{ fontSize: 12, color: 'var(--lift)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2 }}>+ add set</button>}
                </div>
              ))}
            </div>
          </>
        )}

        {/* RUN LOGGING */}
        {session.type === 'run' && (
          <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '16px', marginBottom: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>{locked ? 'Your run log' : editing ? 'Edit your run' : 'Log your run'}</h2>
            {!locked && <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 14 }}>Distance + duration auto-calculates your pace and updates projected race times.</p>}

            {/* GPS recorder — track the run live instead of typing it in by hand. */}
            {!locked && (
              <>
                <button onClick={() => setTracking(true)}
                  style={{ width: '100%', background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 10, padding: '13px', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, letterSpacing: '-0.2px' }}>
                  <span style={{ fontSize: 15 }}>📍</span> {tracked ? 'Re-record run with GPS' : 'Begin run with GPS'}
                </button>
                <input ref={importInputRef} type="file" accept=".gpx,.tcx" onChange={handleImportFile} style={{ display: 'none' }} />
                <button onClick={() => importInputRef.current?.click()}
                  style={{ width: '100%', background: 'var(--bg)', color: 'var(--text-muted)', border: '0.5px solid var(--border-strong)', borderRadius: 10, padding: '11px', fontSize: 13, fontWeight: 500, cursor: 'pointer', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>⌚</span> Import from watch (Garmin .gpx / .tcx)
                </button>
              </>
            )}
            {importError && !locked && (
              <div style={{ marginBottom: 14, padding: '8px 12px', background: 'rgba(204,68,51,0.08)', border: '0.5px solid rgba(204,68,51,0.3)', borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: '#cc4433', fontWeight: 500 }}>{importError}</span>
              </div>
            )}
            {tracked && !locked && (
              <div style={{ marginBottom: 14, padding: '8px 12px', background: `var(--hyrox)14`, border: `0.5px solid var(--hyrox)40`, borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--hyrox)', fontWeight: 500 }}>
                  {captureSrc === 'import'
                    ? '✓ Imported from your watch — review below, then Complete.'
                    : '✓ GPS run captured — review below, add HR/cadence if you like, then Complete.'}
                </span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: saved ? 0 : 4 }}>
              {([
                { field: 'distance' as keyof RunLog, label: 'Distance (km)', placeholder: session.distance > 0 ? String(session.distance) : '10.0' },
                { field: 'duration' as keyof RunLog, label: 'Duration (min)', placeholder: '50' },
                { field: 'pace' as keyof RunLog, label: 'Avg pace (min/km)', placeholder: '5:00', readonly: true },
                { field: 'heartRate' as keyof RunLog, label: 'Avg heart rate', placeholder: '155' },
                { field: 'cadence' as keyof RunLog, label: 'Avg cadence (spm)', placeholder: '170' },
              ]).map(({ field, label, placeholder, readonly }) => (
                <div key={field}>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{label}</div>
                  <input
                    type={readonly ? 'text' : 'number'}
                    value={runLog[field]}
                    onChange={e => !locked && !readonly && updateRunLog(field, e.target.value)}
                    placeholder={placeholder}
                    readOnly={locked || readonly}
                    style={{
                      width: '100%', background: readonly && !saved ? 'var(--bg)' : 'var(--bg)', border: `0.5px solid ${readonly && runLog[field] ? 'var(--accent)44' : 'var(--border)'}`,
                      borderRadius: 8, padding: '8px 12px', fontSize: 13,
                      color: runLog[field] ? 'var(--accent)' : 'var(--text)',
                      outline: 'none'
                    }}
                  />
                </div>
              ))}
            </div>
            {runLog.pace && !locked && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: `var(--accent)12`, border: `0.5px solid var(--accent)30`, borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>Pace auto-calculated: {runLog.pace}/km — this will update your projected race times</span>
              </div>
            )}
          </div>
        )}

        {/* HYROX LOGGING */}
        {session.type === 'hyrox' && (
          <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '16px', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>{locked ? 'Your Hyrox log' : editing ? 'Edit your Hyrox log' : 'Log Hyrox session'}</h2>
              {hyroxStations.some(s => s.weighted) && (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 0, border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  {(['kg', 'lbs'] as const).map(u => (
                    <button key={u} onClick={() => { if (!locked) { setUnit(u); if (typeof window !== 'undefined') localStorage.setItem('mb-unit', u) } }}
                      style={{ background: unit === u ? 'var(--accent)' : 'var(--bg)', color: unit === u ? 'var(--accent-fg)' : 'var(--text-muted)', border: 'none', padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: locked ? 'default' : 'pointer' }}>{u}</button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              {[['Total time','1:05:00'],['Running time','0:32:00']].map(([label, ph]) => (
                <div key={label}>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{label}</div>
                  <input type="text" placeholder={ph} readOnly={locked}
                    value={hyroxLog[label] ?? ''}
                    onChange={e => !locked && setHyroxLog(prev => ({ ...prev, [label]: e.target.value }))}
                    style={{ width: '100%', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', outline: 'none' }} />
                </div>
              ))}
            </div>
            {hyroxStations.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 }}>Log your overall and running time above.</p>
            )}
            {hyroxStations.map(st => {
              const sets = hyroxSetsFor(st.name, st.sets)
              return (
                <div key={st.name} style={{ background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '12px', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{st.name}</span>
                    <a href={demoUrl(st.name)} target="_blank" rel="noopener noreferrer" title={`How to: ${st.name}`}
                      style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>▶ demo</a>
                    {st.presc && st.presc.toLowerCase() !== st.name.toLowerCase() && (
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>{st.presc}</span>
                    )}
                  </div>
                  {(() => {
                    const cols = st.weighted ? '28px 1fr 1fr 1.1fr' : '28px 1fr 1fr'
                    const fieldStyle: React.CSSProperties = { background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '7px 8px', fontSize: 13, color: 'var(--text)', outline: 'none', width: '100%', textAlign: 'center' }
                    const tmin = (t: string) => (t || '').split(':')[0] || ''
                    const tsec = (t: string) => (t || '').split(':')[1] || ''
                    return (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, marginBottom: 4 }}>
                          {['Set', 'Min', 'Sec', ...(st.weighted ? [`Wt (${unit})`] : [])].map(h => (
                            <span key={h} style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center' }}>{h}</span>
                          ))}
                        </div>
                        {sets.map((s, i) => (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, marginBottom: 5, alignItems: 'center' }}>
                            <span style={{ fontSize: 12, color: 'var(--text-faint)', textAlign: 'center' }}>{i + 1}</span>
                            <input inputMode="numeric" placeholder="0" readOnly={locked} value={tmin(s.time)}
                              onChange={e => !locked && updateHyroxSet(st.name, i, 'time', `${e.target.value.replace(/\D/g, '')}:${tsec(s.time)}`, st.sets)}
                              style={fieldStyle} />
                            <input inputMode="numeric" placeholder="00" readOnly={locked} value={tsec(s.time)}
                              onChange={e => !locked && updateHyroxSet(st.name, i, 'time', `${tmin(s.time)}:${e.target.value.replace(/\D/g, '').slice(0, 2)}`, st.sets)}
                              style={fieldStyle} />
                            {st.weighted && (
                              <input inputMode="numeric" placeholder={unit} readOnly={locked} value={s.weight}
                                onChange={e => !locked && updateHyroxSet(st.name, i, 'weight', e.target.value, st.sets)}
                                style={fieldStyle} />
                            )}
                          </div>
                        ))}
                      </>
                    )
                  })()}
                  {!locked && (
                    <button onClick={() => addHyroxSet(st.name, st.sets)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 500, cursor: 'pointer', padding: '2px 0', marginTop: 2 }}>+ add set</button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* How did that feel? — optional effort rating; feeds the adaptive coach */}
        <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 10 }}>
            How did that feel?{!locked && <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> · optional</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6 }}>
            {FEELS.map(f => {
              const sel = feel === f.key
              return (
                <button key={f.key} onClick={() => !locked && setFeel(sel ? null : f.key)}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 2px', borderRadius: 10, cursor: locked ? 'default' : 'pointer', border: sel ? '1.5px solid var(--accent)' : '0.5px solid var(--border)', background: sel ? 'var(--bg)' : 'transparent', opacity: locked && !sel ? 0.35 : 1, transition: 'all 0.15s' }}>
                  <span style={{ fontSize: 18 }}>{f.emoji}</span>
                  <span style={{ fontSize: 9, fontWeight: 600, color: sel ? 'var(--accent)' : 'var(--text-faint)', textAlign: 'center' }}>{f.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {!saved && (
          <button onClick={handleSave}
            style={{ width: '100%', background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 12, padding: 14, fontSize: 14, fontWeight: 500, cursor: 'pointer', marginBottom: 12, letterSpacing: '-0.2px' }}>
            Complete workout
          </button>
        )}

        {saved && (
          <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg)', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14 }}>🤖</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Milkbag Coach</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{aiLoading ? 'Analysing…' : 'Post-workout feedback'}</div>
              </div>
            </div>
            <div style={{ padding: '14px 16px', borderBottom: '0.5px solid var(--border)' }}>
              {aiLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {[0,1,2].map(i => <div key={i} className="dot-anim" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--text-faint)', animationDelay: `${i*0.2}s` }} />)}
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Analysing your session...</span>
                </div>
              ) : prose ? (
                <>
                  <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: tags.length ? 10 : 0 }}>{prose}</p>
                  {tags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {tags.map((tag: string, i: number) => (
                        <span key={i} style={{ fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 20, background: 'var(--bg)', border: '0.5px solid var(--border-strong)', color: 'var(--text-muted)' }}>{tag}</span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>No feedback saved for this session yet.</p>
              )}
            </div>
            <div style={{ padding: '10px 16px' }}>
              <p style={{ fontSize: 11, color: 'var(--text-faint)' }}>Coach feedback is stored with your workout log.</p>
            </div>
          </div>
        )}

        {saved && !editing && (
          <button onClick={() => { setSnapshot({ logs, runLog, hyroxLog, unit, feel }); setEditing(true) }}
            style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 12, padding: 13, fontSize: 14, fontWeight: 500, cursor: 'pointer', marginBottom: 12 }}>
            Edit workout
          </button>
        )}

        {editing && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <button onClick={() => { if (snapshot) { setLogs(snapshot.logs); setRunLog(snapshot.runLog); setHyroxLog(snapshot.hyroxLog); setUnit(snapshot.unit); setFeel(snapshot.feel ?? null) } setEditing(false) }}
              style={{ flex: 1, background: 'var(--bg-card)', color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 12, padding: 13, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleSave}
              style={{ flex: 2, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 12, padding: 13, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
              Save changes
            </button>
          </div>
        )}

        <button onClick={() => router.push('/dashboard')}
          style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 12, padding: 13, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          ← Back to dashboard
        </button>
      </div>
    </div>
  )
}
