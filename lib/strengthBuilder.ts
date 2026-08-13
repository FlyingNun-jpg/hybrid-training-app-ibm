// Turns a user-built recurring strength template into a full multi-week plan in the
// exact plan_data shape the rest of the app already consumes (dashboard, workout
// logger, image sync, PB/e1RM engines). The structured template is also stored on the
// plan so it can be re-edited and so the AI can program running AROUND it later.

import type { SplitId } from './exerciseLibrary'

export interface TemplateExercise {
  name: string   // full catalog name — drives the demo image
  sets: number
  reps: string   // e.g. "5", "8-10", "30s"
}

export interface TemplateDay {
  day: string    // weekday: Mon/Tue/...
  label: string  // e.g. "Push"
  role: string   // push/pull/legs/upper/lower/full — used for "apply to all" propagation
  exercises: TemplateExercise[]
}

export interface StrengthTemplate {
  splitId: SplitId
  days: TemplateDay[]
}

export type Progression = 'linear' | 'percent' | 'rpe'

export interface BuilderConfig {
  planName: string
  weeks: number          // block length
  progression: Progression
  deload: boolean        // make every 4th week a lighter deload
}

// A deload falls on every 4th week (weeks 4, 8, 12...) when enabled and the block is
// long enough to warrant one.
function isDeloadWeek(weekIdx: number, cfg: BuilderConfig): boolean {
  return cfg.deload && cfg.weeks >= 4 && (weekIdx + 1) % 4 === 0
}

// Per-week intensity guidance. The app logs real weights and computes e1RM, so this is
// a coaching cue appended to each lift, not a hard number — load progresses while sets
// and reps stay fixed (progressive overload), with a lighter deload.
function weekCue(weekIdx: number, cfg: BuilderConfig): { focus: string; cue: (main: boolean) => string } {
  const n = cfg.weeks
  const deload = isDeloadWeek(weekIdx, cfg)
  // Count non-deload weeks up to here to ramp intensity smoothly.
  let progressStep = 0
  for (let i = 0; i <= weekIdx; i++) if (!isDeloadWeek(i, cfg)) progressStep++

  if (cfg.progression === 'percent') {
    const base = 70
    const pct = deload ? 60 : Math.min(base + (progressStep - 1) * 2.5, 90)
    return {
      focus: deload ? `Week ${weekIdx + 1} · Deload (~60% 1RM)` : `Week ${weekIdx + 1} · ~${pct}% 1RM`,
      cue: main => main ? `@${pct}% 1RM` : `@RPE ${deload ? 6 : Math.min(7 + Math.floor((progressStep - 1) / 2), 9)}`,
    }
  }
  if (cfg.progression === 'rpe') {
    const rpe = deload ? 6 : Math.min(7 + Math.floor((progressStep - 1) / Math.max(1, Math.ceil(n / 3))), 9)
    return {
      focus: deload ? `Week ${weekIdx + 1} · Deload (RPE 6)` : `Week ${weekIdx + 1} · RPE ${rpe}`,
      cue: () => `@RPE ${rpe}`,
    }
  }
  // linear (default): add a little load each week, hold reps.
  const firstWorkingWeek = weekIdx === 0
  return {
    focus: deload ? `Week ${weekIdx + 1} · Deload — drop ~10% load` : firstWorkingWeek ? `Week 1 · Set your working weights` : `Week ${weekIdx + 1} · Add load vs last week`,
    cue: main => deload ? '@ deload, ~10% lighter' : main ? (firstWorkingWeek ? '@ working weight (2 reps in reserve)' : '@ +2.5kg vs last week') : `@RPE ${Math.min(7 + Math.floor((progressStep - 1) / 2), 9)}`,
  }
}

// Estimate a session's duration from its working sets (~3.5 min/set incl. rest + warm-up).
function estimateDuration(ex: TemplateExercise[]): number {
  const sets = ex.reduce((a, e) => a + (e.sets || 0), 0)
  return Math.max(30, Math.min(90, Math.round((10 + sets * 3.5) / 5) * 5))
}

const MAIN_RE = /squat|bench|dead\s?lift|overhead press|\brow\b/i
const isMain = (name: string) => MAIN_RE.test(name)

// Serialize a day's exercises into the comma-separated `details` string the workout
// page parses. Full names are preserved so the demo-image sync resolves correctly.
function serializeDetails(ex: TemplateExercise[], cue: (main: boolean) => string): string {
  return ex.map(e => `${e.name} ${e.sets}x${e.reps} ${cue(isMain(e.name))}`.trim()).join(', ')
}

