import withBundleAnalyzer from '@next/bundle-analyzer'
import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'

const bundleAnalyzer = withBundleAnalyzer({ enabled: process.env.ANALYZE === 'true' })

const nextConfig: NextConfig = {
  images: {
    // Allowlist only the hosts we actually serve images from. Avoids turning
    // /_next/image into an open proxy (SSRF risk against internal metadata
    // endpoints if a wildcard is left in). Adding a new CDN means updating
    // this list explicitly + redeploying.
    //
    // - *.supabase.co/storage/v1/object/{public,sign}/** — generation outputs,
    //   user uploads, admin-entered thumbnails that we host ourselves.
    // - images.unsplash.com — most common admin thumbnail source.
    // - cdn.imgix.net — second-most-common.
    // Add more hosts here as admin needs them. If an admin tries to set a
    // thumbnail from an unsupported host, next/image returns 400 — that's
    // the desired fail-loud behavior.
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/sign/**' },
      { protocol: 'https', hostname: 'images.unsplash.com', pathname: '/**' },
      { protocol: 'https', hostname: 'cdn.imgix.net', pathname: '/**' },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
}

const sentryEnabled =
  !!process.env.SENTRY_DSN && !!process.env.SENTRY_AUTH_TOKEN && process.env.NODE_ENV === 'production'

export default sentryEnabled
  ? withSentryConfig(bundleAnalyzer(nextConfig), {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      widenClientFileUpload: true,
      disableLogger: true,
      automaticVercelMonitors: false,
    })
  : bundleAnalyzer(nextConfig)
