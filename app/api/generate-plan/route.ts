// IBM WatsonX.ai — training plan generation
// WHY GRANITE FOR PLAN GEN: The granite-3-3-8b-instruct model is a compact,
// fast instruction-following model ideal for structured JSON output generation.
// WatsonX.ai's enterprise inference API guarantees consistent throughput with
// SLA-backed availability — critical when generating a 16-week plan that the
// athlete may be counting on for race day.

import { WatsonXAI } from '@ibm-cloud/watsonx-ai'
import { IamAuthenticator } from 'ibm-cloud-sdk-core'
import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, rateLimit } from '@/lib/apiAuth'
import { normalizePlan, buildDaySkeleton } from '@/lib/planNormalize'

export const maxDuration = 300
export const runtime = 'nodejs'

// WatsonX client — single instance reused across requests
const watsonx = WatsonXAI.newInstance({
  authenticator: new IamAuthenticator({ apikey: process.env.WATSONX_API_KEY! }),
  serviceUrl: process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com',
  version: '2024-05-31',
})

const RACE_WEEKS: Record<string, number> = {
  marathon: 16, half_marathon: 12, '5k': 8, hyrox: 12, hyrox_doubles: 12, hybrid: 8,
}

// Recommended PEAK weekly running volume (km) by goal + time goal. Must mirror the
// table in app/onboarding/page.tsx. Used as a server-side fallback if the client
// doesn't send an explicit peakKm.
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
function recommendedPeakKm(goalRace: string, timeGoal: string, fitnessLevel: string): number {
  const base = PEAK_VOLUME[goalRace]?.[timeGoal] ?? 60
  return roundTo5(base * (FITNESS_VOL_MULT[fitnessLevel] ?? 1))
}

const LONG_RUN_CAP: Record<string, number> = {
  marathon: 32, half_marathon: 22, '5k': 16, hyrox: 21, hyrox_doubles: 21, hybrid: 28,
}

// Deterministic per-week running volume (km). The model is bad at summing session
// distances to hit an aggregate target, so we hand it explicit weekly numbers:
// a progressive build to the peak (2-3 wks before taper), deloads every 4th week,
// then a descending taper. This is what makes the peak selection actually bite.
function weeklyVolumeTargets(weeks: number, peak: number, isRace: boolean): number[] {
  const taperLen = isRace ? Math.min(3, Math.max(2, Math.round(weeks * 0.18))) : 0
  const buildWeeks = Math.max(1, weeks - taperLen)
  const peakIdx = buildWeeks - 1
  const startFrac = 0.6
  const out: number[] = []
  for (let i = 0; i < weeks; i++) {
    if (i >= buildWeeks) {
      const taperFracs = [0.6, 0.45, 0.33]
      out.push(roundTo5(peak * (taperFracs[i - buildWeeks] ?? 0.33)))
    } else {
      let frac = peakIdx === 0 ? 1 : startFrac + (1 - startFrac) * (i / peakIdx)
      frac = Math.min(frac, 1)
      // deload every 4th week, but never deload the peak week or the week right before it
      if ((i + 1) % 4 === 0 && i !== peakIdx && i !== peakIdx - 1) frac *= 0.72
      out.push(roundTo5(peak * frac))
    }
  }
  return out
}

const PLAN_NAMES: Record<string, string> = {
  marathon: 'Marathon Training Plan',
  half_marathon: 'Half Marathon Training Plan',
  '5k': '5K PR Training Plan',
  hyrox: 'Hyrox Training Plan',
  hyrox_doubles: 'Hyrox Doubles Training Plan',
  hybrid: 'Hybrid Athlete Block',
}

