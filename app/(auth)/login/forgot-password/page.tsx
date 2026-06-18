import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default function ForgotPasswordPage() {
  async function sendReset(formData: FormData) {
    'use server'
    const email = formData.get('email') as string
    const supabase = await createClient()
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/auth/confirm?type=recovery`,
    })
    redirect('/login?sent=1')
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight">Reset password</h1>
        <p className="text-muted-foreground text-sm">
          Enter your email and we&apos;ll send a reset link.
        </p>
      </header>
      <form action={sendReset} className="flex flex-col gap-3">
        <input
          type="email"
          name="email"
          required
          placeholder="you@example.com"
          className="h-12 rounded-xl border border-input bg-transparent px-3 text-sm"
        />
        <button
          type="submit"
          className="h-12 rounded-full bg-primary text-sm font-semibold text-primary-foreground"
        >
          Send reset link
        </button>
      </form>
    </div>
  )
}
