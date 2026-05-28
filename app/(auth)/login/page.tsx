import { LoginForms } from './LoginForms'

type SearchParams = Promise<{ next?: string; sent?: string; error?: string }>

const ERROR_COPY: Record<string, string> = {
  invalid_email: 'Please enter a valid email.',
  bot_check_failed: 'Bot check failed. Refresh and try again.',
  otp_send_failed: 'Could not send the magic link. Try again.',
  oauth_failed: 'Google sign-in failed. Try again.',
  missing_code: 'Sign-in link expired. Try again.',
  exchange_failed: 'Could not finish sign-in. Try again.',
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { next = '/', sent, error } = await searchParams
  const errorMessage = error ? (ERROR_COPY[error] ?? 'Sign in failed. Try again.') : null

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight">
          Welcome <span className="text-gradient-hero">in</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Save your creations, unlock the gallery, and refer friends for free credits.
        </p>
      </header>

      {sent && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          <p className="font-medium">Check your inbox.</p>
          <p className="opacity-80">We sent a magic link — tap it to finish signing in.</p>
        </div>
      )}
      {errorMessage && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      <LoginForms next={next} />

      <p className="text-center text-xs text-muted-foreground">
        By continuing you agree to our terms + privacy policy.
      </p>
    </div>
  )
}
