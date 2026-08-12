'use client'

import { LogIn } from 'lucide-react'
import Link from 'next/link'
import { GradientButton } from '@/components/brand/GradientButton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { signInWithPassword } from './actions'

interface AdminLoginFormProps {
  next: string
}

export function AdminLoginForm({ next }: AdminLoginFormProps) {
  return (
    <div className="flex flex-col gap-5">
      <form action={signInWithPassword} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            name="email"
            required
            placeholder="admin@example.com"
            className="h-12 rounded-xl"
            autoComplete="email"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            name="password"
            required
            placeholder="••••••••"
            className="h-12 rounded-xl"
            autoComplete="current-password"
            minLength={8}
          />
        </div>
        <GradientButton type="submit" size="lg" className="w-full">
          <LogIn className="size-4" />
          Sign in
        </GradientButton>
      </form>

      <div className="text-muted-foreground flex flex-col gap-2 text-center text-xs">
        <Link
          href="/admin/forgot-password"
          className="font-medium underline-offset-2 hover:underline"
        >
          Forgot password?
        </Link>
        <Link href="/login" className="underline-offset-2 hover:underline">
          Not an admin? Sign in as a user.
        </Link>
      </div>
    </div>
  )
}
