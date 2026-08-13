'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

// ────────────────────────────────────────────────────────────────────────────
// RunTracker — a Strava-style live GPS run recorder.
//
// Uses the browser Geolocation API (navigator.geolocation.watchPosition) to
// capture the athlete's position while they run, drawing the route live on a
// Leaflet + OpenStreetMap map (free, no API key) and computing distance, live
// pace, average pace and elapsed time from the GPS track.
//
// No native app, watch or Strava account required — everything runs in the
// phone's browser. Geolocation needs a secure context (HTTPS or localhost).
//
// On Finish it hands the captured { distance, durationMin, pace } back to the
// caller via onFinish so the existing run-log form can be prefilled for review.
// ────────────────────────────────────────────────────────────────────────────

export interface RunResult {
  distance: string      // km, 2dp, e.g. "12.03"
  durationMin: string   // minutes, 1dp, e.g. "64.5"
  pace: string          // min/km, "m:ss"
  cadence: string       // avg steps/min, e.g. "172" ('' if motion unavailable)
  coords: [number, number][]
}

interface Props {
  onFinish: (result: RunResult) => void
  onCancel: () => void
  targetKm?: number     // optional planned distance, shown as a goal ring
  title?: string
}

type Status = 'idle' | 'running' | 'paused'

// Haversine distance between two lat/lng points, in metres.
function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0]), lat2 = toRad(b[0])
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(x))
}

