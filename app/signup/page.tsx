'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }
const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--border-strong)', color: 'var(--text)', borderRadius: 10, padding: '13px 14px', fontSize: 16, outline: 'none' }

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } })
    if (error) { setError(error.message); setLoading(false); return }
    if (data.session && data.user) {
      // Signed in immediately (email confirmation disabled) — safe to create the profile now.
      await supabase.from('profiles').upsert({ id: data.user.id, full_name: fullName, username: email.split('@')[0] })
      router.push('/onboarding')
    } else {
      // Email confirmation required: there's no session yet, so a profile write would be
      // blocked by RLS. The profile is created on first authenticated onboarding instead.
      setLoading(false)
      setConfirmSent(true)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 60, height: 60, borderRadius: 16, background: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <span style={{ color: 'var(--accent-fg)', fontSize: 20, fontWeight: 700, letterSpacing: '-0.5px' }}>MB</span>
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.6px' }}>Milkbag</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>Your hybrid training starts here.</p>
        </div>
        {confirmSent ? (
          <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '24px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>✉️</div>
            <h2 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>Check your email</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 18 }}>We sent a confirmation link to <span style={{ color: 'var(--text)', fontWeight: 500 }}>{email}</span>. Confirm it, then sign in to set up your plan.</p>
            <Link href="/login" style={{ display: 'inline-block', background: 'var(--accent)', color: 'var(--accent-fg)', borderRadius: 10, padding: '12px 20px', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Go to sign in</Link>
          </div>
        ) : (
        <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '22px 20px' }}>
          <h2 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)', marginBottom: 16, letterSpacing: '-0.2px' }}>Create account</h2>
          <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {error && <p style={{ color: '#cc2200', fontSize: 13, background: 'rgba(204,34,0,0.08)', padding: '9px 12px', borderRadius: 8 }}>{error}</p>}
            <div>
              <label style={labelStyle}>Full name</label>
              <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jacob Larsson" required style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required style={inputStyle} />
            </div>
            <button type="submit" disabled={loading}
              style={{ width: '100%', background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 10, padding: 14, fontSize: 15, fontWeight: 600, cursor: loading ? 'default' : 'pointer', marginTop: 4, opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Creating account…' : 'Get started'}
            </button>
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Already have an account? <Link href="/login" style={{ color: 'var(--accent)', fontWeight: 500 }}>Sign in</Link></p>
          </form>
        </div>
        )}
      </div>
    </div>
  )
}
