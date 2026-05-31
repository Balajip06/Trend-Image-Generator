'use client'

import { Mail } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { TurnstileWidget } from '@/components/auth/TurnstileWidget'
import { GradientButton } from '@/components/brand/GradientButton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { signInWithEmail, signInWithGoogle } from './actions'

interface LoginFormsProps {
  next: string
}

export function LoginForms({ next }: LoginFormsProps) {
  const [token, setToken] = useState('')
  const [tosAccepted, setTosAccepted] = useState(false)
  const turnstileGated = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
  const ready = (turnstileGated ? token.length > 0 : true) && tosAccepted

  // Server actions also re-validate `tos_accepted=='1'` — this gate is the
  // UX layer; auth.ts is the security layer. Both must agree.
  const tosFieldValue = tosAccepted ? '1' : '0'

  return (
    <div className="flex flex-col gap-5">
      <label
        htmlFor="tos_accepted_checkbox"
        className="border-border/60 bg-card/40 text-muted-foreground flex items-start gap-3 rounded-2xl border p-3 text-xs"
      >
        <input
          id="tos_accepted_checkbox"
          type="checkbox"
          checked={tosAccepted}
          onChange={(e) => setTosAccepted(e.target.checked)}
          className="border-border bg-background mt-0.5 size-4 shrink-0 rounded border"
          aria-required="true"
        />
        <span>
          I agree to the{' '}
          <Link
            href="/terms"
            target="_blank"
            className="text-foreground font-medium underline-offset-2 hover:underline"
          >
            terms of service
          </Link>{' '}
          and{' '}
          <Link
            href="/privacy"
            target="_blank"
            className="text-foreground font-medium underline-offset-2 hover:underline"
          >
            privacy policy
          </Link>
          . Check this box to enable sign-in below.
        </span>
      </label>

      {turnstileGated && (
        <div className="flex flex-col items-center gap-2">
          <TurnstileWidget onToken={setToken} />
          {!token && <p className="text-muted-foreground text-xs">Waiting for bot-check…</p>}
        </div>
      )}

      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="turnstile_token" value={token} />
        <input type="hidden" name="tos_accepted" value={tosFieldValue} />
        <button
          type="submit"
          disabled={!ready}
          className="border-border bg-card hover:bg-muted flex h-12 w-full items-center justify-center gap-2 rounded-full border text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          <GoogleGlyph />
          Continue with Google
        </button>
      </form>

      <div className="relative">
        <Separator />
        <span className="bg-card text-muted-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full px-3 text-[10px] font-medium tracking-widest uppercase">
          or
        </span>
      </div>

      <form action={signInWithEmail} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="turnstile_token" value={token} />
        <input type="hidden" name="tos_accepted" value={tosFieldValue} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            className="h-12 rounded-xl"
            autoComplete="email"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            name="password"
            required
            placeholder="Min 8 characters"
            className="h-12 rounded-xl"
            autoComplete="current-password"
            minLength={8}
          />
        </div>
        <GradientButton type="submit" size="lg" disabled={!ready} className="w-full">
          <Mail className="size-4" />
          Continue with email
        </GradientButton>
      </form>
    </div>
  )
}

function GoogleGlyph() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84c-.21 1.13-.84 2.08-1.79 2.72v2.26h2.9c1.7-1.57 2.69-3.88 2.69-6.63z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.9-2.26c-.81.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.95 10.7A5.41 5.41 0 0 1 3.66 9c0-.59.1-1.17.29-1.7V4.97H.96A8.997 8.997 0 0 0 0 9c0 1.45.35 2.83.96 4.03l2.99-2.33z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A8.997 8.997 0 0 0 .96 4.97l2.99 2.33C4.66 5.17 6.65 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  )
}