// min/km decimal → "m:ss" string. Returns "—:—" for non-finite input.
function fmtPace(minPerKm: number): string {
  if (!isFinite(minPerKm) || minPerKm <= 0) return '—:—'
  const m = Math.floor(minPerKm)
  const s = Math.round((minPerKm - m) * 60)
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`
}

function fmtClock(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = Math.floor(totalSec % 60)
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

// Load Leaflet from CDN once (no npm dep, avoids SSR issues). Resolves to the
// global L, or null if it fails to load (the tracker still works without a map).
let _leafletPromise: Promise<any> | null = null
function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if ((window as any).L) return Promise.resolve((window as any).L)
  if (_leafletPromise) return _leafletPromise
  _leafletPromise = new Promise((resolve) => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }
    const s = document.createElement('script')
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    s.async = true
    s.onload = () => resolve((window as any).L ?? null)
    s.onerror = () => resolve(null)
    document.body.appendChild(s)
  })
  return _leafletPromise
}

export default function RunTracker({ onFinish, onCancel, targetKm, title }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [distanceM, setDistanceM] = useState(0)   // metres
  const [elapsed, setElapsed] = useState(0)        // seconds (running time only)
  const [livePace, setLivePace] = useState(0)      // min/km over recent window
  const [cadence, setCadence] = useState(0)        // live steps/min over recent window
  const [motion, setMotion] = useState<'unknown' | 'on' | 'denied' | 'unsupported'>('unknown')
  const [gpsReady, setGpsReady] = useState(false)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Refs hold mutable tracking state that must not trigger re-renders on every
  // GPS tick or timer tick.
  const watchId = useRef<number | null>(null)
  const statusRef = useRef<Status>('idle')
  const track = useRef<[number, number][]>([])           // accepted route points
  const recent = useRef<{ t: number; d: number }[]>([])  // {timestampMs, cumMetres} for live pace
  const lastPoint = useRef<[number, number] | null>(null)
  const distRef = useRef(0)

  // Timer accumulation across pause/resume.
  const accumMs = useRef(0)
  const segStart = useRef<number | null>(null)

  // Cadence (step) detection from the accelerometer.
  const stepCount = useRef(0)               // total steps while running
  const stepTimes = useRef<number[]>([])    // recent step timestamps (ms) for live spm
  const accelBaseline = useRef(9.8)         // smoothed gravity baseline
  const stepArmed = useRef(false)           // rising-edge gate to avoid double counts
  const lastStepMs = useRef(0)

  // Leaflet refs.
  const mapEl = useRef<HTMLDivElement | null>(null)
  const map = useRef<any>(null)
  const poly = useRef<any>(null)
  const marker = useRef<any>(null)
  const leaflet = useRef<any>(null)

  useEffect(() => { statusRef.current = status }, [status])

  // ── Init map ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    loadLeaflet().then((L) => {
      if (cancelled || !L || !mapEl.current || map.current) return
      leaflet.current = L
      const m = L.map(mapEl.current, { zoomControl: false, attributionControl: false }).setView([0, 0], 2)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m)
      poly.current = L.polyline([], { color: '#c2683f', weight: 5, opacity: 0.9 }).addTo(m)
      map.current = m
    })
    return () => { cancelled = true }
  }, [])

  // ── Elapsed-time + live-cadence ticker (only advances while running) ──────
  useEffect(() => {
    const id = setInterval(() => {
      if (statusRef.current !== 'running' || segStart.current == null) return
      const secs = (accumMs.current + (Date.now() - segStart.current)) / 1000
      setElapsed(secs)
      // Live cadence: steps within a trailing window (≤12s), scaled to per-minute.
      const now = Date.now()
      const windowMs = 12000
      const recentSteps = stepTimes.current.filter(t => now - t <= windowMs)
      const windowSec = Math.min(windowMs / 1000, secs)
      setCadence(windowSec > 2 ? Math.round((recentSteps.length / windowSec) * 60) : 0)
    }, 250)
    return () => clearInterval(id)
  }, [])

  // ── Accelerometer step detection (cadence) ───────────────────────────────
  // Counts foot strikes from accelerationIncludingGravity peaks. A rising edge
  // above a baseline+threshold marks a step; a refractory period and a re-arm
  // gate prevent double counts. Only runs while the timer is running.
  useEffect(() => {
    if (motion !== 'on') return
    const THRESH = 1.15   // m/s² above smoothed baseline to count as a strike
    const REARM = 0.5     // fraction of THRESH the signal must fall below to re-arm
    const REFRACT = 230   // ms minimum between steps (~260 spm ceiling)
    const handler = (e: DeviceMotionEvent) => {
      if (statusRef.current !== 'running') return
      const a = e.accelerationIncludingGravity
      if (!a || a.x == null || a.y == null || a.z == null) return
      const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
      accelBaseline.current = accelBaseline.current * 0.9 + mag * 0.1
      const dev = mag - accelBaseline.current
      const now = Date.now()
      if (dev > THRESH && !stepArmed.current && now - lastStepMs.current > REFRACT) {
        stepArmed.current = true
        lastStepMs.current = now
        stepCount.current += 1
        stepTimes.current.push(now)
        if (stepTimes.current.length > 80) stepTimes.current = stepTimes.current.slice(-60)
      } else if (dev < THRESH * REARM) {
        stepArmed.current = false
      }
    }
    window.addEventListener('devicemotion', handler)
    return () => window.removeEventListener('devicemotion', handler)
  }, [motion])

  // ── Keep the screen awake while recording ────────────────────────────────
  // Mobile browsers suspend GPS/JS when the screen locks or the tab is
  // backgrounded. A Screen Wake Lock keeps the display on during a run so
  // tracking keeps going; it's re-acquired if the user tabs away and back.
  useEffect(() => {
    if (status !== 'running') return
    type WakeLockSentinel = { release: () => Promise<void> }
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> } }
    if (!nav.wakeLock) return
    let lock: WakeLockSentinel | null = null
    let active = true
    const acquire = async () => { try { if (active) lock = await nav.wakeLock!.request('screen') } catch {} }
    const onVis = () => { if (document.visibilityState === 'visible') acquire() }
    acquire()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVis)
      try { lock?.release() } catch {}
    }
  }, [status])

  const handlePosition = useCallback((pos: GeolocationPosition) => {
    setGpsReady(true)
    const acc = pos.coords.accuracy
    setAccuracy(acc)
    const pt: [number, number] = [pos.coords.latitude, pos.coords.longitude]

    // Always recentre the map on the live position + drop a marker.
    const L = leaflet.current
    if (L && map.current) {
      if (!marker.current) {
        marker.current = L.circleMarker(pt, { radius: 7, color: '#fff', weight: 2, fillColor: '#c2683f', fillOpacity: 1 }).addTo(map.current)
        map.current.setView(pt, 16)
      } else {
        marker.current.setLatLng(pt)
        map.current.panTo(pt, { animate: true, duration: 0.5 })
      }
    }

    if (statusRef.current !== 'running') { lastPoint.current = pt; return }

    // Reject low-accuracy fixes (> 35 m) — they create phantom distance.
    if (acc != null && acc > 35) { return }

    if (lastPoint.current) {
      const seg = haversine(lastPoint.current, pt)
      // Filter jitter: ignore sub-2m wobble and physically impossible jumps
      // (> 12 m/s ≈ sub-1:24/km sprint) which are almost always GPS error.
      const dtSec = recent.current.length ? (Date.now() - recent.current[recent.current.length - 1].t) / 1000 : 1
      const speed = seg / Math.max(dtSec, 0.5)
      if (seg >= 2 && speed <= 12) {
        distRef.current += seg
        setDistanceM(distRef.current)
        track.current.push(pt)
        if (poly.current) poly.current.addLatLng(pt)
        recent.current.push({ t: Date.now(), d: distRef.current })
        // Live pace over the last ~30s of movement.
        const cutoff = Date.now() - 30000
        while (recent.current.length > 2 && recent.current[0].t < cutoff) recent.current.shift()
        const first = recent.current[0], last = recent.current[recent.current.length - 1]
        const dM = last.d - first.d
        const dT = (last.t - first.t) / 1000
        if (dM > 20 && dT > 0) setLivePace((dT / 60) / (dM / 1000))
      }
    } else {
      track.current.push(pt)
      if (poly.current) poly.current.addLatLng(pt)
      recent.current.push({ t: Date.now(), d: distRef.current })
    }
    lastPoint.current = pt
  }, [])

  const handleError = useCallback((err: GeolocationPositionError) => {
    if (err.code === err.PERMISSION_DENIED) setError('Location permission denied. Enable it in your browser settings to track runs.')
    else if (err.code === err.POSITION_UNAVAILABLE) setError('Location unavailable. Make sure GPS is on and you have a clear view of the sky.')
    else setError('Could not get your location. Try again.')
  }, [])

  const startWatch = useCallback(() => {
    if (!('geolocation' in navigator)) { setError('This device or browser does not support GPS tracking.'); return }
    if (watchId.current != null) return
    watchId.current = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true, maximumAge: 1000, timeout: 20000,
    })
  }, [handlePosition, handleError])

  // Begin GPS watch immediately so we have a fix (and the map centres) before
  // the user taps Start.
  useEffect(() => {
    startWatch()
    return () => { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current) }
  }, [startWatch])

  const start = async () => {
    setError(null)
    // Enable cadence: iOS 13+ requires motion permission requested inside a user
    // gesture (this tap). Other browsers expose devicemotion without a prompt.
    try {
      const DME = (typeof window !== 'undefined' ? (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent : null)
      if (DME && typeof DME.requestPermission === 'function') {
        const res = await DME.requestPermission()
        setMotion(res === 'granted' ? 'on' : 'denied')
      } else if (typeof window !== 'undefined' && 'DeviceMotionEvent' in window) {
        setMotion('on')
      } else {
        setMotion('unsupported')
      }
    } catch { setMotion('denied') }
    stepCount.current = 0
    stepTimes.current = []
    accumMs.current = 0
    segStart.current = Date.now()
    setStatus('running')
  }
  const pause = () => {
    if (segStart.current != null) accumMs.current += Date.now() - segStart.current
    segStart.current = null
    lastPoint.current = null   // avoid a long phantom segment across the pause gap
    setStatus('paused')
  }
  const resume = () => { segStart.current = Date.now(); setStatus('running') }

  const finish = () => {
    if (segStart.current != null) accumMs.current += Date.now() - segStart.current
    const totalSec = accumMs.current / 1000
    const km = distRef.current / 1000
    const durationMin = totalSec / 60
    const pace = km > 0 ? durationMin / km : 0
    const avgCadence = totalSec > 30 && stepCount.current > 20 ? Math.round(stepCount.current / (totalSec / 60)) : 0
    if (watchId.current != null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null }
    onFinish({
      distance: km.toFixed(2),
      durationMin: durationMin.toFixed(1),
      pace: fmtPace(pace),
      cadence: avgCadence > 0 ? String(avgCadence) : '',
      coords: track.current,
    })
  }

  const km = distanceM / 1000
  const avgPace = km > 0 && elapsed > 0 ? (elapsed / 60) / km : 0
  const goalPct = targetKm && targetKm > 0 ? Math.min((km / targetKm) * 100, 100) : null

  const accColor = accuracy == null ? 'var(--text-faint)' : accuracy <= 12 ? '#3fa66a' : accuracy <= 25 ? '#c9a227' : '#cc6633'
  const accLabel = accuracy == null ? 'Locating…' : accuracy <= 12 ? 'Strong GPS' : accuracy <= 25 ? 'Fair GPS' : 'Weak GPS'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '0.5px solid var(--border)', background: 'var(--bg-nav)' }}>
        <button onClick={onCancel}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', gap: 4 }}>
          ✕ <span style={{ fontSize: 13 }}>Close</span>
        </button>
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', flex: 1, textAlign: 'center', letterSpacing: '-0.2px' }}>{title ?? 'Record run'}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: accColor }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{accLabel}</span>
        </div>
      </div>

      {/* Map */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={mapEl} style={{ position: 'absolute', inset: 0, background: 'var(--bg-card)' }} />
        {!gpsReady && !error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, pointerEvents: 'none' }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Acquiring GPS signal…</span>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}
        {error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14, padding: 20, maxWidth: 320, textAlign: 'center' }}>
              <div style={{ fontSize: 26, marginBottom: 8 }}>📍</div>
              <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{error}</p>
            </div>
          </div>
        )}
      </div>

      {/* Live stats panel */}
      <div style={{ background: 'var(--bg-nav)', borderTop: '0.5px solid var(--border)', padding: '18px 16px calc(18px + env(safe-area-inset-bottom,0px))' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
          <Stat label="Distance" value={km.toFixed(2)} unit="km" big />
          <Stat label="Time" value={fmtClock(elapsed)} />
          <Stat label="Avg pace" value={fmtPace(avgPace)} unit="/km" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Current pace <span style={{ color: 'var(--text)', fontWeight: 600, marginLeft: 4 }}>{fmtPace(livePace)}<span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>/km</span></span>
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Cadence{' '}
            {motion === 'denied' || motion === 'unsupported'
              ? <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>n/a</span>
              : <span style={{ color: 'var(--text)', fontWeight: 600 }}>{cadence > 0 ? cadence : '—'}<span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> spm</span></span>}
          </span>
        </div>
        {goalPct != null && (
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Goal <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{Math.round(goalPct)}%</span> of {targetKm}km
            </span>
          </div>
        )}

        {/* Controls */}
        {status === 'idle' && (
          <button onClick={start} disabled={!!error}
            style={{ width: '100%', background: error ? 'var(--bg-card)' : 'var(--accent)', color: error ? 'var(--text-faint)' : 'var(--accent-fg)', border: 'none', borderRadius: 14, padding: 16, fontSize: 16, fontWeight: 600, cursor: error ? 'default' : 'pointer', letterSpacing: '-0.2px' }}>
            ▶ Start run
          </button>
        )}
        {status === 'running' && (
          <button onClick={pause}
            style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 16, fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>
            ❚❚ Pause
          </button>
        )}
        {status === 'paused' && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={resume}
              style={{ flex: 1, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 14, padding: 16, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
              ▶ Resume
            </button>
            <button onClick={finish}
              style={{ flex: 1, background: 'var(--bg-card)', color: 'var(--hyrox)', border: '1px solid var(--hyrox)', borderRadius: 14, padding: 16, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
              ✓ Finish
            </button>
          </div>
        )}
        {status !== 'idle' && status !== 'paused' && (
          <p style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center', marginTop: 10 }}>Pause to finish & save your run</p>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, unit, big }: { label: string; value: string; unit?: string; big?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '12px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: big ? 26 : 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.5px', lineHeight: 1 }}>
        {value}{unit && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-faint)', marginLeft: 2 }}>{unit}</span>}
      </div>
    </div>
  )
}
