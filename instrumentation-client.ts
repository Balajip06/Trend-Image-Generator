import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.0,
    enabled: process.env.NODE_ENV === 'production',
  })

  // Bundle win: defer the Replay integration (~50KB gzipped) out of the
  // initial route chunks. Replay is only useful AFTER an error has occurred
  // (replaysOnErrorSampleRate: 1.0 / session rate: 0). Loading it eagerly
  // bloats every first-load JS payload. We add it on idle so the network
  // is quiet and the main thread isn't blocked.
  //
  // Sentry's replay integration symbol is only resolved when we call it.
  // By keeping the call inside a deferred dynamic import, bundlers can place
  // the replay implementation into a separate async chunk that loads on idle
  // instead of inflating every route's first-load JS.
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
    const schedule =
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback
        : (cb: () => void) => window.setTimeout(cb, 2000)
    schedule(() => {
      void import('@sentry/nextjs').then((m) => {
        const client = Sentry.getClient()
        if (client) client.addIntegration(m.replayIntegration({ maskAllText: true, blockAllMedia: true }))
      })
    })
  }
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
