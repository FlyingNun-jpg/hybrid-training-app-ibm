// IBM WatsonX.ai — post-workout coach feedback
// WHY IBM GRANITE: IBM's Granite models are designed for enterprise use with
// built-in trust and transparency — critical for health/fitness AI where the
// athlete needs to trust the advice they receive. WatsonX.ai provides a managed,
// auditable inference endpoint hosted on IBM Cloud.

import { WatsonXAI } from '@ibm-cloud/watsonx-ai'
import { IamAuthenticator } from 'ibm-cloud-sdk-core'
import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, rateLimit } from '@/lib/apiAuth'

// Build the WatsonX client once at module level (reused across requests).
// WATSONX_API_KEY  — IAM API key from IBM Cloud (cloud.ibm.com → Manage → Access → API keys)
// WATSONX_PROJECT_ID — WatsonX project ID (watsonx.ai → your project → Manage → General)
// WATSONX_URL       — regional endpoint, e.g. https://us-south.ml.cloud.ibm.com
const watsonx = WatsonXAI.newInstance({
  authenticator: new IamAuthenticator({ apikey: process.env.WATSONX_API_KEY! }),
  serviceUrl: process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com',
  version: '2024-05-31',
})

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`coach:${user.id}`, 40, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly.' }, { status: 429 })
  }

  const { workoutSummary, profile } = await req.json()
  const goal = profile?.goal_race ? profile.goal_race.replace(/_/g, ' ') : 'general fitness'
  const level = profile?.fitness_level ?? 'intermediate'

  const prompt = `<|system|>
You are a warm, encouraging hybrid-training coach giving ONE upbeat post-workout debrief. The athlete just finished a session and logged their numbers. This is a single message with no back-and-forth, so make it genuinely motivating.
<|user|>
ATHLETE: training for ${goal}, level ${level}.
SESSION + LOGGED DATA: ${JSON.stringify(workoutSummary)}

Write 2-4 sentences of supportive, useful feedback:
- Open by celebrating that they showed up and got it done — be genuinely warm and positive, like a coach who's in their corner.
- Acknowledge what they did with a specific reference to their actual numbers (sets, reps, weights, distance, pace, cadence).
- Connect this session to the bigger picture: how it moves them toward their ${goal} goal and fits the overall plan (e.g. building the aerobic base, banking strength, sharpening race pace).
- Offer ONE gentle, encouraging tip to build on — framed as an opportunity, never a criticism. Grounded in real training science (progressive overload, pacing, recovery, polarized intensity).
- Sound human and friendly, never blunt, clinical, or harsh. Avoid empty filler — keep it real.
- Do NOT invite further questions (this is one-time feedback).

After the prose, on a new line add 2-3 short positive insight tags in square brackets, e.g. [great consistency] [pace on point] [strong finish] [recovery win]. Each tag 1-3 words.
<|assistant|>`

  try {
    const result = await watsonx.generateText({
      modelId: process.env.WATSONX_COACH_MODEL || 'ibm/granite-3-3-8b-instruct',
      projectId: process.env.WATSONX_PROJECT_ID!,
      input: prompt,
      parameters: {
        max_new_tokens: 600,
        min_new_tokens: 40,
        decoding_method: 'greedy',
        stop_sequences: ['<|user|>', '<|system|>'],
      },
    })

    const response = result.result.results?.[0]?.generated_text?.trim() ?? ''
    return NextResponse.json({ response })
  } catch (err) {
    console.error('WatsonX coach error:', err)
    return NextResponse.json({
      response: "Solid work logging this session. Keep showing up consistently — that's what drives real progress. [consistency]",
    })
  }
}
