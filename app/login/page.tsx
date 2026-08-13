'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }
const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--border-strong)', color: 'var(--text)', borderRadius: 10, padding: '13px 14px', fontSize: 16, outline: 'none' }

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false) }
    else { router.push('/dashboard') }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 60, height: 60, borderRadius: 16, background: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <span style={{ color: 'var(--accent-fg)', fontSize: 20, fontWeight: 700, letterSpacing: '-0.5px' }}>MB</span>
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.6px' }}>Milkbag</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>Run far. Lift heavy. Race hard.</p>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '22px 20px' }}>
          <h2 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)', marginBottom: 16, letterSpacing: '-0.2px' }}>Welcome back</h2>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {error && <p style={{ color: '#cc2200', fontSize: 13, background: 'rgba(204,34,0,0.08)', padding: '9px 12px', borderRadius: 8 }}>{error}</p>}
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
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No account? <Link href="/signup" style={{ color: 'var(--accent)', fontWeight: 500 }}>Sign up free</Link></p>
          </form>
        </div>
      </div>
    </div>
  )
}
