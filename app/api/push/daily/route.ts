import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

// Daily reminder, fired by Vercel Cron (see vercel.json). Sends each subscribed
// athlete a push with TODAY's planned session(s). Requires:
//   CRON_SECRET                 — Vercel injects "Authorization: Bearer <CRON_SECRET>"
//   SUPABASE_SERVICE_ROLE_KEY   — reads all users' subs/plans (server-only!)
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — web push identity
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  const vapidPub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const vapidPriv = process.env.VAPID_PRIVATE_KEY
  if (!service || !vapidPub || !vapidPriv) {
    return NextResponse.json({ error: 'Push not configured' }, { status: 500 })
  }
  webpush.setVapidDetails('mailto:jacoblarsson1998@gmail.com', vapidPub, vapidPriv)
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, service)

  const { data: subs } = await sb.from('push_subscriptions').select('*')
  if (!subs?.length) return NextResponse.json({ sent: 0 })

  // Latest plan per subscribed user.
  const userIds = [...new Set(subs.map(s => s.user_id))]
  const { data: plans } = await sb.from('training_plans')
    .select('user_id, plan_data, start_date, created_at')
    .in('user_id', userIds)
    .order('created_at', { ascending: false })
  const planByUser = new Map<string, any>()
  for (const p of plans ?? []) if (!planByUser.has(p.user_id)) planByUser.set(p.user_id, p)

  // Today's plan-week index + day sessions (mirrors the dashboard's anchoring).
  const now = new Date()
  const todayAbbrev = DAYS[now.getDay()]
  const localISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const mondayOf = (d: Date) => { const m = new Date(d); const dow = m.getDay(); m.setDate(m.getDate() - (dow === 0 ? 6 : dow - 1)); return m }
  const thisMonday = localISO(mondayOf(now))

  const todaysBody = (plan: any): string | null => {
    const weeks = plan?.plan_data?.weeks ?? []
    if (!weeks.length) return null
    const startMonday = plan.plan_data?.startMonday ?? (plan.start_date ? localISO(mondayOf(new Date(plan.start_date + 'T00:00:00'))) : null)
    if (!startMonday) return null
    const wi = Math.round((Date.parse(thisMonday) - Date.parse(startMonday)) / (7 * 86400000))
    if (wi < 0 || wi > weeks.length - 1) return null
    const sessions = (weeks[wi].sessions ?? []).filter((s: any) => s.day === todayAbbrev && s.type !== 'rest')
    if (!sessions.length) return null
    return `Today: ${sessions.map((s: any) => s.title).join(' + ')}. Let's go. `
  }

  let sent = 0
  const dead: string[] = []
  await Promise.all(subs.map(async (s) => {
    const body = todaysBody(planByUser.get(s.user_id))
    if (!body) return // rest day or no active plan — don't nag
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: 'IBM Fitness', body }),
      )
      sent++
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.endpoint)
    }
  }))
  if (dead.length) await sb.from('push_subscriptions').delete().in('endpoint', dead)

  return NextResponse.json({ sent, cleaned: dead.length })
}
