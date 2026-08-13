// Server-side Strava helpers. Tokens live in the strava_connections table (RLS:
// each user owns exactly their row) and are only ever handled inside API routes.
// Requires env: NEXT_PUBLIC_STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET.

import type { SupabaseClient } from '@supabase/supabase-js'

const STRAVA_OAUTH = 'https://www.strava.com/oauth/token'
const STRAVA_API = 'https://www.strava.com/api/v3'

export type StravaConnection = {
  user_id: string
  athlete_id: number | null
  athlete_name: string | null
  access_token: string
  refresh_token: string
  expires_at: number // unix seconds
}

// Exchange the OAuth code for tokens (called once, from the callback flow).
export async function exchangeCode(code: string) {
  const res = await fetch(STRAVA_OAUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Strava token exchange failed (${res.status})`)
  return res.json() as Promise<{
    access_token: string; refresh_token: string; expires_at: number
    athlete?: { id: number; firstname?: string; lastname?: string }
  }>
}

// Return a connection with a valid access token, refreshing (and persisting the
// rotated refresh token) when it expires within the next 5 minutes.
export async function freshConnection(sb: SupabaseClient, userId: string): Promise<StravaConnection | null> {
  const { data } = await sb.from('strava_connections').select('*').eq('user_id', userId).single()
  if (!data) return null
  const conn = data as StravaConnection
  if (conn.expires_at * 1000 > Date.now() + 5 * 60 * 1000) return conn

  const res = await fetch(STRAVA_OAUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
    }),
  })
  if (!res.ok) throw new Error(`Strava token refresh failed (${res.status})`)
  const t = await res.json()
  const updated = { ...conn, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at }
  await sb.from('strava_connections').update({
    access_token: updated.access_token, refresh_token: updated.refresh_token, expires_at: updated.expires_at,
  }).eq('user_id', userId)
  return updated
}

// IBM Fitness workout type → Strava sport_type.
export function stravaSportType(type: string): string {
  if (type === 'run') return 'Run'
  if (type === 'lift') return 'WeightTraining'
  return 'Workout' // hyrox & anything else
}

// Create a manual activity on the athlete's Strava feed.
export async function createActivity(conn: StravaConnection, a: {
  name: string; sportType: string; startDateLocal: string; elapsedSec: number
  distanceMeters?: number; description?: string
}) {
  const body = new URLSearchParams({
    name: a.name,
    sport_type: a.sportType,
    start_date_local: a.startDateLocal,
    elapsed_time: String(a.elapsedSec),
    ...(a.distanceMeters && a.distanceMeters > 0 ? { distance: String(a.distanceMeters) } : {}),
    ...(a.description ? { description: a.description } : {}),
  })
  const res = await fetch(`${STRAVA_API}/activities`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${conn.access_token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Strava activity create failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<{ id: number }>
}

// Strava sport_type → IBM Fitness workout type, for importing activities INTO the app.
// Returns null for sports the app has no concept of (rides, swims, …).
export function appTypeFromSport(sportType: string): 'run' | 'lift' | 'hyrox' | null {
  if (/^(Run|TrailRun|VirtualRun)$/.test(sportType)) return 'run'
  if (/^(WeightTraining|Crossfit)$/.test(sportType)) return 'lift'
  if (sportType === 'Workout') return 'hyrox'
  return null
}

// Recent activities from the athlete's Strava feed (requires activity:read scope).
export async function listRecentActivities(conn: StravaConnection, afterEpochSec: number) {
  const res = await fetch(`${STRAVA_API}/athlete/activities?after=${afterEpochSec}&per_page=50`, {
    headers: { Authorization: `Bearer ${conn.access_token}` },
  })
  if (!res.ok) throw new Error(`Strava activities list failed (${res.status})`)
  return res.json() as Promise<any[]>
}

// Revoke IBM Fitness's access on the Strava side (best-effort).
export async function deauthorize(accessToken: string) {
  try {
    await fetch('https://www.strava.com/oauth/deauthorize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch { /* connection row is deleted regardless */ }
}
