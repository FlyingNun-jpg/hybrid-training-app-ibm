import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, getBearer, userScopedClient, rateLimit } from '@/lib/apiAuth'
import { freshConnection, listRecentActivities, appTypeFromSport } from '@/lib/strava'

// Recent Strava activities, slimmed for the dashboard's import inbox. Requires the
// connection to have the activity:read scope (connections made before that scope
// was added return 403 from Strava — the client treats that as "reconnect needed").
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`strava-list:${user.id}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  try {
    const sb = userScopedClient(getBearer(req))
    const conn = await freshConnection(sb, user.id)
    if (!conn) return NextResponse.json({ activities: [], connected: false })

    const after = Math.floor(Date.now() / 1000) - 7 * 86400
    let raw: any[]
    try { raw = await listRecentActivities(conn, after) } catch (err: any) {
      // Missing activity:read scope on older connections.
      if (String(err?.message).includes('(401)') || String(err?.message).includes('(403)')) {
        return NextResponse.json({ activities: [], connected: true, needsReconnect: true })
      }
      throw err
    }

    const fmtPace = (secPerKm: number) => `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')}`
    const activities = (raw || []).flatMap((a: any) => {
      const type = appTypeFromSport(a.sport_type)
      if (!type) return []
      const distanceKm = a.distance > 0 ? Math.round((a.distance / 1000) * 100) / 100 : null
      const movingMin = a.moving_time > 0 ? Math.round(a.moving_time / 60) : null
      return [{
        id: a.id,
        name: a.name,
        type,
        sportType: a.sport_type,
        date: String(a.start_date_local || '').slice(0, 10),
        distanceKm,
        movingMin,
        paceMinKm: type === 'run' && distanceKm && a.moving_time ? fmtPace(a.moving_time / distanceKm) : null,
        avgHr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
        avgCadence: a.average_cadence ? Math.round(a.average_cadence * 2) : null, // Strava reports per-leg
      }]
    })
    return NextResponse.json({ activities, connected: true })
  } catch (err) {
    console.error('Strava activities error:', err)
    return NextResponse.json({ error: 'Could not load Strava activities' }, { status: 502 })
  }
}
