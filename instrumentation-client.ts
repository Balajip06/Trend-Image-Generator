import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.0,
    integrations: [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })],
    enabled: process.env.NODE_ENV === 'production',
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
