'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

interface FlashMessage {
  key: string
  level: 'success' | 'info' | 'error'
  message: string | ((value: string) => string)
}

interface FlashToastsProps {
  flashes: FlashMessage[]
}

/**
 * Reads ?key=value search params, fires sonner toasts, and strips the params
 * from the URL on next paint so a refresh doesn't re-fire them. Server actions
 * keep their `redirect('?saved=1')` pattern intact.
 */
export function FlashToasts({ flashes }: FlashToastsProps) {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  // Module-level fired set survives StrictMode double-mount; keyed by full URL+param.
  const firedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let consumed = false
    const next = new URLSearchParams(params?.toString() ?? '')
    for (const f of flashes) {
      const raw = params?.get(f.key)
      if (raw === null || raw === undefined) continue
      const fingerprint = `${pathname}?${f.key}=${raw}`
      if (firedRef.current.has(fingerprint)) continue
      firedRef.current.add(fingerprint)

      const decoded = decodeURIComponent(raw)
      const text = typeof f.message === 'function' ? f.message(decoded) : f.message
      if (f.level === 'success') toast.success(text)
      else if (f.level === 'error') toast.error(text)
      else toast(text)

      next.delete(f.key)
      consumed = true
    }
    if (consumed) {
      const search = next.toString()
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false })
    }
  }, [flashes, params, pathname, router])

  return null
}