// LOCKED Hyrox strength templates — fixed exercises the model must use verbatim on
// every lift day for the whole block (only load/reps progress). Removes AI variability
// so the athlete can progressively overload and track PRs. Research-backed selection.
function hyroxStrengthBlock(liftN: number, hasGym: boolean): string {
  if (liftN <= 0) return ''
  const gym = {
    legs: `LEGS (squat-focused):
1) Back Squat — PRIMARY heavy (early 4-5x3-5 @82-88% 1RM; later 4x5-6 @78-82%). Progress weekly.
2) Romanian Deadlift — 3x8
3) Walking Lunge (DB/barbell) — 3x20m
4) Standing Calf Raise (machine) — 3x15
5) Hanging Leg Raise — 3x12`,
    push: `PUSH (press-focused):
1) Overhead Press (barbell) — PRIMARY heavy (4-5x4-6). Progress weekly.
2) Bench Press (barbell) — 4x6
3) Incline Dumbbell Press — 3x10
4) Lateral Raise (cable/machine) — 3x15
5) Triceps Pushdown (cable) — 3x12`,
    pull: `PULL (posterior + grip — the Hyrox bias):
1) Deadlift — PRIMARY heavy (early 4-5x3-5 @82-88%; later 4x5). Progress weekly.
2) Weighted Pull-up — 4x6
3) Barbell Row (Pendlay/bent-over) — 4x8
4) Face Pull (cable) — 3x15
5) Biceps Curl (barbell/DB) — 3x12`,
    lower: `LOWER (legs + posterior):
1) Back Squat — PRIMARY heavy. Progress weekly.
2) Romanian Deadlift — 3x8
3) Walking Lunge — 3x20m
4) Standing Calf Raise (machine) — 3x15`,
    upper: `UPPER (push + pull):
1) Overhead Press — PRIMARY heavy. Progress weekly.
2) Weighted Pull-up — 4x6
3) Bench Press — 4x6
4) Barbell Row — 4x8
5) Lateral Raise (machine) 3x15 + Face Pull 3x15`,
    full: `FULL BODY:
1) Back Squat — PRIMARY heavy. Progress weekly.
2) Trap-bar Deadlift — 3x5
3) Overhead Press — 3x6
4) Weighted Pull-up — 3x6
5) Standing Calf Raise (machine) — 3x15`,
    posterior: `POSTERIOR / POWER:
1) Deadlift — PRIMARY heavy (4x3 @85%). Progress weekly.
2) Hip Thrust — 3x8
3) Power Clean or KB Swing — 4x3-5 explosive
4) Box Jump — 3x5`,
  }
  const home = {
    legs: `LEGS (squat-focused — home):
1) Bulgarian Split Squat (backpack) — PRIMARY (4x8-12/leg; progress reps then load the pack).
2) Reverse Lunge (backpack) — 3x12/leg
3) Single-leg Romanian Deadlift — 3x10/leg
4) Single-leg Calf Raise — 3x20
5) Wall Sit — 3x45s`,
    push: `PUSH (press-focused — home):
1) Pike Push-up (feet elevated to harden) — PRIMARY (4x8-12; progress reps/range). [overhead-press pattern]
2) Push-up — 4x15
3) Decline Push-up (feet elevated) — 3x12
4) Lateral Raise (water jugs) — 3x15
5) Chair Dips — 3x12`,
    pull: `PULL (posterior + grip — home):
1) Inverted Row (under a sturdy table or low bar) — PRIMARY (4x10-15; progress reps/feet elevation).
2) Pull-up (if a bar) OR Backpack Bent-over Row — 4x8-12
3) Towel/Doorway Row — 3x12
4) Superman / Back Extension — 3x15
5) Backpack RDL — 3x12`,
    lower: `LOWER (legs + posterior — home):
1) Bulgarian Split Squat (backpack) — PRIMARY (4x8-12/leg). Progress reps then load.
2) Single-leg RDL — 3x10/leg
3) Reverse Lunge — 3x12/leg
4) Single-leg Calf Raise — 3x20`,
    upper: `UPPER (push + pull — home):
1) Pike Push-up — PRIMARY (4x8-12). Progress reps/range.
2) Pull-up or Backpack Row — 4x8-12
3) Push-up — 4x15
4) Inverted Row — 4x12
5) Lateral Raise (jugs) 3x15 + Chair Dips 3x12`,
    full: `FULL BODY (home):
1) Bulgarian Split Squat (backpack) — PRIMARY 4x10/leg. Progress reps/load.
2) Single-leg RDL — 3x10/leg
3) Pike Push-up — 3x10
4) Pull-up or Backpack Row — 3x10
5) Single-leg Calf Raise — 3x20`,
    posterior: `POSTERIOR / POWER (home):
1) Single-leg RDL (backpack) — PRIMARY 4x10/leg.
2) Glute Bridge / Hip Thrust (backpack) — 3x15
3) Broad Jump / Jump Squat — 4x5 (power)
4) Loaded Carry (pack) — 3x40m`,
  }
  const T = hasGym ? gym : home
  const { legs, push, pull, lower, upper, full, posterior } = T
  let days: string[]
  if (liftN === 1) days = [full]
  else if (liftN === 2) days = [lower, upper]
  else if (liftN === 3) days = [legs, push, pull]
  else days = [legs, push, pull, posterior]
  const extra = liftN > 4 ? `\n(For the ${liftN - 4} extra lift day(s): repeat the LEGS or PULL template at a lighter strength-endurance load — still NO new exercises.)` : ''
  const body = days.map((d, i) => `${days.length > 1 ? `LIFT DAY ${i + 1} — ` : 'LIFT DAY — '}${d}`).join('\n\n')
  const modeNote = hasGym
    ? 'progress ~2.5% load or +1 rep once the target RPE is met'
    : 'the athlete has NO gym — these are HOME/BODYWEIGHT movements; progress by reps, tempo, harder single-leg variations and pauses (and added backpack/jug load) since barbell loading is unavailable'
  return `LOCKED STRENGTH TEMPLATE — NON-NEGOTIABLE. Use these EXACT exercises on the lift days for the ENTIRE block. Do NOT substitute, add, remove, reorder, or rotate movements between weeks. The ONLY things that change week to week are LOAD/intensity and rep scheme per the periodization: build across the block, ${modeNote}, deload/taper weeks lighter. This consistency is deliberate — it lets the athlete progressively overload and track PRs. Each lift day's "title" must name its role (e.g. "Legs — Squat", "Push", "Pull"). Put the full exercise list in that session's "details", writing each exercise's FULL name (e.g. "Bench Press", "Incline Dumbbell Press", "Overhead Press", "Romanian Deadlift", "Lateral Raise") — NEVER abbreviate to "Bench", "Incline DB", "RDL", "OHP" or "Lat Raise"; the app uses the full name to show a form demo.

${body}${extra}`
}

