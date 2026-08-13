import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, getBearer, userScopedClient } from '@/lib/apiAuth'
import { deauthorize } from '@/lib/strava'

// Disconnect Strava: revoke our access on Strava's side, then drop the row.
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = userScopedClient(getBearer(req))
  const { data } = await sb.from('strava_connections').select('access_token').eq('user_id', user.id).maybeSingle()
  if (data?.access_token) await deauthorize(data.access_token)
  await sb.from('strava_connections').delete().eq('user_id', user.id)
  return NextResponse.json({ connected: false })
}
