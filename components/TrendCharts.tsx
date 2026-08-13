'use client'
import type { ReactNode } from 'react'
// Dependency-free trend charts rendered as inline SVG and themed with the app's CSS
// variables. All series are computed client-side from the athlete's workout logs, so
// there are no extra requests and nothing to configure. Each chart self-hides when it
// has too little data to be meaningful.

type Log = any

const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Monday (local) of the week containing an ISO date string.
function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const dow = d.getDay()
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  return isoLocal(d)
}

function shortDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

// ── Series builders ──────────────────────────────────────────────────────────

function weeklyMileage(logs: Log[], weeks = 8): { week: string; km: number }[] {
  const byWeek = new Map<string, number>()
  for (const l of logs) {
    if (l.workout_type !== 'run' || !l.workout_date) continue
    const km = parseFloat(l.log_data?.distance ?? l.log_data?.runLog?.distance)
    if (isNaN(km)) continue
    const wk = mondayOf(l.workout_date)
    byWeek.set(wk, (byWeek.get(wk) || 0) + km)
  }
  // Build a continuous run of the last `weeks` Mondays ending at the current week.
  const out: { week: string; km: number }[] = []
  const start = new Date(mondayOf(isoLocal(new Date())) + 'T00:00:00')
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(start); d.setDate(start.getDate() - i * 7)
    const key = isoLocal(d)
    out.push({ week: key, km: Math.round((byWeek.get(key) || 0) * 10) / 10 })
  }
  return out
}

function paceTrend(logs: Log[], max = 14): { date: string; pace: number }[] {
  const pts = logs
    .filter(l => l.workout_type === 'run' && l.workout_date)
    .map(l => {
      const dist = parseFloat(l.log_data?.distance ?? l.log_data?.runLog?.distance)
      const dur = parseFloat(l.log_data?.duration ?? l.log_data?.runLog?.duration)
      return { date: l.workout_date as string, pace: dist > 0 && dur > 0 ? dur / dist : NaN }
    })
    .filter(p => isFinite(p.pace) && p.pace > 2 && p.pace < 12)
    .sort((a, b) => a.date.localeCompare(b.date))
  return pts.slice(-max)
}

const COMPOUNDS: { key: string; label: string; test: (n: string) => boolean }[] = [
  { key: 'squat', label: 'Squat', test: n => /squat/.test(n) && !/(split|bulgarian|goblet|single|pistol)/.test(n) },
  { key: 'bench', label: 'Bench Press', test: n => /bench/.test(n) },
  { key: 'deadlift', label: 'Deadlift', test: n => /dead\s?lift|trap\s?bar/.test(n) },
  { key: 'ohp', label: 'Overhead Press', test: n => /(overhead|shoulder|military|strict)\s*press|\bohp\b/.test(n) },
]

