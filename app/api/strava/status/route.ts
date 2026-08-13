import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, getBearer, userScopedClient } from '@/lib/apiAuth'

// Is this user's Strava connected? (Never returns tokens.)
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = userScopedClient(getBearer(req))
  const { data } = await sb.from('strava_connections').select('athlete_name').eq('user_id', user.id).maybeSingle()
  return NextResponse.json({ connected: !!data, athleteName: data?.athlete_name ?? null })
}
