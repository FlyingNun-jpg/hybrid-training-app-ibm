'use client'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import StrengthBuilder from '@/components/StrengthBuilder'
import { buildWeeks } from '@/lib/strengthBuilder'
import type { StrengthTemplate, BuilderConfig } from '@/lib/strengthBuilder'

export default function BuildStrengthPage() {
  const { user } = useAuth()
  const router = useRouter()

  const save = async (template: StrengthTemplate, cfg: BuilderConfig) => {
    if (!user) return
    const planWeeks = buildWeeks(template, cfg)
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const dow = now.getDay()
    const thisMonday = new Date(now); thisMonday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1))
    const startMonday = iso(thisMonday)
    const activeFrom = iso(now)

    await supabase.from('training_plans').delete().eq('user_id', user.id)
    await supabase.from('training_plans').insert({
      user_id: user.id,
      plan_name: cfg.planName,
      plan_type: 'strength',
      start_date: activeFrom,
      end_date: null,
      plan_data: { planName: cfg.planName, weeks: planWeeks, startMonday, activeFrom, timeGoal: '', builder: 'manual-strength', strengthTemplate: template },
    })
    router.push('/dashboard')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 40 }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '20px 16px' }}>
        <StrengthBuilder onComplete={save} onCancel={() => router.push('/dashboard')} ctaLabel="Save & view my plan" />
      </div>
    </div>
  )
}
