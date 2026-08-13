'use client'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme-context'
import { Button } from '@/components/ui/button'

const THEMES = [
  { id: 'ibm-fitness', name: 'IBM Fitness',    desc: 'IBM Carbon — clean light blue',   bg: '#f4f4f4', card: '#ffffff', mark: '#0f62fe', markFg: '#ffffff', bar: '#da1e28', label: '#525252' },
  { id: 'ibm-dark',    name: 'IBM Dark',       desc: 'IBM Carbon — deep dark blue',     bg: '#161616', card: '#262626', mark: '#4589ff', markFg: '#161616', bar: '#ff8389', label: '#c6c6c6' },
  { id: 'carbon',   name: 'Carbon',        desc: 'Deep carbon & volt',              bg: '#0a0b0d', card: '#15171b', mark: '#d8f64a', markFg: '#0a0b0d', bar: '#ff6a3d', label: '#9aa1aa' },
  { id: 'apex',     name: 'Apex',          desc: 'Clean white & cobalt',            bg: '#f6f8fb', card: '#ffffff', mark: '#2563eb', markFg: '#ffffff', bar: '#f0613c', label: '#5b6573' },
  { id: 'sand',     name: 'Sand',          desc: 'Warm beige & flat clay',          bg: '#ece4d6', card: '#f7f1e6', mark: '#a4744a', markFg: '#faf6ee', bar: '#c2683a', label: '#7c6e5b' },
  { id: 'hotpink',  name: 'Hot Pink',      desc: 'Clean & vibrant pink',            bg: '#fff2f8', card: '#ffffff', mark: '#e8408a', markFg: '#ffffff', bar: '#c026d3', label: '#9a5c79' },
  { id: 'camo',     name: 'Camo',          desc: 'Army olive & khaki',              bg: '#20251a', card: '#2b3222', mark: '#8a9a3f', markFg: '#14180e', bar: '#c0702f', label: '#9aa37e' },
  { id: 'hotgirlsummer', name: 'Hot Girl Summer', desc: '☀️ Bold sunset pink & coral', bg: '#fff2ec', card: '#ffffff', mark: '#ff2e88', markFg: '#ffffff', bar: '#ff6f4c', label: '#9a5566' },
  { id: 'sunsetcoast',  name: 'Sunset Coast',  desc: 'Warm coral & tangerine',      bg: '#fff3ea', card: '#ffffff', mark: '#ff6f4c', markFg: '#ffffff', bar: '#e23d6d', label: '#9a6f5c' },
  { id: 'foresttrail',  name: 'Forest Trail',  desc: 'Sage, moss & clay',           bg: '#eef0e6', card: '#f8f9f2', mark: '#5a8a3c', markFg: '#ffffff', bar: '#a8773f', label: '#6a7a58' },
  { id: 'moltencarbon', name: 'Molten Carbon', desc: 'Charcoal & molten metals',    bg: '#100d0b', card: '#1b1714', mark: '#ff7a18', markFg: '#100d0b', bar: '#d99023', label: '#ab9684' },
  { id: 'pastelpop',    name: 'Pastel Pop',    desc: 'Soft candy pastels',          bg: '#fbf3fb', card: '#ffffff', mark: '#ff5fa8', markFg: '#ffffff', bar: '#8fc7ff', label: '#9a7a9a' },
] as const

type ThemeId = typeof THEMES[number]['id']

export default function SettingsPage() {
  const router = useRouter()
  const { theme, setTheme } = useTheme()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 40 }}>
      <nav style={{ background: 'var(--bg-nav)', borderBottom: '0.5px solid var(--border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>←</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'var(--accent-fg)', fontSize: 9, fontWeight: 500 }}>MB</span>
          </div>
          <span style={{ color: 'var(--text)', fontWeight: 500 }}>Settings</span>
        </div>
      </nav>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 16px' }}>
        <h2 style={{ color: 'var(--text)', fontWeight: 500, fontSize: 18, marginBottom: 6 }}>App theme</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>Tap any theme to apply it instantly.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
          {THEMES.map(t => {
            const isActive = theme === t.id
            return (
              <div key={t.id} onClick={() => setTheme(t.id as ThemeId)}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderRadius: 14, cursor: 'pointer', border: `${isActive ? '1.5px' : '0.5px'} solid ${isActive ? t.mark : 'var(--border)'}`, background: isActive ? `${t.mark}12` : 'var(--bg-card)', transition: 'all 0.15s' }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: t.bg, border: '0.5px solid rgba(128,128,128,0.15)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, flexShrink: 0 }}>
                  <div style={{ width: 18, height: 18, borderRadius: 4, background: t.mark, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: t.markFg, fontSize: 6, fontWeight: 500 }}>MB</span>
                  </div>
                  <div style={{ width: 16, height: 2, borderRadius: 1, background: t.bar }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{t.desc}</div>
                </div>
                {isActive && (
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: t.mark, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ color: t.markFg, fontSize: 11 }}>✓</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <Button onClick={() => router.push('/dashboard')}
          style={{ width: '100%', background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', fontWeight: 500, height: 46, fontSize: 14 }}>
          Done
        </Button>
      </div>
    </div>
  )
}