// Estimated 1RM (Epley) progression for whichever compound lift has the most logged
// days. Returns the lift label, unit, and one best-e1RM point per date.
function e1rmTrend(logs: Log[], max = 14): { label: string; unit: string; points: { date: string; e1rm: number }[] } | null {
  const byLift = new Map<string, Map<string, number>>() // liftKey -> (date -> best e1rm)
  let unit = 'lbs'
  for (const l of logs) {
    if (l.workout_type !== 'lift' || !l.workout_date) continue
    unit = l.log_data?.unit ?? unit
    const exMap = l.log_data?.logs ?? {}
    for (const [exName, exData] of Object.entries<any>(exMap)) {
      const comp = COMPOUNDS.find(c => c.test(exName.toLowerCase()))
      if (!comp) continue
      let bestE = 0
      for (const s of exData?.sets ?? []) {
        const w = parseFloat(s.weight) || 0
        const reps = parseFloat(s.reps) || 0
        if (w <= 0 || reps <= 0) continue
        const e = w * (1 + reps / 30) // Epley
        if (e > bestE) bestE = e
      }
      if (bestE <= 0) continue
      if (!byLift.has(comp.key)) byLift.set(comp.key, new Map())
      const m = byLift.get(comp.key)!
      m.set(l.workout_date, Math.max(m.get(l.workout_date) || 0, Math.round(bestE)))
    }
  }
  let bestKey = '', bestCount = 0
  for (const [k, m] of byLift) if (m.size > bestCount) { bestCount = m.size; bestKey = k }
  if (!bestKey || bestCount < 2) return null
  const label = COMPOUNDS.find(c => c.key === bestKey)!.label
  const points = [...byLift.get(bestKey)!.entries()]
    .map(([date, e1rm]) => ({ date, e1rm }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-max)
  return { label, unit, points }
}

function fmtPace(p: number): string {
  const m = Math.floor(p), s = Math.round((p - m) * 60)
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`
}

// ── Presentational pieces ────────────────────────────────────────────────────

function SectionLabel({ dot, children }: { dot: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px' }}>{children}</p>
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '16px 14px 12px', marginBottom: 22 }}>
      {children}
    </div>
  )
}

// Bar chart for weekly mileage.
function MileageChart({ data }: { data: { week: string; km: number }[] }) {
  const W = 320, H = 140, padB = 20, padT = 20 // padT leaves room for the value label above the tallest bar
  const max = Math.max(...data.map(d => d.km), 1)
  const bw = W / data.length
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      {data.map((d, i) => {
        const h = (d.km / max) * (H - padB - padT)
        const x = i * bw + bw * 0.18
        const w = bw * 0.64
        const isLast = i === data.length - 1
        return (
          <g key={d.week}>
            <rect x={x} y={H - padB - h} width={w} height={Math.max(h, d.km > 0 ? 2 : 0)} rx={3}
              fill={isLast ? 'var(--accent)' : 'var(--run)'} opacity={isLast ? 1 : 0.55} />
            {d.km > 0 && (
              <text x={x + w / 2} y={H - padB - h - 4} textAnchor="middle" fontSize="8" fill="var(--text-faint)" fontWeight="600">{d.km}</text>
            )}
            <text x={x + w / 2} y={H - 6} textAnchor="middle" fontSize="7.5" fill="var(--text-faint)">{shortDate(d.week)}</text>
          </g>
        )
      })}
    </svg>
  )
}

// Generic line chart (lower-is-better optional, just for axis sense).
function LineChart({ values, labels, format, color, invert }: {
  values: number[]; labels: string[]; format: (v: number) => string; color: string; invert?: boolean
}) {
  const W = 320, H = 140, padB = 22, padT = 22, padX = 14 // generous top/bottom pad so value + date labels never collide
  const min = Math.min(...values), max = Math.max(...values)
  const range = max - min || 1
  const n = values.length
  const xAt = (i: number) => padX + (i / Math.max(n - 1, 1)) * (W - padX * 2)
  // invert=true means lower values plot higher (good for pace: faster = up).
  const yAt = (v: number) => {
    const norm = invert ? (max - v) / range : (v - min) / range
    return padT + (1 - norm) * (H - padB - padT)
  }
  const pts = values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ')
  const first = values[0], last = values[values.length - 1]
  // Place a point's value label above the point, unless it sits near the top — then below.
  const labelY = (v: number) => { const y = yAt(v); return y - padT < 12 ? y + 13 : y - 7 }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => {
        const edge = i === 0 || i === n - 1
        return <circle key={i} cx={xAt(i)} cy={yAt(v)} r={edge ? 3 : 2} fill={color} />
      })}
      <text x={xAt(0)} y={labelY(first)} textAnchor="start" fontSize="8.5" fill="var(--text-faint)" fontWeight="600">{format(first)}</text>
      <text x={xAt(n - 1)} y={labelY(last)} textAnchor="end" fontSize="8.5" fill="var(--text)" fontWeight="700">{format(last)}</text>
      <text x={xAt(0)} y={H - 6} textAnchor="start" fontSize="7.5" fill="var(--text-faint)">{shortDate(labels[0])}</text>
      <text x={xAt(n - 1)} y={H - 6} textAnchor="end" fontSize="7.5" fill="var(--text-faint)">{shortDate(labels[n - 1])}</text>
    </svg>
  )
}

export default function TrendCharts({ logs }: { logs: Log[] }) {
  const mileage = weeklyMileage(logs)
  const paces = paceTrend(logs)
  const e1rm = e1rmTrend(logs)

  const hasMileage = mileage.some(m => m.km > 0)
  const hasPace = paces.length >= 2
  const hasE1rm = !!e1rm

  if (!hasMileage && !hasPace && !hasE1rm) {
    return (
      <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '20px 16px', textAlign: 'center', marginBottom: 22 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>No trends yet</p>
        <p style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 }}>Log a few runs and lifts and your mileage, pace and strength trends will chart here.</p>
      </div>
    )
  }

  return (
    <div>
      {hasMileage && (
        <>
          <SectionLabel dot="var(--run)">Weekly mileage · last 8 weeks</SectionLabel>
          <Card><MileageChart data={mileage} /></Card>
        </>
      )}
      {hasPace && (
        <>
          <SectionLabel dot="var(--accent)">Pace trend · faster is up</SectionLabel>
          <Card>
            <LineChart values={paces.map(p => p.pace)} labels={paces.map(p => p.date)} format={v => `${fmtPace(v)}/km`} color="var(--accent)" invert />
          </Card>
        </>
      )}
      {hasE1rm && e1rm && (
        <>
          <SectionLabel dot="var(--lift)">{e1rm.label} · estimated 1RM ({e1rm.unit})</SectionLabel>
          <Card>
            <LineChart values={e1rm.points.map(p => p.e1rm)} labels={e1rm.points.map(p => p.date)} format={v => `${v}`} color="var(--lift)" />
          </Card>
        </>
      )}
    </div>
  )
}
