import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Required for the Dockerfile's multi-stage build (IBM Cloud Code Engine)
  // Produces a self-contained server in .next/standalone
  output: 'standalone',
}

export default nextConfig
