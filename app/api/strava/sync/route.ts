import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, getBearer, userScopedClient, rateLimit } from '@/lib/apiAuth'
import { freshConnection, createActivity, stravaSportType } from '@/lib/strava'

// Push one completed workout to Strava as a manual activity. Called by the workout
// screen right after a log is saved (only when the user has connected Strava).
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`strava-sync:${user.id}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { title, type, date, elapsedMin, distanceKm, description } = await req.json()
  if (!title || !type || !date) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  const elapsedSec = Math.round((parseFloat(elapsedMin) || 30) * 60)

  try {
    const sb = userScopedClient(getBearer(req))
    const conn = await freshConnection(sb, user.id)
    if (!conn) return NextResponse.json({ error: 'Strava not connected' }, { status: 409 })

    // Anchor the activity at the time it was logged. Backfilled dates get a
    // deterministic per-title midday slot (12:00–16:59) so two same-day workouts
    // never share a start time — Strava rejects overlapping manual activities,
    // which silently dropped e.g. the lift when a run was synced first.
    const now = new Date()
    const isToday = date === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    let hh: string, mm: string
    if (isToday) {
      hh = String(now.getHours()).padStart(2, '0')
      mm = String(now.getMinutes()).padStart(2, '0')
    } else {
      let h = 0
      for (const c of String(title)) h = ((h * 31 + c.charCodeAt(0)) >>> 0)
      const slot = h % 300
      hh = String(12 + Math.floor(slot / 60)).padStart(2, '0')
      mm = String(slot % 60).padStart(2, '0')
    }

    const activity = await createActivity(conn, {
      name: title,
      sportType: stravaSportType(type),
      startDateLocal: `${date}T${hh}:${mm}:00`,
      elapsedSec,
      distanceMeters: type === 'run' && distanceKm ? Math.round(parseFloat(distanceKm) * 1000) : undefined,
      description: description || 'Logged with IBM Fitness ',
    })
    return NextResponse.json({ activityId: activity.id })
  } catch (err: any) {
    console.error('Strava sync error:', err)
    return NextResponse.json({ error: 'Sync failed', detail: String(err?.message ?? '').slice(0, 300) }, { status: 502 })
  }
}
