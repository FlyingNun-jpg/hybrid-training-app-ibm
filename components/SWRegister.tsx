'use client'
import { useEffect } from 'react'

// Registers the service worker (PWA + push). Rendered once from the root layout.
export default function SWRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ })
  }, [])
  return null
}
