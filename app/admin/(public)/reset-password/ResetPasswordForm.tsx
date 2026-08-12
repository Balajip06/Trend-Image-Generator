'use client'

import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { GradientButton } from '@/components/brand/GradientButton'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { updatePassword } from './actions'

export function ResetPasswordForm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const showMismatch = confirm.length > 0 && password !== confirm
  const tooShort = password.length > 0 && password.length < 8

  return (
    <form action={updatePassword} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">New password</Label>
        <PasswordInput
          id="password"
          name="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="h-12 rounded-xl"
          autoComplete="new-password"
        />
        {tooShort && <p className="text-destructive text-xs">Must be at least 8 characters.</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <PasswordInput
          id="confirm"
          name="confirm"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
          className="h-12 rounded-xl"
          autoComplete="new-password"
        />
        {showMismatch && <p className="text-destructive text-xs">Passwords do not match.</p>}
      </div>
      <GradientButton type="submit" size="lg" className="w-full">
        <KeyRound className="size-4" />
        Update password
      </GradientButton>
    </form>
  )
}
