// IBM WatsonX.ai — adaptive plan adjustment
// WHY THIS MATTERS: This route detects when an athlete is overreaching (hard-feeling
// sessions stacking up, run paces missed) and eases the upcoming week automatically.
// Using WatsonX Granite here means the same IBM AI infrastructure handles both
// proactive coaching AND reactive plan adaptation — a unified, auditable AI layer.

import { WatsonXAI } from '@ibm-cloud/watsonx-ai'
import { IamAuthenticator } from 'ibm-cloud-sdk-core'
import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, rateLimit } from '@/lib/apiAuth'

const watsonx = WatsonXAI.newInstance({
  authenticator: new IamAuthenticator({ apikey: process.env.WATSONX_API_KEY! }),
  serviceUrl: process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com',
  version: '2024-05-31',
})

const VALID_DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`adjust:${user.id}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly.' }, { status: 429 })
  }

  const { week, reasons, evidence, profile } = await req.json()
  if (!week || !Array.isArray(week.sessions) || week.sessions.length === 0) {
    return NextResponse.json({ error: 'No week to adjust' }, { status: 400 })
  }

  const goal = profile?.goal_race ? profile.goal_race.replace(/_/g, ' ') : 'general fitness'

  const prompt = `<|system|>
You are an experienced hybrid-training coach. Your athlete (training for ${goal}) is showing signs of overreaching and you must ease their UPCOMING week so they recover while staying on track.
<|user|>
WHY THE ADJUSTMENT (signals from their logs):
${JSON.stringify({ reasons, evidence })}

THE UPCOMING WEEK TO ADJUST:
${JSON.stringify(week)}

Rules — follow all of them:
1. Return the SAME number of sessions, on the SAME days, with the SAME "type" values, in the same order. Never remove, add, or move sessions. Rest days stay untouched.
2. Reduce the load ~10-25% where it matters:
   - Runs: shorten distance and/or slow target paces toward the athlete's demonstrated pace.
   - Lifts: trim a set from main work (e.g. 4x5 → 3x5) and/or drop intensity ~5% 1RM. Keep the same exercises.
   - Hyrox: reduce rounds/volume modestly, keep the stations.
3. Update "details", "duration", and "distance" fields where they change.
4. Keep every JSON field each session already has. Keep titles unchanged.
5. If the week has a "focus" string, keep it, optionally noting the deload (e.g. "... (eased)").

Respond with ONLY valid JSON, no markdown fences:
{"summary": "<one sentence, max 20 words, describing what you eased>", "sessions": [ ...the full revised sessions array... ]}
<|assistant|>`

  try {
    const result = await watsonx.generateText({
      modelId: process.env.WATSONX_COACH_MODEL || 'ibm/granite-3-3-8b-instruct',
      projectId: process.env.WATSONX_PROJECT_ID!,
      input: prompt,
      parameters: {
        max_new_tokens: 4000,
        min_new_tokens: 50,
        decoding_method: 'greedy',
        stop_sequences: ['<|user|>', '<|system|>'],
      },
    })

    const raw = result.result.results?.[0]?.generated_text?.trim() ?? ''
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(cleaned)

    // Validate before touching the athlete's plan.
    const sessions = parsed?.sessions
    if (!Array.isArray(sessions) || sessions.length !== week.sessions.length) throw new Error('session count mismatch')
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i], o = week.sessions[i]
      if (!s || typeof s !== 'object') throw new Error('bad session')
      if (!VALID_DAYS.has(s.day) || s.day !== o.day) throw new Error('day changed')
      if (s.type !== o.type) throw new Error('type changed')
      if (typeof s.title !== 'string' || !s.title) throw new Error('missing title')
      if (typeof s.details !== 'string') throw new Error('missing details')
    }

    return NextResponse.json({
      summary: typeof parsed.summary === 'string' ? parsed.summary : "Eased next week's volume and intensity.",
      sessions,
    })
  } catch (err) {
    console.error('WatsonX adjust-plan error:', err)
    return NextResponse.json({ error: 'Could not generate an adjustment. Your plan is unchanged — try again.' }, { status: 500 })
  }
}
