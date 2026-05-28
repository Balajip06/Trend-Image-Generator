import Link from 'next/link'
import type { ReactNode } from 'react'
import { Logo } from '@/components/brand/Logo'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-spotlight opacity-30 blur-3xl"
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-border/60 bg-card/80 p-8 shadow-pop backdrop-blur-xl">
        <Link href="/" className="mb-6 inline-flex">
          <Logo gradient />
        </Link>
        {children}
      </div>
    </main>
  )
}
