import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, getBearer, userScopedClient, rateLimit } from '@/lib/apiAuth'
import { exchangeCode } from '@/lib/strava'

// Complete the OAuth flow: the callback page sends the ?code here (with the user's
// Supabase JWT), we swap it for tokens and store the connection under RLS.
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`strava-x:${user.id}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const { code } = await req.json()
  if (!code || typeof code !== 'string') return NextResponse.json({ error: 'Missing code' }, { status: 400 })

  try {
    const t = await exchangeCode(code)
    const sb = userScopedClient(getBearer(req))
    const athleteName = [t.athlete?.firstname, t.athlete?.lastname].filter(Boolean).join(' ') || null
    const { error } = await sb.from('strava_connections').upsert({
      user_id: user.id,
      athlete_id: t.athlete?.id ?? null,
      athlete_name: athleteName,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: t.expires_at,
    })
    if (error) throw error
    return NextResponse.json({ connected: true, athleteName })
  } catch (err) {
    console.error('Strava exchange error:', err)
    return NextResponse.json({ error: 'Could not connect Strava. Try again.' }, { status: 500 })
  }
}