function buildExpertBrief(goalRace: string, weeks: number, timeGoal: string, runN: number, liftN: number): string {
  const common = `
NON-NEGOTIABLE OUTPUT STANDARDS (this is an elite, paid-tier coaching product — every session must read like a world-class coach wrote it):
- Every RUN session states: exact distance (km), exact target pace range (min/km) tied to the athlete's goal via VDOT, and a target RPE (1-10).
- Every LIFT session states: each main movement with sets x reps and load as %1RM (e.g. "Back squat 4x5 @82% 1RM"), plus RPE. Accessories can use RPE/rep targets.
- Every HYROX/conditioning session states: the exact circuit (movements, distances, reps, weights in kg) and target RPE.
- Name the physiological PURPOSE succinctly where it fits (e.g. "builds lactate threshold", "aerobic base", "race-pace economy").
- Hold easy days genuinely easy (RPE 3-4) and hard days genuinely hard (RPE 7-9). Eliminate the moderate "gray zone" — this polarized 80/20 distribution is the single most evidence-backed driver of endurance gains (Seiler).`

  switch (goalRace) {
    case 'marathon':
      return `You are a world-class marathon coach steeped in the Jack Daniels VDOT system, Lydiard periodization, and Pfitzinger threshold work. Build a ${weeks}-week marathon plan precisely engineered for the goal: "${timeGoal}".
${common}

MARATHON-SPECIFIC SCIENCE:
- THE THREE THRESHOLDS: (1) aerobic base via high easy volume, (2) lactate threshold via weekly tempo/threshold work (T-pace), (3) marathon-pace economy via M-pace segments.
- POLARIZED 80/20: ~80% Easy, ~20% quality.
- LONG RUN: cornerstone, progress ~1-2km every 1-2 weeks, cap ~32km. Insert M-pace finishes in build/peak. Cut back ~25% every 3rd-4th week.
- WEEKLY: max 2 hard run days (one threshold, one long-with-quality). Never back-to-back.
- PHASES: Base → Build → Peak → TAPER final 2-3 weeks.
- DELOAD every 4th week (~25-30% cut).
- STRENGTH supports running: upper body + explosive/light lower, never heavy legs within 48h of long run or threshold day.`

    case 'half_marathon':
      return `You are a world-class half-marathon coach using the Jack Daniels VDOT system. Build a ${weeks}-week plan for the goal: "${timeGoal}".
${common}

HALF-MARATHON SCIENCE:
- Lactate threshold is king. Weekly threshold work is the highest-value session.
- POLARIZED 80/20. Add VO2max intervals in build phase.
- LONG RUN builds to ~18-22km with HM-pace segments in build/peak. Step back ~25% every 3rd week.
- WEEKLY: 2 quality run days max, never back-to-back.
- PHASES: Base → Build → Peak → TAPER final 2 weeks. DELOAD every 4th week.`

    case '5k':
      return `You are a world-class 5K coach using the Jack Daniels VDOT system and Norwegian-style threshold work. Build a ${weeks}-week plan for the goal: "${timeGoal}".
${common}

5K SCIENCE:
- VO2max INTERVALS at I-pace (800m-1200m work bouts) + weekly THRESHOLD at T-pace.
- POLARIZED 80/20. STRIDES 2x/week after easy runs.
- LONG RUN ~25-30% of weekly volume, capped ~${LONG_RUN_CAP['5k']}km.
- REPETITION work in sharpening phase for neuromuscular speed.
- PHASES: Base → VO2max/Quality → Sharpening → TAPER. DELOAD every 4th week.`

    case 'hyrox':
      return `You are a world-class Hyrox coach. The event is 8x1km runs each followed by a functional station. ~50% of finish time is RUNNING. Build a ${weeks}-week plan for the goal: "${timeGoal}".
${common}

HYROX SCIENCE:
- THE RUNNING ENGINE IS HALF-MARATHON LEVEL — program running like a HM plan: weekly long run to 16-21km, weekly threshold, easy Zone 2 volume.
- COMPROMISED RUNNING 1-2x most weeks: runs immediately after fatiguing station work (e.g. "5 rounds: 1000m row + 1km run @race pace + 20 wall balls 6kg").
- RACE-PACE ECONOMY: 6-8x1km @goal race split intervals.
- STRENGTH IS LOCKED — follow the template below VERBATIM. Never put stations in a lift day.
- ALL 8 STATIONS EVERY WEEK: SkiErg, Sled Push, Sled Pull, Burpee Broad Jump, Row, Farmers Carry, Sandbag Lunges, Wall Balls — in dedicated HYROX sessions.
- SESSION TYPES: RUN = pure running, LIFT = pure strength, HYROX = stations + compromised runs (placed same day as lift, distance 0).
- PHASES: Base (engine + max strength) → Intensity → Peak (race simulations weeks ${weeks-2}-${weeks-1}) → TAPER (week ${weeks}). DELOAD every 4th week.`

    case 'hyrox_doubles':
      return `You are a world-class Hyrox Doubles coach. Build a ${weeks}-week plan for the goal: "${timeGoal}".
${common}

HYROX DOUBLES SCIENCE:
- Each athlete runs ALL 8km (stations are shared). Program running like a HM plan.
- COMPROMISED RUNNING 1-2x most weeks.
- PARTNER TACTICS: relay-style station splits, transition drills.
- STRENGTH IS LOCKED — follow template below VERBATIM. Never put stations in a lift.
- ALL 8 STATIONS EVERY WEEK in dedicated HYROX sessions with partner relay splits.
- SESSION TYPES: RUN = pure running, LIFT = pure strength, HYROX = stations (distance 0, same day as lift).
- PHASES: Base → Intensity → Peak (partner simulations weeks ${weeks-2}-${weeks-1}) → TAPER. DELOAD every 4th week.`

    case 'hybrid':
    default:
      return `You are a world-class hybrid-performance coach. Build a ${weeks}-week block for an athlete who wants to run AND lift at a high level. Primary focus: "${timeGoal}".
${common}

HYBRID SCIENCE:
- MANAGE INTERFERENCE: never a hard run the day after heavy legs. Easy Zone 2 runs can pair with upper-body lifts.
- STRENGTH: genuine progressive overload on compounds (squat, deadlift, bench, OHP, row) 4-8 rep range @75-87% 1RM.
- RUNNING: mostly Zone 2, 2-3x/week, plus ONE weekly quality session.
- CONDITIONING: 1 metabolic session per week.
- DELOAD weeks 4 and 8. Bias toward "${timeGoal}".`
  }
}

