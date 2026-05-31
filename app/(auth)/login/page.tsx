import Link from 'next/link'
import { LoginForms } from './LoginForms'

type SearchParams = Promise<{ next?: string; sent?: string; error?: string }>

const ERROR_COPY: Record<string, string> = {
  invalid_email: 'Please enter a valid email.',
  password_too_short: 'Password must be at least 8 characters.',
  wrong_password: 'Wrong password. Try again or create a new account with a different password.',
  signup_failed: 'Could not create your account. Try again.',
  bot_check_failed: 'Bot check failed. Refresh and try again.',
  oauth_failed: 'Google sign-in failed. Try again.',
  missing_code: 'Confirmation link expired. Try again.',
  exchange_failed: 'Could not finish sign-in. Try again.',
  tos_required: 'Please check the box to accept our terms + privacy policy before continuing.',
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { next = '/me/studio', sent, error } = await searchParams
  const errorMessage = error ? (ERROR_COPY[error] ?? 'Sign in failed. Try again.') : null

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight">
          Sign <span className="text-gradient-hero">in</span>
        </h1>
        <p className="text-muted-foreground text-sm">
          Sign in to save your creations, unlock the gallery, and refer friends for free credits.
        </p>
      </header>

      {sent && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          <p className="font-medium">Check your inbox.</p>
          <p className="opacity-80">
            We sent a confirmation link. Click it once, then sign in with your password — no more
            emails needed.
          </p>
        </div>
      )}
      {errorMessage && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-2xl border px-4 py-3 text-sm">
          {errorMessage}
        </div>
      )}

      <LoginForms next={next} />

      <p className="text-muted-foreground text-center text-xs">
        Admin?{' '}
        <Link
          href="/admin/login"
          className="text-foreground font-medium underline-offset-2 hover:underline"
        >
          Sign in here
        </Link>
      </p>

      <p className="text-muted-foreground text-center text-xs">
        By continuing you agree to our{' '}
        <Link href="/terms" className="font-medium underline-offset-2 hover:underline">
          terms
        </Link>{' '}
        +{' '}
        <Link href="/privacy" className="font-medium underline-offset-2 hover:underline">
          privacy policy
        </Link>
        .
      </p>
    </div>
  )
}
