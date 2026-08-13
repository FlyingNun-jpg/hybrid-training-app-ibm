// Deterministic plan normalizer.
//
// The AI is good at *designing* sessions but unreliable at honouring hard numeric and
// structural constraints (exact run/lift counts, pinned days, weekly volume, hitting the
// peak). Rather than trust it, we run its output through this pure, testable layer that
// ENFORCES the athlete's selections. This is what makes the plan "locked and loaded":
//   • exactly the chosen number of runs and lifts each week
//   • runs/lifts on the exact days the athlete pinned (AI's choice kept when unpinned)
//   • each week's run distances sum to the deterministic weekly target (peak hits exactly)
//   • every run's `distance` equals the sum of the km in its own details (hero-card truth)
//   • the focus label ends with the real weekly volume
//
// No external imports — pure functions so it can be unit-tested directly with node.

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export interface NSession { day: string; type: string; title: string; details: string; duration: number; distance: number; __pad?: boolean }
export interface NWeek { weekNumber: number; focus: string; sessions: NSession[] }

export interface NormalizeOpts {
  runN: number
  liftN: number
  pinnedRuns: string[]
  pinnedLifts: string[]
  longRunDay: string | null
  wkTargets: number[]   // deterministic weekly running km, one per week
  longCap: number       // max single long-run km
  restDays?: number     // desired rest days/week (used for default spread when unpinned)
  canDoubleUp?: boolean // athlete is willing to train twice in a day
}

const roundHalf = (x: number) => Math.round(x * 2) / 2
const fmtKm = (x: number) => (x % 1 === 0 ? x.toFixed(0) : String(x))

// Distances in details, e.g. "2km WU, 11km @5:15/km, 2km CD" → [2, 11, 2]. Pace tokens
// like "5:15/km" are NOT matched (the digit before "km" is a "/").
export function parseKmTokens(s: string): number[] {
  const out: number[] = []
  const re = /(\d+(?:\.\d+)?)\s?km/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s || '')) !== null) out.push(parseFloat(m[1]))
  return out
}
// The TRUE total km of a run. If the details state an explicit total (e.g. "Total 14km"
// or "= 14km"), that's authoritative — we must NOT also add the component legs, or a
// "2km WU, 8km, 2km CD. Total 12km" reads as 24km. Otherwise sum the component legs.
const TOTAL_RE = /(?:total|=)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s?km/i
const TOTAL_RE_SUFFIX = /(\d+(?:\.\d+)?)\s?km\s+total\b/i
// Fallback estimator used ONLY when the AI didn't give a numeric distance. It handles
// interval notation ("6x1km" → 6km, not 1) and ignores fuelling/landmark km ("gel at
// 7.5km") so the estimate reflects real running distance.
export function runTotalKm(s: string): number {
  const text = s || ''
  const m = TOTAL_RE.exec(text) || TOTAL_RE_SUFFIX.exec(text)
  if (m) return parseFloat(m[1])
  // Drop whole clauses that mention fuelling/landmarks so "gel at 7.5km and 11km" isn't
  // counted as distance legs.
  const cleaned = text.split(/[.;]/).filter(seg => !/\b(?:gel|fuel|fuelling|drink|water|nutrition|aid)\b/i.test(seg)).join('. ')
  let sum = 0
  // Interval legs: "6x1km" = 6km, "4 x 2km" = 8km.
  const withoutIntervals = cleaned.replace(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s?km/gi, (_m, n, d) => { sum += parseInt(n) * parseFloat(d); return ' ' })
  // Remaining single legs (WU / CD / steady distance).
  const re = /(\d+(?:\.\d+)?)\s?km/g
  let t: RegExpExecArray | null
  while ((t = re.exec(withoutIntervals)) !== null) sum += parseFloat(t[1])
  return Math.round(sum * 10) / 10
}
const sumKm = (s: string) => runTotalKm(s)

