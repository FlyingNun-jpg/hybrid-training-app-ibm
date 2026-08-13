// ────────────────────────────────────────────────────────────────────────────
// parseActivity — dependency-free parser for Garmin (and most wearables') run
// exports in GPX or TCX format.
//
// Garmin Connect → an activity → gear menu → "Export to GPX" or "Export to TCX"
// produces these files. We extract distance, duration, average pace, average
// heart rate, average cadence and the GPS point count, returning the same shape
// the run-log form uses so an imported run can be reviewed and saved like any
// other. FIT (binary "Export Original") is intentionally not supported here —
// GPX/TCX cover the common export and need no third-party library.
// ────────────────────────────────────────────────────────────────────────────

export interface ImportedRun {
  distance: string      // km, 2dp
  durationMin: string   // minutes, 1dp
  pace: string          // min/km "m:ss"
  cadence: string       // steps/min (int) or ''
  heartRate: string     // bpm (int) or ''
  source: 'GPX' | 'TCX'
  points: number        // number of GPS/track points parsed
}

function fmtPace(minPerKm: number): string {
  if (!isFinite(minPerKm) || minPerKm <= 0) return ''
  const m = Math.floor(minPerKm)
  const s = Math.round((minPerKm - m) * 60)
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`
}

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat), dLon = toRad(bLon - aLon)
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(toRad(aLat)) * Math.cos(toRad(bLat))
  return 2 * R * Math.asin(Math.sqrt(x))
}

function avg(nums: number[]): number {
  const v = nums.filter(n => isFinite(n) && n > 0)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
}

// Garmin reports running cadence as one-foot RPM (~80–95). Runners think in
// steps/min (~160–190), so double anything that looks like a single-foot value.
function toStepsPerMin(raw: number): number {
  if (!(raw > 0)) return 0
  return raw < 120 ? Math.round(raw * 2) : Math.round(raw)
}

type Parsed = { distKm: number; durMin: number; hr: number; cadSpm: number; points: number }

function parseGPX(text: string): Parsed {
  const coords: [number, number][] = []
  const times: number[] = []
  const hrs: number[] = []
  const cads: number[] = []
  const ptRe = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g
  let m: RegExpExecArray | null
  while ((m = ptRe.exec(text)) !== null) {
    const attrs = m[1], inner = m[2]
    const lat = parseFloat((/lat="([\-0-9.]+)"/.exec(attrs) || [])[1] || 'NaN')
    const lon = parseFloat((/lon="([\-0-9.]+)"/.exec(attrs) || [])[1] || 'NaN')
    if (!isNaN(lat) && !isNaN(lon)) coords.push([lat, lon])
    const t = (/<time>([^<]+)<\/time>/.exec(inner) || [])[1]
    if (t) { const ms = Date.parse(t); if (!isNaN(ms)) times.push(ms) }
    const hr = (/<(?:[a-z0-9]+:)?hr>\s*([0-9]+)\s*<\/(?:[a-z0-9]+:)?hr>/i.exec(inner) || [])[1]
    if (hr) hrs.push(parseFloat(hr))
    const cad = (/<(?:[a-z0-9]+:)?cad>\s*([0-9]+)\s*<\/(?:[a-z0-9]+:)?cad>/i.exec(inner) || [])[1]
    if (cad) cads.push(parseFloat(cad))
  }
  let distM = 0
  for (let i = 1; i < coords.length; i++) distM += haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1])
  const durMin = times.length >= 2 ? (Math.max(...times) - Math.min(...times)) / 60000 : 0
  return { distKm: distM / 1000, durMin, hr: avg(hrs), cadSpm: toStepsPerMin(avg(cads)), points: coords.length }
}

function parseTCX(text: string): Parsed {
  let distM = 0, durSec = 0
  const hrWeighted: { hr: number; t: number }[] = []
  const lapRe = /<Lap\b[^>]*>([\s\S]*?)<\/Lap>/g
  let lm: RegExpExecArray | null
  let lapCount = 0
  while ((lm = lapRe.exec(text)) !== null) {
    lapCount++
    const lap = lm[1]
    const tt = parseFloat((/<TotalTimeSeconds>([0-9.]+)<\/TotalTimeSeconds>/.exec(lap) || [])[1] || '0')
    const dm = parseFloat((/<DistanceMeters>([0-9.]+)<\/DistanceMeters>/.exec(lap) || [])[1] || '0') // first = lap-level
    const lapHr = parseFloat(((/<AverageHeartRateBpm>\s*<Value>([0-9]+)<\/Value>/.exec(lap)) || [])[1] || '0')
    durSec += tt
    distM += dm
    if (lapHr > 0) hrWeighted.push({ hr: lapHr, t: tt || 1 })
  }
  // Cadence from trackpoints (RunCadence for running, Cadence for cycling).
  const cads: number[] = []
  const cadRe = /<(?:[a-z0-9]+:)?(?:RunCadence|Cadence)>\s*([0-9]+)\s*<\/(?:[a-z0-9]+:)?(?:RunCadence|Cadence)>/gi
  let cm: RegExpExecArray | null
  while ((cm = cadRe.exec(text)) !== null) cads.push(parseFloat(cm[1]))
  const points = (text.match(/<Trackpoint>/g) || []).length
  // Fallback: if no lap-level distance, use the last cumulative trackpoint distance.
  if (distM === 0) {
    const allDist = [...text.matchAll(/<DistanceMeters>([0-9.]+)<\/DistanceMeters>/g)].map(x => parseFloat(x[1]))
    if (allDist.length) distM = Math.max(...allDist)
  }
  const totalT = hrWeighted.reduce((a, b) => a + b.t, 0)
  const hr = totalT > 0 ? hrWeighted.reduce((a, b) => a + b.hr * b.t, 0) / totalT : avg(hrWeighted.map(h => h.hr))
  return { distKm: distM / 1000, durMin: durSec / 60, hr, cadSpm: toStepsPerMin(avg(cads)), points }
}

export function parseActivityText(text: string, filename: string): ImportedRun | null {
  const isTCX = /\.tcx$/i.test(filename) || /<TrainingCenterDatabase/.test(text)
  const isGPX = /\.gpx$/i.test(filename) || /<gpx\b/.test(text)
  if (!isTCX && !isGPX) return null
  const p = isTCX ? parseTCX(text) : parseGPX(text)
  if (!(p.distKm > 0) || !(p.durMin > 0)) return null
  const pace = p.distKm > 0 ? p.durMin / p.distKm : 0
  return {
    distance: p.distKm.toFixed(2),
    durationMin: p.durMin.toFixed(1),
    pace: fmtPace(pace),
    cadence: p.cadSpm > 0 ? String(p.cadSpm) : '',
    heartRate: p.hr > 0 ? String(Math.round(p.hr)) : '',
    source: isTCX ? 'TCX' : 'GPX',
    points: p.points,
  }
}
