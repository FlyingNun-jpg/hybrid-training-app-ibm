// Structured exercise catalog for the build-your-own strength feature.
//
// IMPORTANT: every exercise name here is chosen so it matches one of the regexes in
// the workout page's DEMO_MAP (see app/workout/[planId]/[day]/page.tsx). Because the
// builder writes these exact names into a session's `details`, the existing demo-image
// sync resolves the correct animation with no extra wiring. Exercises without a demo
// mapping still work — they gracefully fall back to the "how to" link.

export type Pattern = 'push' | 'pull' | 'legs' | 'core'

export interface Exercise {
  name: string
  pattern: Pattern
  main?: boolean        // compound lift suitable as a day's primary movement
  defaultSets: number
  defaultReps: string
}

// Catalog. `main: true` movements are the heavy compounds the app already tracks for
// PBs and e1RM (squat / bench / deadlift / overhead press / row).
export const EXERCISES: Exercise[] = [
  // ── Push ──────────────────────────────────────────────────────────────────
  { name: 'Barbell Bench Press', pattern: 'push', main: true, defaultSets: 4, defaultReps: '5' },
  { name: 'Dumbbell Bench Press', pattern: 'push', defaultSets: 3, defaultReps: '8-10' },
  { name: 'Incline Dumbbell Press', pattern: 'push', defaultSets: 3, defaultReps: '8-10' },
  { name: 'Incline Barbell Bench Press', pattern: 'push', defaultSets: 4, defaultReps: '6-8' },
  { name: 'Decline Bench Press', pattern: 'push', defaultSets: 3, defaultReps: '8-10' },
  { name: 'Overhead Press', pattern: 'push', main: true, defaultSets: 4, defaultReps: '5' },
  { name: 'Dumbbell Shoulder Press', pattern: 'push', defaultSets: 3, defaultReps: '8-10' },
  { name: 'Push Press', pattern: 'push', defaultSets: 4, defaultReps: '3-5' },
  { name: 'Dips', pattern: 'push', defaultSets: 3, defaultReps: '8-12' },
  { name: 'Weighted Dips', pattern: 'push', defaultSets: 4, defaultReps: '6-8' },
  { name: 'Close-Grip Bench Press', pattern: 'push', defaultSets: 3, defaultReps: '6-8' },
  { name: 'Diamond Push-Up', pattern: 'push', defaultSets: 3, defaultReps: '10-15' },
  { name: 'Pike Push-Up', pattern: 'push', defaultSets: 3, defaultReps: '8-12' },
  { name: 'Triceps Pushdown', pattern: 'push', defaultSets: 3, defaultReps: '10-15' },
  { name: 'Overhead Triceps Extension', pattern: 'push', defaultSets: 3, defaultReps: '10-12' },
  { name: 'Lateral Raise', pattern: 'push', defaultSets: 3, defaultReps: '12-15' },
  { name: 'Cable Fly', pattern: 'push', defaultSets: 3, defaultReps: '12-15' },
  { name: 'Push-Up', pattern: 'push', defaultSets: 3, defaultReps: '12-20' },

  // ── Pull ──────────────────────────────────────────────────────────────────
  { name: 'Barbell Deadlift', pattern: 'pull', main: true, defaultSets: 3, defaultReps: '5' },
  { name: 'Trap Bar Deadlift', pattern: 'pull', defaultSets: 3, defaultReps: '5' },
  { name: 'Bent Over Barbell Row', pattern: 'pull', main: true, defaultSets: 4, defaultReps: '6-8' },
  { name: 'Pendlay Row', pattern: 'pull', defaultSets: 4, defaultReps: '5-6' },
  { name: 'Dumbbell Row', pattern: 'pull', defaultSets: 3, defaultReps: '8-12' },
  { name: 'Inverted Row', pattern: 'pull', defaultSets: 3, defaultReps: '10-15' },
  { name: 'Pull-Up', pattern: 'pull', defaultSets: 3, defaultReps: '6-10' },
  { name: 'Weighted Pull-Up', pattern: 'pull', defaultSets: 4, defaultReps: '5-8' },
  { name: 'Chin-Up', pattern: 'pull', defaultSets: 3, defaultReps: '6-10' },
  { name: 'Weighted Chin-Up', pattern: 'pull', defaultSets: 4, defaultReps: '5-8' },
  { name: 'Seated Cable Row', pattern: 'pull', defaultSets: 3, defaultReps: '8-12' },
  { name: 'Lat Pulldown', pattern: 'pull', defaultSets: 3, defaultReps: '8-12' },
  { name: 'Face Pull', pattern: 'pull', defaultSets: 3, defaultReps: '12-15' },
  { name: 'Barbell Curl', pattern: 'pull', defaultSets: 3, defaultReps: '8-12' },
  { name: 'Dumbbell Curl', pattern: 'pull', defaultSets: 3, defaultReps: '10-12' },
  { name: 'Hammer Curl', pattern: 'pull', defaultSets: 3, defaultReps: '10-12' },
  { name: 'Preacher Curl', pattern: 'pull', defaultSets: 3, defaultReps: '10-12' },
  { name: 'Barbell Shrug', pattern: 'pull', defaultSets: 3, defaultReps: '10-15' },
  { name: 'Rear Delt Fly', pattern: 'pull', defaultSets: 3, defaultReps: '12-15' },

  // ── Legs ──────────────────────────────────────────────────────────────────
  { name: 'Barbell Squat', pattern: 'legs', main: true, defaultSets: 4, defaultReps: '5' },
  { name: 'Front Squat', pattern: 'legs', defaultSets: 3, defaultReps: '5-6' },
  { name: 'Goblet Squat', pattern: 'legs', defaultSets: 3, defaultReps: '10-12' },
  { name: 'Romanian Deadlift', pattern: 'legs', defaultSets: 3, defaultReps: '8-10' },
  { name: 'Single-Leg Romanian Deadlift', pattern: 'legs', defaultSets: 3, defaultReps: '8-10' },
  { name: 'Bulgarian Split Squat', pattern: 'legs', defaultSets: 3, defaultReps: '8-10' },
  { name: 'Walking Lunge', pattern: 'legs', defaultSets: 3, defaultReps: '10-12' },
  { name: 'Reverse Lunge', pattern: 'legs', defaultSets: 3, defaultReps: '10-12' },
  { name: 'Leg Press', pattern: 'legs', defaultSets: 3, defaultReps: '10-12' },
  { name: 'Leg Curl', pattern: 'legs', defaultSets: 3, defaultReps: '10-12' },
  { name: 'Leg Extension', pattern: 'legs', defaultSets: 3, defaultReps: '12-15' },
  { name: 'Barbell Hip Thrust', pattern: 'legs', defaultSets: 3, defaultReps: '8-12' },
  { name: 'Glute Bridge', pattern: 'legs', defaultSets: 3, defaultReps: '10-15' },
  { name: 'Standing Calf Raise', pattern: 'legs', defaultSets: 4, defaultReps: '12-15' },
  { name: 'Seated Calf Raise', pattern: 'legs', defaultSets: 4, defaultReps: '15-20' },
  { name: 'Box Jump', pattern: 'legs', defaultSets: 4, defaultReps: '5' },

  // ── Core & conditioning ────────────────────────────────────────────────────
  { name: 'Hanging Leg Raise', pattern: 'core', defaultSets: 3, defaultReps: '10-15' },
  { name: 'Hanging Knee Raise', pattern: 'core', defaultSets: 3, defaultReps: '12-15' },
  { name: 'Plank', pattern: 'core', defaultSets: 3, defaultReps: '45s' },
  { name: 'Russian Twist', pattern: 'core', defaultSets: 3, defaultReps: '20' },
  { name: 'Kettlebell Swing', pattern: 'core', defaultSets: 4, defaultReps: '15' },
  { name: 'Mountain Climbers', pattern: 'core', defaultSets: 3, defaultReps: '30s' },
  { name: 'Back Extension', pattern: 'core', defaultSets: 3, defaultReps: '12-15' },
  { name: 'Burpee', pattern: 'core', defaultSets: 4, defaultReps: '10' },
]

