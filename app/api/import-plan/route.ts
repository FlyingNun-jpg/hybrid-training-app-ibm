// IBM WatsonX.ai — import and convert an uploaded training file into a structured plan
import { WatsonXAI } from '@ibm-cloud/watsonx-ai'
import { IamAuthenticator } from 'ibm-cloud-sdk-core'
import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, rateLimit } from '@/lib/apiAuth'

const watsonx = WatsonXAI.newInstance({
  authenticator: new IamAuthenticator({ apikey: process.env.WATSONX_API_KEY! }),
  serviceUrl: process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com',
  version: '2024-05-31',
})

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`import:${user.id}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly.' }, { status: 429 })
  }

  const { fileContent, fileName, goalRace, raceDate, fitnessLevel, runDays, liftDays, peakKm, canDoubleUp, hasGym, timeGoal } = await req.json()

  const prompt = `<|system|>
You are an elite hybrid-training coach. An athlete uploaded an existing training file and wants it converted into a clean structured plan. Preserve their intent and structure where it exists, but apply professional coaching judgement to fill gaps, fix imbalances, and make every session specific.
<|user|>
UPLOADED FILE (${fileName}):
${fileContent}

ATHLETE CONTEXT:
- Goal: ${goalRace?.replace(/_/g, ' ') ?? 'general fitness'}
- Race date: ${raceDate || 'none'}
- Fitness level: ${fitnessLevel}
- Time/performance goal: ${timeGoal ?? 'not specified'}
- Preferred run days: ${runDays?.join(', ') || 'flexible'}
- Preferred lift days: ${liftDays?.join(', ') || 'flexible'}
- Peak weekly running volume target: ${Number.isFinite(peakKm) && peakKm > 0 ? `~${Math.round(peakKm)} km` : 'not specified'}
- Can train twice per day: ${canDoubleUp ? 'yes — pair easy run + lift on same day where sensible' : 'no'}
- Equipment: ${hasGym === false ? 'NO GYM — home/bodyweight only. Replace barbell/machine movements with home equivalents.' : 'full gym access'}

Convert into a structured plan. If the file already has weekly structure, preserve it faithfully. If loose notes, organise with sound periodization. Make each session "details" specific: distances, paces, sets×reps, weights, rest, RPE. Keep details under ~22 words.

For every RUN session set "distance" to its exact total kilometres; for lift/hyrox/rest set "distance" to 0.

Return ONLY valid JSON, no markdown:
{"planName":"string","weeks":[{"weekNumber":1,"focus":"string","sessions":[{"day":"Mon","type":"run|lift|hyrox|rest","title":"string","details":"string","duration":45,"distance":9}]}]}
<|assistant|>`

  try {
    const result = await watsonx.generateText({
      modelId: process.env.WATSONX_PLAN_MODEL || 'ibm/granite-3-3-8b-instruct',
      spaceId: process.env.WATSONX_SPACE_ID!,
      input: prompt,
      parameters: {
        max_new_tokens: 16000,
        min_new_tokens: 100,
        decoding_method: 'greedy',
        stop_sequences: ['<|eot_id|>', '<|start_header_id|>'],
      },
    })

    const text = result.result.results?.[0]?.generated_text?.trim() ?? ''
    const clean = text.replace(/```json|```/g, '').trim()
    let plan
    try {
      plan = JSON.parse(clean)
    } catch {
      const lastClose = clean.lastIndexOf('}]}')
      if (lastClose > 0) plan = JSON.parse(clean.substring(0, lastClose + 3))
      else throw new Error('parse failed')
    }
    plan.weeks?.sort((a: any, b: any) => (a.weekNumber ?? 0) - (b.weekNumber ?? 0))
    return NextResponse.json(plan)
  } catch (err) {
    console.error('WatsonX import error:', err)
    return NextResponse.json({ error: 'Import failed, please try again.' }, { status: 500 })
  }
}
