// IBM WatsonX.ai — conversational coach
// WHY THIS IS A SEPARATE ROUTE FROM /api/coach:
// The post-workout coach (/api/coach) is a one-shot feedback generator.
// This route is a STATEFUL CONVERSATION — it accepts a full message history
// and maintains context across turns, enabling the athlete to ask follow-up
// questions. This is the multi-turn dialogue capability of WatsonX.ai that
// Watson Assistant was historically used for, now available directly via
// the foundation model API with the Llama 3.3 chat format.

import { WatsonXAI } from '@ibm-cloud/watsonx-ai'
import { IamAuthenticator } from 'ibm-cloud-sdk-core'
import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, rateLimit } from '@/lib/apiAuth'

const watsonx = WatsonXAI.newInstance({
  authenticator: new IamAuthenticator({ apikey: process.env.WATSONX_API_KEY! }),
  serviceUrl: process.env.WATSONX_URL || 'https://ca-tor.ml.cloud.ibm.com',
  version: '2024-05-31',
})

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`watson-chat:${user.id}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly.' }, { status: 429 })
  }

  const { message, history = [], profile, recentLogs = [] } = await req.json()
  if (!message?.trim()) return NextResponse.json({ error: 'No message' }, { status: 400 })

  const goal = profile?.goal_race ? profile.goal_race.replace(/_/g, ' ') : 'general fitness'
  const level = profile?.fitness_level ?? 'intermediate'
  const timeGoal = profile?.time_goal ?? ''

  // Build a compact training context from recent logs so the AI knows what
  // the athlete has actually been doing — not just generic advice.
  const logContext = recentLogs.length > 0
    ? recentLogs.slice(0, 8).map((l: any) => {
        const d = l.workout_date || ''
        const t = l.title || ''
        const type = l.workout_type || ''
        const feel = l.log_data?.feel ? ` (felt ${l.log_data.feel.replace('_',' ')})` : ''
        const dist = l.log_data?.runLog?.distance || l.log_data?.distance
        const distStr = dist ? ` ${dist}km` : ''
        return `${d} ${type}: ${t}${distStr}${feel}`
      }).join('\n')
    : 'No recent sessions logged yet.'

  // Build conversation prompt in Llama 3.3 chat format
  // Each turn: <|start_header_id|>role<|end_header_id|>\n\ncontent<|eot_id|>
  const systemPrompt = `You are an expert hybrid-training coach powered by IBM WatsonX.ai. You help athletes who train for Hyrox, marathons, half marathons, and general hybrid fitness (running + strength combined).

ATHLETE PROFILE:
- Goal: ${goal}${timeGoal ? ` (${timeGoal})` : ''}
- Fitness level: ${level}

RECENT TRAINING (last 8 sessions):
${logContext}

Be specific, practical and warm. Keep answers concise (2-4 sentences unless the question demands more). Reference the athlete's actual recent sessions when relevant. You can ask clarifying questions if needed. Never give medical advice.`

  // Build the full prompt with conversation history
  let prompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${systemPrompt}<|eot_id|>`

  // Add conversation history (last 6 turns to stay within context)
  const recentHistory = (history as {role: string, text: string}[]).slice(-6)
  for (const turn of recentHistory) {
    const role = turn.role === 'user' ? 'user' : 'assistant'
    prompt += `<|start_header_id|>${role}<|end_header_id|>\n\n${turn.text}<|eot_id|>`
  }

  // Add current user message
  prompt += `<|start_header_id|>user<|end_header_id|>\n\n${message}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`

  try {
    const result = await watsonx.generateText({
      modelId: process.env.WATSONX_COACH_MODEL || 'meta-llama/llama-3-3-70b-instruct',
      spaceId: process.env.WATSONX_SPACE_ID!,
      input: prompt,
      parameters: {
        max_new_tokens: 400,
        min_new_tokens: 20,
        decoding_method: 'greedy',
        stop_sequences: ['<|eot_id|>', '<|start_header_id|>'],
      },
    })

    const response = result.result.results?.[0]?.generated_text?.trim() ?? ''
    return NextResponse.json({ response })
  } catch (err) {
    console.error('WatsonX chat error:', err)
    return NextResponse.json({
      response: "I'm having trouble connecting right now. Please try again in a moment.",
    })
  }
}