export const byName = (name: string): Exercise | undefined =>
  EXERCISES.find(e => e.name === name)

export const byPattern = (patterns: Pattern[]): Exercise[] =>
  EXERCISES.filter(e => patterns.includes(e.pattern))

// ── Splits ───────────────────────────────────────────────────────────────────
// A day's `role` groups same-type days for "apply to all Push days" propagation.
// `patterns` controls which catalog exercises are offered when adding to that day.
// `seed` is the default exercise list (full names from the catalog above).

export type SplitId = 'full' | 'upper_lower' | 'ppl'

export interface SplitDay {
  label: string
  role: 'push' | 'pull' | 'legs' | 'upper' | 'lower' | 'full'
  patterns: Pattern[]
  seed: string[]
}

export interface Split {
  name: string
  desc: string
  days: SplitDay[]
}

export const SPLITS: Record<SplitId, Split> = {
  full: {
    name: 'Full Body',
    desc: '3 balanced full-body days — great for 3x/week.',
    days: [
      { label: 'Full Body A', role: 'full', patterns: ['push', 'pull', 'legs', 'core'], seed: ['Barbell Squat', 'Barbell Bench Press', 'Bent Over Barbell Row', 'Standing Calf Raise'] },
      { label: 'Full Body B', role: 'full', patterns: ['push', 'pull', 'legs', 'core'], seed: ['Barbell Deadlift', 'Overhead Press', 'Pull-Up', 'Hanging Leg Raise'] },
      { label: 'Full Body C', role: 'full', patterns: ['push', 'pull', 'legs', 'core'], seed: ['Front Squat', 'Incline Dumbbell Press', 'Dumbbell Row', 'Barbell Curl'] },
    ],
  },
  upper_lower: {
    name: 'Upper / Lower',
    desc: 'Alternating upper and lower days — classic 4x/week.',
    days: [
      { label: 'Upper', role: 'upper', patterns: ['push', 'pull', 'core'], seed: ['Barbell Bench Press', 'Bent Over Barbell Row', 'Overhead Press', 'Pull-Up', 'Barbell Curl'] },
      { label: 'Lower', role: 'lower', patterns: ['legs', 'core'], seed: ['Barbell Squat', 'Romanian Deadlift', 'Walking Lunge', 'Standing Calf Raise'] },
    ],
  },
  ppl: {
    name: 'Push / Pull / Legs',
    desc: 'Dedicated push, pull and legs days — 3 or 6x/week.',
    days: [
      { label: 'Push', role: 'push', patterns: ['push', 'core'], seed: ['Barbell Bench Press', 'Overhead Press', 'Incline Dumbbell Press', 'Lateral Raise', 'Triceps Pushdown'] },
      { label: 'Pull', role: 'pull', patterns: ['pull', 'core'], seed: ['Barbell Deadlift', 'Bent Over Barbell Row', 'Pull-Up', 'Face Pull', 'Barbell Curl'] },
      { label: 'Legs', role: 'legs', patterns: ['legs', 'core'], seed: ['Barbell Squat', 'Romanian Deadlift', 'Bulgarian Split Squat', 'Standing Calf Raise'] },
    ],
  },
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

// Sensible default weekday placement for N training days, spacing them out for recovery.
export function defaultDays(n: number): string[] {
  const layouts: Record<number, string[]> = {
    1: ['Mon'],
    2: ['Mon', 'Thu'],
    3: ['Mon', 'Wed', 'Fri'],
    4: ['Mon', 'Tue', 'Thu', 'Fri'],
    5: ['Mon', 'Tue', 'Wed', 'Fri', 'Sat'],
    6: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  }
  return layouts[Math.max(1, Math.min(6, n))] ?? ['Mon', 'Wed', 'Fri']
}
