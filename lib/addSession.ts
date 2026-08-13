// Add-a-session engine. Lets an athlete drop a run or a lift onto their current plan —
// one-off or recurring across the following weeks — with optional progression (build
// distance and/or pace). Pure functions so they can be tested without the app.

export interface PlanSession { day: string; type: string; title: string; details: string; duration: number; distance: number }
export interface PlanWeek { weekNumber: number; focus: string; sessions: PlanSession[] }

const roundHalf = (x: number) => Math.round(x * 2) / 2
const fmtKm = (x: number) => (x % 1 === 0 ? x.toFixed(0) : String(x))

// ── Run types ────────────────────────────────────────────────────────────────
export type RunProgression = 'distance' | 'pace' | 'none'
export interface RunType {
  id: string
  label: string
  emoji: string
  defaultKm: number
  progressable: RunProgression // how this run naturally improves week to week
  build: (km: number) => { title: string; details: string }
}

export const RUN_TYPES: RunType[] = [
  { id: 'easy', label: 'Easy / Recovery Run', emoji: '🟢', defaultKm: 8, progressable: 'distance',
    build: km => ({ title: 'Easy Run', details: `${fmtKm(km)}km easy @ conversational pace, RPE 3-4.` }) },
  { id: 'long', label: 'Long Run', emoji: '🏞️', defaultKm: 18, progressable: 'distance',
    build: km => ({ title: 'Long Run', details: `${fmtKm(km)}km steady long run, RPE 4. Fuel every 40min.` }) },
  { id: 'tempo', label: 'Tempo / Threshold', emoji: '🟠', defaultKm: 12, progressable: 'pace',
    build: km => ({ title: 'Tempo Run', details: `2km WU, ${fmtKm(Math.max(4, km - 4))}km @ threshold (comfortably hard, RPE 7), 2km CD.` }) },
  { id: 'intervals', label: 'Intervals (VO2max)', emoji: '🔴', defaultKm: 10, progressable: 'pace',
    build: km => ({ title: 'VO2max Intervals', details: `${fmtKm(km)}km session — 5-6 x 800m hard w/ 90s jog, RPE 9. Easy WU/CD.` }) },
  { id: 'racepace', label: 'Race-Pace Run', emoji: '🎯', defaultKm: 10, progressable: 'distance',
    build: km => ({ title: 'Race-Pace Run', details: `${fmtKm(km)}km @ goal race pace, RPE 6-7.` }) },
  { id: 'timetrial', label: 'Time Trial / Race', emoji: '⏱️', defaultKm: 5, progressable: 'none',
    build: km => ({ title: `${fmtKm(km)}km Time Trial`, details: `${fmtKm(km)}km all-out time trial or race — record your time.` }) },
]

export const runTypeById = (id: string) => RUN_TYPES.find(t => t.id === id) ?? RUN_TYPES[0]

// Build a run session for a given week offset, applying progression when recurring.
export function buildRunSession(typeId: string, baseKm: number, weekOffset: number, progress: boolean): PlanSession {
  const t = runTypeById(typeId)
  let km = baseKm
  let note = ''
  if (progress && weekOffset > 0) {
    if (t.progressable === 'distance') km = roundHalf(Math.min(baseKm * 1.4, baseKm * (1 + 0.06 * weekOffset)))
    else if (t.progressable === 'pace') note = ` Progression: aim ~${weekOffset * 2}s/km faster than week 1.`
  }
  const b = t.build(km)
  return { day: '', type: 'run', title: b.title, details: b.details + note, duration: Math.round(km * 5.6), distance: km }
}

// Build a lift session from chosen exercises (name + sets×reps), with optional weekly
// load progression noted in the details.
export interface LiftPick { name: string; sets: number; reps: string }
export function buildLiftSession(title: string, picks: LiftPick[], weekOffset: number, progress: boolean): PlanSession {
  const cue = progress && weekOffset > 0 ? ` @ +${(weekOffset * 2.5).toFixed(1)}kg vs week 1 where it moves` : ''
  const details = picks.map(p => `${p.name} ${p.sets}x${p.reps}`).join(', ') + (cue ? `.${cue}` : '')
  return { day: '', type: 'lift', title: title || 'Strength', details, duration: Math.max(30, picks.length * 8 + 10), distance: 0 }
}

// ── Insert into the plan ──────────────────────────────────────────────────────
export interface AddSpec {
  weekday: string         // Mon..Sun
  startWeekIndex: number  // 0-based index of the week to start from (usually current week)
  recurWeeks: number      // 1 = just this week; N = N weeks forward
  progress: boolean
  build: (weekOffset: number) => PlanSession
}

// Returns a NEW weeks array with the session added on `weekday` across the recurrence
// window. A bare Rest on that day is replaced; existing run/lift stays (becomes a double).
export function addRecurringSession(weeks: PlanWeek[], spec: AddSpec): PlanWeek[] {
  const out = weeks.map(w => ({ ...w, sessions: [...w.sessions] }))
  for (let off = 0; off < spec.recurWeeks; off++) {
    const wi = spec.startWeekIndex + off
    if (wi < 0 || wi >= out.length) break
    const sess = { ...spec.build(off), day: spec.weekday }
    // De-dupe the title against sessions already on this day. Completion is keyed by
    // (date, title), so a second "Strength" on the same day would instantly inherit
    // the first one's ✓ Done state (and its logs).
    const taken = new Set(out[wi].sessions.filter(s => s.day === spec.weekday).map(s => s.title))
    if (taken.has(sess.title)) {
      let n = 2
      while (taken.has(`${sess.title} ${n}`)) n++
      sess.title = `${sess.title} ${n}`
    }
    out[wi].sessions = out[wi].sessions.filter(s => !(s.type === 'rest' && s.day === spec.weekday))
    out[wi].sessions.push(sess)
  }
  return out
}
