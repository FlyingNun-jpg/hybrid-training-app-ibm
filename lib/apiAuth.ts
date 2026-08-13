import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Verify the Supabase access token the client sends in the Authorization header.
// Returns the authenticated user's id, or null if the token is missing/invalid.
// These AI routes call paid Anthropic models, so they must never run unauthenticated.
export async function getUserFromRequest(req: NextRequest): Promise<{ id: string } | null> {
  const header = req.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return null
  try {
    const sb = createClient(supabaseUrl, supabaseAnonKey)
    const { data, error } = await sb.auth.getUser(token)
    if (error || !data?.user) return null
    return { id: data.user.id }
  } catch {
    return null
  }
}

// Raw bearer token from the request — needed by routes that act on the user's own
// data through RLS (they build a user-scoped Supabase client with this token).
export function getBearer(req: NextRequest): string {
  const header = req.headers.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

// Supabase client that acts AS the authenticated user — every query passes through
// RLS, so routes using this can only ever touch the calling user's rows.
export function userScopedClient(accessToken: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  })
}

// Simple in-memory sliding-window rate limiter. Per serverless-instance only (state
// resets on cold start and isn't shared across instances), so it's a backstop rather
// than a hard guarantee — but it stops a single client from hammering the expensive
// AI routes. Returns true when the call is allowed.
const hits = new Map<string, number[]>()
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const recent = (hits.get(key) || []).filter(t => now - t < windowMs)
  if (recent.length >= max) { hits.set(key, recent); return false }
  recent.push(now)
  hits.set(key, recent)
  return true
}
