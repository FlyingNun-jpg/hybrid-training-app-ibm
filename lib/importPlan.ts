// Validates and coerces an uploaded plan file (our JSON schema) into a training_plans
// row, anchored to the calendar. Importing is deterministic — the plan is saved exactly
// as written (no AI, no normalizer reshuffling) so an athlete's own plan stays intact.

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TYPES = ['run', 'lift', 'hyrox', 'rest']

export interface ImportResult {
  ok: boolean
  error?: string
  plan?: {
    plan_name: string
    plan_type: string
    goal_race: string
    goal_race_date: string | null
    start_date: string
    end_date: string | null
    plan_data: any
  }
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function coerceImportedPlan(raw: any): ImportResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'That file isn\'t a valid plan (expected a JSON object).' }
  const weeksRaw = Array.isArray(raw.weeks) ? raw.weeks : null
  if (!weeksRaw || weeksRaw.length === 0) return { ok: false, error: 'No "weeks" found in the file.' }

  const weeks = weeksRaw.map((w: any, i: number) => {
    const sessions = (Array.isArray(w.sessions) ? w.sessions : []).map((s: any) => ({
      day: DAYS.includes(s.day) ? s.day : 'Mon',
      type: TYPES.includes(s.type) ? s.type : 'run',
      title: (String(s.title ?? '').trim() || 'Session').slice(0, 80),
      details: String(s.details ?? ''),
      duration: Number(s.duration) || 0,
      distance: Number(s.distance) || 0,
    }))
    return { weekNumber: Number(w.weekNumber) || i + 1, focus: String(w.focus ?? ''), sessions }
  })

  // Anchor: startMonday = Monday of the plan's start date so the dashboard shows the
  // correct current week even if the plan began in the past.
  const start = raw.startDate ? new Date(String(raw.startDate) + 'T00:00:00') : new Date()
  if (isNaN(start.getTime())) return { ok: false, error: 'The plan\'s startDate is invalid.' }
  const dow = start.getDay()
  const monday = new Date(start); monday.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1))
  const startMonday = iso(monday)
  const activeFrom = raw.startDate ? iso(start) : iso(new Date())
  const goalRace = String(raw.goalRace || raw.planType || 'marathon')

  return {
    ok: true,
    plan: {
      plan_name: String(raw.planName || 'Imported Plan'),
      plan_type: goalRace,
      goal_race: goalRace,
      goal_race_date: raw.raceDate ? String(raw.raceDate) : null,
      start_date: activeFrom,
      end_date: raw.raceDate ? String(raw.raceDate) : null,
      plan_data: {
        planName: String(raw.planName || 'Imported Plan'),
        weeks, startMonday, activeFrom,
        timeGoal: String(raw.timeGoal || ''),
        goalRace, imported: true,
      },
    },
  }
}