function parseTimeToSec(s?: string | null): number | null {
  if (!s) return null
  const parts = s.replace(/[^\d:]/g, '').split(':').map(p => parseInt(p, 10))
  if (!parts.length || parts.some(n => Number.isNaN(n))) return null
  if (parts.length === 1) return parts[0] * 60
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}
const secToPace = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`

const VDOT_ANCHORS: ReadonlyArray<readonly [number, string, string, string, string]> = [
  [1840, '7:40-8:15', '6:24', '5:51', '5:24'],
  [1659, '6:55-7:30', '5:48', '5:18', '4:54'],
  [1512, '6:23-6:58', '5:19', '4:54', '4:31'],
  [1389, '5:53-6:28', '4:54', '4:31', '4:09'],
  [1285, '5:30-6:03', '4:36', '4:12', '3:53'],
  [1197, '5:08-5:42', '4:15', '3:55', '3:38'],
  [1120, '4:50-5:22', '4:00', '3:41', '3:25'],
  [1053, '4:34-5:05', '3:48', '3:28', '3:13'],
  [994,  '4:20-4:50', '3:34', '3:17', '3:03'],
]
function fivekPaceFromSeconds(sec: number): { e: string; t: string; i: string; r: string } {
  let best = VDOT_ANCHORS[0]
  for (const row of VDOT_ANCHORS) if (Math.abs(row[0] - sec) < Math.abs(best[0] - sec)) best = row
  return { e: best[1], t: best[2], i: best[3], r: best[4] }
}
function fivekPaces(timeGoal: string, currentPr?: string | null): string {
  if (timeGoal === 'Just finish') {
    return 'Run easy and conversational throughout; use run/walk as needed. No strict pace targets.'
  }
  const goalSec = parseTimeToSec(timeGoal.replace(/sub/i, ''))
  const goalPace = goalSec ? secToPace(goalSec / 5) : null
  const ASSUMED: Record<string, number> = {
    'Sub 18:00': 1110, 'Sub 20:00': 1230, 'Sub 22:30': 1380, 'Sub 25:00': 1530, 'Sub 30:00': 1830,
  }
  const prSec = parseTimeToSec(currentPr)
  const sec = prSec ?? ASSUMED[timeGoal] ?? 1530
  const p = fivekPaceFromSeconds(sec)
  const src = prSec ? `calibrated to the athlete's current 5K PR of ${currentPr}` : 'estimated from fitness level + goal'
  return `Easy/recovery (E) ${p.e}/km. Threshold (T) ${p.t}/km. VO2max interval (I) ${p.i}/km. Repetition/speed (R) ${p.r}/km.${goalPace ? ` Goal 5K race pace ${goalPace}/km.` : ''} Training paces are ${src}.`
}

