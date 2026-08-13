import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, getBearer, userScopedClient } from '@/lib/apiAuth'

// Remove this browser's push subscription (daily reminder turned off).
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { endpoint } = await req.json()
  if (!endpoint) return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })
  const sb = userScopedClient(getBearer(req))
  await sb.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint)
  return NextResponse.json({ ok: true })
}
