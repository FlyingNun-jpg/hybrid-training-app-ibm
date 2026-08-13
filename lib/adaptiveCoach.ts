// Adaptive coach — detects when an athlete is struggling so the AI can propose
// easing upcoming training. Two independent signals, both computed purely from
// logged workouts (no network):
//   1) Effort: post-workout feel ratings ("hard"/"very hard") stacking up in the
//      last 7 days. hard = 1 point, very hard = 2; a score of 3+ triggers.
//   2) Pace: runs repeatedly coming in well behind the session's target pace
//      (≥5% slower, 2+ runs in the last 14 days).

const DAY_MS = 86400000

// "m:ss" or "mm:ss" → seconds per km.
export function paceToSec(p: string | null | undefined): number | null {
  const m = (p || '').trim().match(/^(\d{1,2}):(\d{2})$/)
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null
}

// Target pace from a session's details, e.g. "10 km @ 5:45/km" → 345.
export function targetPaceSec(details: string | null | undefined): number | null {
  const m = (details || '').match(/(\d{1,2}):(\d{2})\s*(?:\/|per\s*)\s*km/i)
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null
}

const fmtPace = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}/km`

export type StruggleEvidence = {
  date: string
  title: string
  type: string
  feel?: string
  pace?: string
  targetPace?: string
  distanceKm?: number
}

export type StruggleReport = {
  triggered: boolean
  reasons: string[]            // short human-readable lines for the card
  evidence: StruggleEvidence[] // slim extracts sent to the AI
}

export function detectStruggle(allLogs: any[]): StruggleReport {
  const now = Date.now()
  const ageDays = (dateStr: string) => (now - Date.parse(dateStr + 'T00:00:00')) / DAY_MS
  const reasons: string[] = []
  const evidence: StruggleEvidence[] = []

  // ── Signal 1: effort ratings (7 days) ──
  let effortScore = 0
  let hardCount = 0
  for (const l of allLogs) {
    if (!l.workout_date || ageDays(l.workout_date) > 7 || ageDays(l.workout_date) < 0) continue
    const feel = l.log_data?.feel
    if (feel === 'hard' || feel === 'very_hard') {
      effortScore += feel === 'very_hard' ? 2 : 1
      hardCount++
      evidence.push({ date: l.workout_date, title: l.title, type: l.workout_type, feel })
    }
  }
  if (effortScore >= 3) {
    reasons.push(`${hardCount} session${hardCount > 1 ? 's' : ''} in the last week felt hard or worse`)
  }

  // ── Signal 2: missed run paces (14 days) ──
  const slowRuns: { logged: number; target: number }[] = []
  for (const l of allLogs) {
    if (l.workout_type !== 'run' || !l.workout_date) continue
    if (ageDays(l.workout_date) > 14 || ageDays(l.workout_date) < 0) continue
    const logged = paceToSec(l.log_data?.pace ?? l.log_data?.runLog?.pace)
    const target = targetPaceSec(l.log_data?.session?.details)
    if (logged == null || target == null) continue
    if (logged > target * 1.05) {
      slowRuns.push({ logged, target })
      evidence.push({
        date: l.workout_date, title: l.title, type: 'run',
        feel: l.log_data?.feel,
        pace: fmtPace(logged), targetPace: fmtPace(target),
        distanceKm: parseFloat(l.log_data?.distance ?? l.log_data?.runLog?.distance) || undefined,
      })
    }
  }
  if (slowRuns.length >= 2) {
    const worst = slowRuns.reduce((a, b) => (b.logged / b.target > a.logged / a.target ? b : a))
    reasons.push(`${slowRuns.length} runs came in behind target pace (e.g. ${fmtPace(worst.logged)} vs ${fmtPace(worst.target)} planned)`)
  }

  return { triggered: reasons.length > 0, reasons, evidence }
}