function paceTargets(goalRace: string, timeGoal: string): string {
  const guides: Record<string, Record<string, string>> = {
    marathon: {
      'Sub 3:00': 'Marathon pace 4:16/km. Easy/long 4:45-5:15/km. Threshold/tempo 4:00/km. Intervals 3:40-3:50/km.',
      'Sub 3:30': 'Marathon pace 4:58/km. Easy/long 5:30-6:00/km. Threshold/tempo 4:40/km. Intervals 4:15-4:25/km.',
      'Sub 4:00': 'Marathon pace 5:41/km. Easy/long 6:15-6:45/km. Threshold/tempo 5:20/km. Intervals 4:55-5:05/km.',
      'Sub 4:30': 'Marathon pace 6:23/km. Easy/long 7:00-7:30/km. Threshold/tempo 6:00/km. Intervals 5:35-5:45/km.',
      'Sub 5:00': 'Marathon pace 7:06/km. Easy/long 7:45-8:15/km. Threshold/tempo 6:40/km. Intervals 6:10-6:20/km.',
      'Finish strong': 'Run easy and conversational throughout. Walk breaks are smart.',
    },
    half_marathon: {
      'Sub 1:30': 'HM pace 4:16/km. Easy 4:50-5:20/km. Threshold 4:00/km. Intervals 3:40/km.',
      'Sub 1:45': 'HM pace 4:58/km. Easy 5:35-6:05/km. Threshold 4:40/km. Intervals 4:20/km.',
      'Sub 2:00': 'HM pace 5:41/km. Easy 6:20-6:50/km. Threshold 5:20/km. Intervals 5:00/km.',
      'Sub 2:15': 'HM pace 6:23/km. Easy 7:05-7:35/km. Threshold 6:00/km. Intervals 5:35/km.',
      'Sub 2:30': 'HM pace 7:06/km. Easy 7:50-8:20/km. Threshold 6:40/km. Intervals 6:10/km.',
      'Finish strong': 'Run easy and conversational throughout. Build to the distance comfortably.',
    },
    hyrox: {
      'Sub 1:00': 'Elite. 1km run splits under 3:45. Stations at full competition weights.',
      'Sub 1:15': '1km splits ~4:15. Stations ~85% competition weight.',
      'Sub 1:30': '1km splits ~4:45. Stations ~75% competition weight.',
      'Sub 1:45': '1km splits ~5:15. Stations ~65% competition weight.',
      'Sub 2:00': '1km splits ~5:45. Stations ~55% competition weight.',
      'Finish strong': 'Steady sustainable pace. Scale weights to keep moving.',
    },
    hyrox_doubles: {
      'Sub 1:15': 'Elite doubles. 1km splits under 4:00. Full competition weights.',
      'Sub 1:30': '1km splits ~4:30. Competition weights.',
      'Sub 1:45': '1km splits ~5:00. ~80% competition weights.',
      'Sub 2:00': '1km splits ~5:30. ~70% competition weights.',
      'Sub 2:15': '1km splits ~6:00. Scaled weights.',
      'Finish strong': 'Teamwork and steady pacing. Finish strong together.',
    },
    hybrid: {
      'Build strength': 'Strength priority — heavier compounds (3-6 reps), longer rest. Runs easy Zone 2.',
      'Improve running': 'Running priority — more volume, one quality session/week. Strength maintenance.',
      'Equal balance': 'Even emphasis — quality strength AND quality running, carefully spaced.',
      'Conditioning focus': 'Metabolic conditioning and circuits lead. Moderate strength, steady aerobic base.',
    },
  }
  return guides[goalRace]?.[timeGoal] ?? ''
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`generate:${user.id}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly.' }, { status: 429 })
  }

  const {
    goalRace, raceDate, fitnessLevel, runCount, liftCount, runDays, liftDays,
    longRunDay, peakKm, canDoubleUp, hasGym, weeks: requestedWeeks, timeGoal,
    fixedStrength, restDays, currentPr,
  } = await req.json()

  const gymAccess = hasGym !== false
  const fixedStrengthNote = fixedStrength?.days?.length
    ? `\n\nFIXED USER STRENGTH PROGRAM — HARD CONSTRAINT. Reproduce these EXACT lift sessions in EVERY week (same day, title and exercises), only progressing load/intensity. Program runs AROUND these fixed days. Fixed lift days:\n${fixedStrength.days.map((d: any) => `- ${d.day} "${d.label}": ${(d.exercises ?? []).map((e: any) => `${e.name} ${e.sets}x${e.reps}`).join(', ')}`).join('\n')}`
    : ''

  const defaultWeeks = RACE_WEEKS[goalRace] ?? 8
  let weeks = defaultWeeks
  if (raceDate && goalRace !== 'hybrid') {
    const weeksOut = Math.ceil((new Date(raceDate).getTime() - Date.now()) / (86400000 * 7))
    weeks = Math.min(Math.max(weeksOut, 4), defaultWeeks)
  }
  if (requestedWeeks) weeks = requestedWeeks

  const runN: number = Number.isFinite(runCount) ? runCount : 3
  const liftN: number = Number.isFinite(liftCount) ? liftCount : 2
  const totalSessions = runN + liftN

  const pinnedRuns: string[] = Array.isArray(runDays) ? runDays : []
  const pinnedLifts: string[] = Array.isArray(liftDays) ? liftDays : []
  const daySkel = buildDaySkeleton({ runN, liftN, pinnedRuns, pinnedLifts, longRunDay: longRunDay ?? null, wkTargets: [], longCap: 0, restDays, canDoubleUp })
  const fixedDays = [
    `EXACT WEEKLY DAY STRUCTURE — use these EXACT days in EVERY week: RUN days = ${daySkel.run.join(', ') || '(coach decides)'}; LIFT days = ${daySkel.lift.join(', ') || 'none'}; REST = ${daySkel.rest.join(', ') || 'none'}.`,
    longRunDay ? `LONG RUN DAY (HARD REQUIREMENT): the weekly long run MUST be on ${longRunDay} every week.` : '',
  ].filter(Boolean).join('\n')

  const doublePolicy = canDoubleUp
    ? `The athlete CAN train twice in one day. When ${totalSessions} sessions don't fit one-per-day across 7 days, pair sessions — always pair an EASY run with a lift, NEVER a hard run with heavy legs.`
    : `The athlete trains ONCE per day where possible. If ${totalSessions} sessions exceed available days, you may place an easy run and a lift on the same day.`

  const restNote = Number.isFinite(restDays)
    ? (restDays === 0
      ? '\n- REST DAYS: the athlete prefers to train every day. Bake recovery into easy/mobility work.'
      : `\n- REST DAYS: schedule ${restDays} full rest day(s) per week.`)
    : ''

  const scheduling = `SESSION COUNT CONTRACT — NON-NEGOTIABLE:
- EXACTLY ${runN} run session(s) and EXACTLY ${liftN} lift session(s) in EVERY week.
- ONLY exception: TAPER weeks may reduce lifts by 1.
- LIFTS ARE STRENGTH-FOCUSED: heavy compounds (squat, deadlift, hip hinge, press, row, single-leg, calf) that build running economy and durability.
- Never two hard days back-to-back. Keep easy days easy.
${doublePolicy}${restNote}
${fixedDays}`

  const peakTarget = Number.isFinite(peakKm) && peakKm > 0
    ? Math.round(peakKm)
    : recommendedPeakKm(goalRace, timeGoal, fitnessLevel)
  const isRaceGoal = goalRace !== 'hybrid'
  const wkTargets = weeklyVolumeTargets(weeks, peakTarget, isRaceGoal)
  const longCap = LONG_RUN_CAP[goalRace] ?? 30
  const avgRun = Math.round(peakTarget / runN)
  const easyLow = Math.max(10, Math.round(avgRun * 0.7))
  const easyHigh = Math.min(longCap - 2, Math.round(avgRun * 1.15))
  const scheduleStr = wkTargets.map((km, i) => `W${i + 1}=${km}`).join('  ')
  const volumeBlock = runN > 0 ? `RUNNING VOLUME — MANDATORY PER-WEEK TARGETS:
- Required total running km per week (sessions MUST sum to within 3km of each): ${scheduleStr}
- Peak week MUST reach the FULL ${peakTarget}km.
- ${runN} runs/week at peak = ~${avgRun}km average per run. Easy runs must be ${easyLow}-${easyHigh}km, NOT 8-12km.
- Place LONG RUN first (capped ~${longCap}km), split remaining km across other ${runN - 1} run(s).
- 80/20 easy/quality split. Set numeric "distance" on every run session. In every week's "focus" end with total km e.g. "Build — 95km".` : ''

  const strengthLock = (goalRace === 'hyrox' || goalRace === 'hyrox_doubles') ? hyroxStrengthBlock(liftN, gymAccess) : ''
  const homeConstraint = !gymAccess ? `EQUIPMENT — HOME/BODYWEIGHT ONLY: No gym, no barbell. Use bodyweight, backpack, water jugs, pull-up bar. Progress via reps, tempo, range of motion, harder single-leg variations. Home substitutions: bench → push-up; overhead press → pike push-up; squat → Bulgarian split squat; deadlift → single-leg RDL; row → inverted row; pulldown → pull-up or doorway row.` : ''

  const expertBrief = buildExpertBrief(goalRace, weeks, timeGoal, runN, liftN)
  const paces = goalRace === '5k' ? fivekPaces(timeGoal, currentPr) : paceTargets(goalRace, timeGoal)

  const prompt = `<|system|>
${expertBrief}${fixedStrengthNote}
<|user|>
ATHLETE PROFILE:
- Goal: ${goalRace.replace(/_/g, ' ')}
- Race date: ${raceDate || 'no fixed race (rolling block)'}
- Fitness level: ${fitnessLevel}
- Time/performance goal: ${timeGoal}
- Runs per week: ${runN}, Lifts per week: ${liftN}
- Peak weekly running volume target: ${runN > 0 ? `~${peakTarget} km` : 'n/a'}

SCHEDULING RULES:
${scheduling}

${volumeBlock}

${strengthLock}

${homeConstraint}

PACE & LOADING TARGETS:
${paces}

FITNESS-LEVEL CALIBRATION (${fitnessLevel}):
- beginner: gentle ramp, confidence-building language, run/walk if needed.
- intermediate: moderate volume, full quality sessions, standard progression.
- advanced: higher volume, more demanding quality work, tighter paces.

OUTPUT: Generate ALL ${weeks} weeks, numbered 1 to ${weeks}, in order.
- Each session's details: exact distances, paces, sets×reps, %1RM, rest, RPE. Under ~22 words.
- type: run | lift | hyrox | rest. duration: realistic minutes. distance: exact run km (0 for non-run).
- Each week has a "focus" field ending with total run km e.g. "Base — 45km".
- Write exercise FULL names in lift details (never abbreviate).

CRITICAL FORMAT — compact array structure. Each session is [day, type, title, details, duration, distance]:

Return ONLY valid JSON, no markdown, no commentary:
{"planName":"string","weeks":[{"n":1,"focus":"string","s":[["Mon","run","Threshold Tempo","2km easy WU, 5km @4:40/km threshold, 2km CD. RPE 7.",50,9],["Tue","rest","Rest","Full recovery or light mobility.",0,0]]}]}
<|assistant|>`

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      let closed = false
      let heartbeat: ReturnType<typeof setInterval> | null = null
      const send = (obj: any) => {
        if (closed) return
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)) } catch { /* stream gone */ }
      }
      const closeStream = () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        try { controller.close() } catch { /* already closed */ }
      }

      send({ type: 'progress', message: 'WatsonX is designing your training blocks...' })

      const phases: string[] = []
      for (let w = 1; w <= weeks; w++) phases.push(`Building week ${w} of ${weeks}…`)
      phases.push('Balancing your runs and lifts…', 'Finalising your sessions…', 'Almost there — saving your plan…')
      let beat = 0
      heartbeat = setInterval(() => {
        send({ type: 'progress', message: phases[Math.min(beat, phases.length - 1)] })
        beat++
      }, 2500)

      try {
        // WatsonX Granite does not support streaming on the text generation endpoint,
        // so we use generateText (single-call) with a large token budget.
        // WHY THIS IS STILL FAST: Granite 3.3 8B is a compact model optimised for
        // instruction-following and JSON output — it generates far faster per token
        // than a frontier-scale model, and WatsonX routes inference to dedicated GPU
        // capacity rather than a shared API queue.
        const result = await watsonx.generateText({
          modelId: process.env.WATSONX_PLAN_MODEL || 'ibm/granite-3-3-8b-instruct',
          spaceId: process.env.WATSONX_SPACE_ID!,
          input: prompt,
          parameters: {
            max_new_tokens: 16000,
            min_new_tokens: 100,
            decoding_method: 'greedy',
            stop_sequences: ['<|eot_id|>', '<|start_header_id|>'],
          },
        })

        const text = result.result.results?.[0]?.generated_text?.trim() ?? ''
        const clean = text.replace(/```json|```/g, '').trim()

        let raw: any
        try {
          raw = JSON.parse(clean)
        } catch {
          const lastClose = clean.lastIndexOf(']}')
          if (lastClose > 0) {
            try { raw = JSON.parse(clean.substring(0, lastClose + 2) + ']}') }
            catch { raw = JSON.parse(clean.substring(0, clean.lastIndexOf('}]}') + 3)) }
          } else {
            throw new Error('Could not parse plan JSON from WatsonX response')
          }
        }

        const rawWeeks = raw.weeks ?? raw.w ?? []
        const expandedWeeks = rawWeeks.map((wk: any) => {
          const sessions = (wk.s ?? wk.sessions ?? []).map((sess: any) => {
            if (Array.isArray(sess)) {
              return { day: sess[0], type: sess[1], title: sess[2], details: sess[3], duration: sess[4], distance: typeof sess[5] === 'number' ? sess[5] : 0 }
            }
            return { ...sess, distance: typeof sess.distance === 'number' ? sess.distance : 0 }
          })
          return { weekNumber: wk.n ?? wk.weekNumber ?? 0, focus: wk.focus ?? '', sessions }
        })

        if (!expandedWeeks.length) {
          send({ type: 'error', error: 'Plan generation produced no weeks. Please try again.' })
          closeStream()
          return
        }

        expandedWeeks.sort((a: any, b: any) => (a.weekNumber ?? 0) - (b.weekNumber ?? 0))

        // Deterministically enforce athlete selections on the AI output.
        const normalized = normalizePlan(expandedWeeks, {
          runN, liftN, pinnedRuns, pinnedLifts, longRunDay: longRunDay ?? null,
          wkTargets, longCap, restDays: Number.isFinite(restDays) ? restDays : undefined, canDoubleUp,
        })

        send({
          type: 'complete',
          plan: {
            planName: raw.planName || PLAN_NAMES[goalRace] || 'Training Plan',
            weeks: normalized,
            timeGoal,
          },
        })
        closeStream()
      } catch (err) {
        console.error('WatsonX plan generation error:', err)
        send({ type: 'error', error: 'Plan generation failed. Please try again.' })
        closeStream()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  })
}
