'use client'

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

interface ReferralCopyButtonProps {
  url: string
}

export function ReferralCopyButton({ url }: ReferralCopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Referral link copied.')
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('Could not copy — long-press to copy manually.')
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={onCopy} className="rounded-xl">
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}