export interface PlanSession {
  day: string
  type: 'lift' | 'rest'
  title: string
  details: string
  duration: number
  distance: number
}

export interface PlanWeek {
  weekNumber: number
  focus: string
  sessions: PlanSession[]
}

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// A role-appropriate Hyrox finisher to fold into a lift day (Hyrox goals only). Stations
// are chosen to complement the day's pattern — loaded carries/sled on leg/lower days,
// upper-body engine work on push/pull days. Names match the Hyrox station list so they
// read consistently with the rest of the app.
export function hyroxCircuitFor(role: string): string {
  const map: Record<string, string> = {
    legs: 'Sled Push 4×12m, Sandbag Lunges 4×20m, Wall Balls 4×15',
    lower: 'Sled Push 4×12m, Sandbag Lunges 4×20m, Wall Balls 4×15',
    pull: 'Row 4×250m, Farmers Carry 4×40m',
    push: 'Wall Balls 4×15, SkiErg 4×250m',
    upper: 'SkiErg 4×250m, Wall Balls 4×15',
    full: 'Burpee Broad Jumps 4×10m, Row 4×250m, Farmers Carry 4×40m',
  }
  return map[role] ?? 'SkiErg 4×250m, Wall Balls 4×15'
}

// Merge a fixed user strength template into an AI-generated set of weeks: on each lift
// weekday we REPLACE whatever the AI put with the user's exact lift session (progressing
// load via the same rules), keeping the AI's runs/conditioning on all other days. This
// guarantees the user's lifts and their demo images survive untouched. When hyroxCircuits
// is on, an appropriate finisher is appended to each lift day's details.
export function overlayFixedStrength(aiWeeks: any[], template: StrengthTemplate, cfg: BuilderConfig, opts: { hyroxCircuits: boolean }): any[] {
  const built = buildWeeks(template, { ...cfg, weeks: aiWeeks.length })
  const liftWeekdays = new Set(template.days.map(d => d.day))
  const roleByDay = new Map(template.days.map(d => [d.day, d.role]))
  return aiWeeks.map((wk: any, i: number) => {
    const builtWk = built[i] ?? built[built.length - 1]
    const liftSessions = builtWk.sessions.filter(s => s.type === 'lift')
    // Hyrox circuits become their OWN session on the same day as the lift — its own hero
    // card with split-time logging — rather than being tacked onto the lift's details.
    const hyroxSessions = opts.hyroxCircuits
      ? liftSessions.map(s => ({ day: s.day, type: 'hyrox', title: 'Hyrox Stations', details: hyroxCircuitFor(roleByDay.get(s.day) ?? 'full'), duration: 25, distance: 0 }))
      : []
    // Keep the AI's runs — INCLUDING any run the athlete pinned onto a lift day (it stays
    // as a double). Replace the AI's lifts and drop a bare rest on a lift day.
    const kept = (wk.sessions ?? []).filter((s: any) => s.type !== 'lift' && s.type !== 'hyrox' && !(s.type === 'rest' && liftWeekdays.has(s.day)))
    return { ...wk, sessions: [...kept, ...liftSessions, ...hyroxSessions] }
  })
}

// Build the full weeks array. Lift days repeat every week with progressing load; the
// remaining days are explicit rest sessions so the dashboard shows a proper rest card.
export function buildWeeks(template: StrengthTemplate, cfg: BuilderConfig): PlanWeek[] {
  const liftDays = new Set(template.days.map(d => d.day))
  const weeks: PlanWeek[] = []
  for (let w = 0; w < cfg.weeks; w++) {
    const { focus, cue } = weekCue(w, cfg)
    const sessions: PlanSession[] = []
    for (const day of ALL_DAYS) {
      const td = template.days.find(d => d.day === day)
      if (td && td.exercises.length > 0) {
        sessions.push({
          day,
          type: 'lift',
          title: td.label,
          details: serializeDetails(td.exercises, cue),
          duration: estimateDuration(td.exercises),
          distance: 0,
        })
      } else if (!liftDays.has(day)) {
        sessions.push({ day, type: 'rest', title: 'Rest', details: 'Recovery day — mobility, light cardio or full rest.', duration: 0, distance: 0 })
      }
    }
    weeks.push({ weekNumber: w + 1, focus, sessions })
  }
  return weeks
}