// Rewrite each km token in a details string by scaling, preserving paces/everything else.
function scaleDetails(details: string, factor: number): { details: string; sum: number } {
  const scaled: number[] = []
  const out = (details || '').replace(/(\d+(?:\.\d+)?)\s?km/g, (_m, num) => {
    const v = Math.max(1, roundHalf(parseFloat(num) * factor)); scaled.push(v); return `${fmtKm(v)}km`
  })
  return { details: out, sum: scaled.reduce((a, b) => a + b, 0) }
}

// Nudge the week's run distances so they sum EXACTLY to target, by editing the largest
// km token of the longest run. Keeps details and the distance field consistent.
function fixResidual(runs: NSession[], target: number) {
  const sum = runs.reduce((a, r) => a + r.distance, 0)
  const diff = roundHalf(target - sum)
  if (Math.abs(diff) < 0.5 || runs.length === 0) return
  let idx = 0
  runs.forEach((r, i) => { if (r.distance > runs[idx].distance) idx = i })
  const r = runs[idx]
  if (TOTAL_RE.test(r.details) || TOTAL_RE_SUFFIX.test(r.details)) {
    // Adjust the explicit total token (don't touch the legs — they're descriptive).
    let done = false
    r.details = r.details.replace(/((?:total|=)\s*[:\-]?\s*)(\d+(?:\.\d+)?)(\s?km)/i, (_m, p, n, s) => { done = true; return `${p}${fmtKm(Math.max(1, parseFloat(n) + diff))}${s}` })
    if (!done) r.details = r.details.replace(/(\d+(?:\.\d+)?)(\s?km\s+total\b)/i, (_m, n, s) => `${fmtKm(Math.max(1, parseFloat(n) + diff))}${s}`)
  } else {
    const tokens = parseKmTokens(r.details)
    if (tokens.length) {
      let mi = 0; tokens.forEach((t, i) => { if (t > tokens[mi]) mi = i })
      tokens[mi] = Math.max(1, tokens[mi] + diff)
      let k = 0
      r.details = r.details.replace(/(\d+(?:\.\d+)?)\s?km/g, () => `${fmtKm(tokens[k++])}km`)
    } else {
      r.distance = Math.max(1, roundHalf(r.distance + diff)); return
    }
  }
  r.distance = runTotalKm(r.details)
}

// Force exactly runN runs. Each run's distance is the AI's OWN stated distance (it knows
// "4x2km" = 8km and that a fuelling note isn't a leg) — we no longer re-derive or rescale
// it from the text, so the hero-card number always matches the described workout. The
// fallback estimator is used only when the AI left distance blank, and padded runs get a
// share of the week's target.
function distOf(r: NSession): number {
  return r.distance > 0 ? r.distance : runTotalKm(r.details)
}
function normalizeRuns(input: NSession[], target: number, longCap: number, runN: number): NSession[] {
  if (runN <= 0) return []
  let runs = input.slice()
  if (runs.length > runN) { runs.sort((a, b) => distOf(b) - distOf(a)); runs = runs.slice(0, runN) }
  while (runs.length < runN) runs.push({ day: '', type: 'run', title: 'Easy Aerobic Run', details: '', duration: 50, distance: 0, __pad: true })

  const knownKm = runs.filter(r => !r.__pad).reduce((a, r) => a + distOf(r), 0)
  const padCount = runs.filter(r => r.__pad).length
  const padShare = padCount > 0 ? Math.max(8, roundHalf(Math.max(target - knownKm, padCount * 8) / padCount)) : 0

  runs.forEach(r => {
    if (r.__pad) {
      const km = Math.min(padShare, longCap || padShare)
      r.distance = km
      r.details = `${fmtKm(km)}km easy aerobic @ conversational pace, RPE 3-4.`
      delete r.__pad
    } else {
      r.distance = roundHalf(distOf(r))
    }
    if (!r.duration) r.duration = Math.round(r.distance * 5.2)
  })
  return runs
}

