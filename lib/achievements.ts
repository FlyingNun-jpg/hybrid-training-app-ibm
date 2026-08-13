// Achievements — milestone badges computed purely from logged workouts, so there is
// no extra table to maintain and history counts retroactively. The dashboard keeps a
// localStorage set of "seen" badge ids to celebrate fresh unlocks.

export type Badge = {
  id: string
  emoji: string
  name: string
  desc: string
  earned: boolean
  /** Date (YYYY-MM-DD) the badge was earned, when determinable. */
  date?: string
}

const runKm = (l: any) => parseFloat(l.log_data?.distance ?? l.log_data?.runLog?.distance) || 0

// Cumulative-threshold helper: returns the workout_date on which `total` crossed
// `threshold` (logs must be sorted ascending), or undefined if it never did.
function crossedOn(logs: any[], threshold: number, value: (l: any) => number): string | undefined {
  let total = 0
  for (const l of logs) {
    total += value(l)
    if (total >= threshold) return l.workout_date
  }
  return undefined
}

export function computeBadges(allLogs: any[], streak: number): Badge[] {
  const logs = [...allLogs].sort((a, b) => (a.workout_date || '').localeCompare(b.workout_date || ''))
  const runs = logs.filter(l => l.workout_type === 'run')
  const lifts = logs.filter(l => l.workout_type === 'lift')
  const hyrox = logs.filter(l => l.workout_type === 'hyrox')
  const totalKm = runs.reduce((a, l) => a + runKm(l), 0)
  const longest = runs.reduce((a, l) => Math.max(a, runKm(l)), 0)
  const hour = (l: any) => (l.created_at ? new Date(l.created_at).getHours() : null)

  const sessionBadge = (id: string, emoji: string, name: string, n: number): Badge => ({
    id, emoji, name, desc: `Log ${n} workouts`,
    earned: logs.length >= n, date: logs[n - 1]?.workout_date,
  })
  const kmBadge = (id: string, emoji: string, name: string, n: number): Badge => ({
    id, emoji, name, desc: `Run ${n} km lifetime`,
    earned: totalKm >= n, date: crossedOn(runs, n, runKm),
  })
  const streakBadge = (id: string, emoji: string, name: string, n: number): Badge => ({
    id, emoji, name, desc: `${n}-day training streak`, earned: streak >= n,
  })

  return [
    { id: 'first', emoji: '🎬', name: 'First rep', desc: 'Log your first workout', earned: logs.length >= 1, date: logs[0]?.workout_date },
    sessionBadge('s10', '📈', 'Regular', 10),
    sessionBadge('s50', '💪', 'Committed', 50),
    sessionBadge('s100', '🏆', 'Centurion', 100),
    sessionBadge('s250', '👑', 'Machine', 250),
    kmBadge('k50', '🏃', 'Off the couch', 50),
    kmBadge('k100', '🛣️', 'Roadrunner', 100),
    kmBadge('k500', '🗺️', 'Cartographer', 500),
    kmBadge('k1000', '🌍', 'Globe trotter', 1000),
    { id: 'long15', emoji: '⛰️', name: 'Long hauler', desc: 'A single run of 15 km+', earned: longest >= 15, date: runs.find(l => runKm(l) >= 15)?.workout_date },
    { id: 'half', emoji: '🥈', name: 'Half there', desc: 'A single run of 21.1 km+', earned: longest >= 21.1, date: runs.find(l => runKm(l) >= 21.1)?.workout_date },
    streakBadge('st3', '🔥', 'Heating up', 3),
    streakBadge('st7', '🔥', 'On fire', 7),
    streakBadge('st14', '🌋', 'Unstoppable', 14),
    streakBadge('st30', '☄️', 'Different breed', 30),
    { id: 'lift10', emoji: '🏋️', name: 'Iron apprentice', desc: 'Log 10 lifts', earned: lifts.length >= 10, date: lifts[9]?.workout_date },
    { id: 'lift50', emoji: '⚒️', name: 'Iron veteran', desc: 'Log 50 lifts', earned: lifts.length >= 50, date: lifts[49]?.workout_date },
    { id: 'hyrox1', emoji: '🦾', name: 'Hybrid mode', desc: 'Log your first Hyrox session', earned: hyrox.length >= 1, date: hyrox[0]?.workout_date },
    { id: 'hyrox10', emoji: '🤖', name: 'Station master', desc: 'Log 10 Hyrox sessions', earned: hyrox.length >= 10, date: hyrox[9]?.workout_date },
    { id: 'early', emoji: '🌅', name: 'Early bird', desc: 'Log a workout before 7am', earned: logs.some(l => { const h = hour(l); return h !== null && h < 7 }) },
    { id: 'night', emoji: '🌙', name: 'Night owl', desc: 'Log a workout after 9pm', earned: logs.some(l => { const h = hour(l); return h !== null && h >= 21 }) },
  ]
}

// Fresh unlocks = earned badges the athlete hasn't been shown yet.
const SEEN_KEY = 'mb-badges-seen'
export function unseenBadges(badges: Badge[]): Badge[] {
  if (typeof window === 'undefined') return []
  try {
    const seen: string[] = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')
    return badges.filter(b => b.earned && !seen.includes(b.id))
  } catch { return [] }
}
export function markBadgesSeen(badges: Badge[]) {
  try {
    const seen: string[] = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')
    const ids = new Set([...seen, ...badges.map(b => b.id)])
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]))
  } catch { /* noop */ }
}
