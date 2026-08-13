import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, getBearer, userScopedClient } from '@/lib/apiAuth'

// Store (or refresh) this browser's push subscription for the daily reminder.
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { endpoint, keys } = await req.json()
  if (!endpoint || !keys?.p256dh || !keys?.auth) return NextResponse.json({ error: 'Bad subscription' }, { status: 400 })
  const sb = userScopedClient(getBearer(req))
  const { error } = await sb.from('push_subscriptions').upsert(
    { user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    { onConflict: 'endpoint' },
  )
  if (error) return NextResponse.json({ error: 'Could not save subscription' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