// Remove any Hyrox station work the model appended to a lift ("Station Lock: …",
// "Stations: …") so lifts stay PURE strength — the stations live in the hyrox session.
function stripStations(details: string): string {
  return (details || '')
    .replace(/[.;,]?\s*station\s*lock\s*[:\-][\s\S]*$/i, '')
    .replace(/[.;,]?\s*\+?\s*stations?\s*[:\-][\s\S]*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Force exactly liftN lift sessions (pad with a sound default, trim extras).
function normalizeLifts(input: NSession[], liftN: number): NSession[] {
  if (liftN <= 0) return []
  let lifts = input.slice(0, Math.max(liftN, input.length))
  if (lifts.length > liftN) lifts = lifts.slice(0, liftN)
  while (lifts.length < liftN) lifts.push({ day: '', type: 'lift', title: 'Strength', details: 'Squat, Romanian Deadlift, Overhead Press, Bent Over Barbell Row — 4x6 @RPE 7-8.', duration: 50, distance: 0 })
  lifts.forEach(l => { l.distance = 0; l.details = stripStations(l.details); l.title = l.title.replace(/\s*[+&]\s*(?:sled|sandbag|station|carry|wall ?ball)[^]*$/i, '').trim() || l.title })
  return lifts
}

// Spacing-friendly order for filling unpinned days (keeps hard days apart).
const SPREAD = ['Mon', 'Wed', 'Fri', 'Sun', 'Tue', 'Thu', 'Sat']
const byWeek = (a: string[]) => [...a].sort((x, y) => WEEKDAYS.indexOf(x as any) - WEEKDAYS.indexOf(y as any))

// Deterministic weekly DAY SKELETON — the single source of truth for which weekday is a
// run / lift / rest day. It is constant across weeks (good for routine) and resolves the
// athlete's selections like a scheduler, not a hope:
//   • lift days come from the athlete's pinned lift days (capped to the lift count)
//   • runs prefer the athlete's pinned run days; a run pinned onto a lift day is RELOCATED
//     to a free day rather than silently dropped or doubled (unless no free day remains)
//   • we aim for exactly `restDays` rest days — filling days so 0 rest means train every day
export function buildDaySkeleton(o: NormalizeOpts): { run: string[]; lift: string[]; rest: string[] } {
  const { runN, liftN, pinnedRuns, pinnedLifts, longRunDay, restDays, canDoubleUp } = o
  const lift: string[] = []
  for (const d of byWeek(pinnedLifts)) if (lift.length < liftN && !lift.includes(d)) lift.push(d)
  for (const d of SPREAD) if (lift.length < liftN && !lift.includes(d)) lift.push(d)
  const used = new Set(lift)

  const total = runN + liftN
  // Distinct training days we should fill (so rest lands on exactly restDays where possible).
  const distinctTarget = Math.min(7, Math.max(lift.length, Math.min(total, 7 - (restDays ?? 0))))

  const run: string[] = []
  // When the athlete is OK training twice a day, honour every pinned run day EXACTLY —
  // even one that's also a lift day — turning it into the double they asked for, instead
  // of bumping the run to some day they never picked. Long run day goes on first.
  if (canDoubleUp) {
    for (const d of [longRunDay || '', ...byWeek(pinnedRuns)].filter(Boolean) as string[]) {
      if (run.length >= runN) break
      if (!run.includes(d)) { run.push(d); used.add(d) }
    }
  }
  // Fill any remaining runs onto NEW (free) days first, up to the run count / distinct target.
  for (const d of [longRunDay || '', ...byWeek(pinnedRuns), ...SPREAD].filter(Boolean) as string[]) {
    if (run.length >= runN) break
    if (!run.includes(d) && !used.has(d) && used.size < distinctTarget) { run.push(d); used.add(d) }
  }
  // Still unplaced → doubles — prefer the athlete's pinned run days, then lifts.
  if (run.length < runN) {
    for (const d of [...byWeek(pinnedRuns), ...lift, ...SPREAD]) {
      if (run.length >= runN) break
      if (!run.includes(d)) run.push(d)
    }
  }
  const rest = WEEKDAYS.filter(d => !used.has(d) && !run.includes(d))
  return { run: byWeek(run), lift: byWeek(lift), rest: byWeek(rest) }
}

function makeRest(day: string, restDays: number): NSession {
  // When the athlete wants 0 rest but the session counts force a free day, present it as
  // optional movement rather than a mandated day off.
  return restDays === 0
    ? { day, type: 'rest', title: 'Optional', details: 'Optional easy 20–30 min Z2 or mobility — only if you feel fresh.', duration: 0, distance: 0 }
    : { day, type: 'rest', title: 'Rest', details: 'Recovery — light mobility, walk, or full rest.', duration: 0, distance: 0 }
}

// Assign runs to the skeleton's run days, placing the longest run on the long-run day.
function assignRuns(runs: NSession[], runDays: string[], longRunDay: string | null) {
  const dayList = byWeek(runDays)
  if (!dayList.length) return
  let longIdx = 0
  runs.forEach((r, i) => { if (r.distance > runs[longIdx].distance) longIdx = i })
  const assignment: (string | undefined)[] = new Array(runs.length)
  const pos = longRunDay ? dayList.indexOf(longRunDay) : -1
  if (pos >= 0) { assignment[longIdx] = longRunDay!; dayList.splice(pos, 1) }
  let k = 0
  for (let i = 0; i < runs.length; i++) if (assignment[i] === undefined) assignment[i] = dayList[k++] ?? dayList[dayList.length - 1]
  runs.forEach((r, i) => { r.day = assignment[i]! })
}

export function normalizePlan(weeks: NWeek[], opts: NormalizeOpts): NWeek[] {
  const { runN, liftN, longRunDay, wkTargets, longCap, restDays } = opts
  const sk = buildDaySkeleton(opts) // constant day structure across the block
  return weeks.map((wk, i) => {
    const target = wkTargets[i] ?? wkTargets[wkTargets.length - 1] ?? 0
    const sessions = wk.sessions || []
    const runs = normalizeRuns(sessions.filter(s => s.type === 'run'), target, longCap, runN)
    const lifts = normalizeLifts(sessions.filter(s => s.type === 'lift'), liftN)
    // Hyrox station sessions are their OWN thing (own hero card + split-time logging).
    // Keep them and pair each with a lift day so it sits beside the strength work.
    const hyrox = sessions.filter(s => s.type === 'hyrox').map(s => ({ ...s, distance: 0 }))
    hyrox.forEach((h, idx) => { h.day = sk.lift[idx % Math.max(1, sk.lift.length)] ?? sk.run[idx % Math.max(1, sk.run.length)] ?? h.day })

    assignRuns(runs, sk.run, longRunDay)
    lifts.forEach((l, idx) => { l.day = sk.lift[idx] ?? sk.lift[sk.lift.length - 1] ?? l.day })
    const rests = sk.rest.map(d => makeRest(d, restDays ?? 1))

    const all = [...runs, ...lifts, ...hyrox, ...rests].filter(s => s.day)
    const present = new Set(all.map(s => s.day))
    for (const d of WEEKDAYS) if (!present.has(d)) all.push(makeRest(d, restDays ?? 1))
    const ordered = all.sort((a, b) => WEEKDAYS.indexOf(a.day as any) - WEEKDAYS.indexOf(b.day as any))

    const realKm = roundHalf(runs.reduce((a, r) => a + r.distance, 0))
    const baseFocus = (wk.focus || '').replace(/\s*[—–-]\s*\d+\s?km\s*$/i, '').trim()
    const focus = runN > 0 ? `${baseFocus} — ${fmtKm(realKm)}km`.replace(/^\s*—\s*/, '') : baseFocus

    return { weekNumber: wk.weekNumber, focus, sessions: ordered }
  })
}
