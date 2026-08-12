'use client'

// Conversion surface: replaces the silent 409 toast with an actionable
// signup prompt at the exact moment intent is highest — mirrors
// QuotaUpsellModal's treatment of the authed quota-exhausted case.

import Link from 'next/link'
import { GradientButton } from '@/components/brand/GradientButton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface AnonymousTrialUsedModalProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  trendSlug: string
}

export function AnonymousTrialUsedModal({
  open,
  onOpenChange,
  trendSlug,
}: AnonymousTrialUsedModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border/60 bg-card rounded-3xl border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl leading-tight font-semibold">
            You&apos;ve used your <span className="text-gradient-hero">free trial</span>
          </DialogTitle>
          <DialogDescription>
            One free try per device — sign up for 5 free generations every week, no card
            required.
          </DialogDescription>
        </DialogHeader>

        <GradientButton size="lg" className="w-full" asChild>
          <Link href={`/login?next=/studio?trend=${trendSlug}`}>Sign up free</Link>
        </GradientButton>
      </DialogContent>
    </Dialog>
  )
}
