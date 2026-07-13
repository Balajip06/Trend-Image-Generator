'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Clapperboard, ImageIcon, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const tabs = [
  { href: '/studio', label: 'Studio', icon: Clapperboard },
  { href: '/creations', label: 'Creations', icon: ImageIcon },
  { href: '/settings', label: 'Settings', icon: Settings2 },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Main navigation"
      className="border-border/60 bg-background/90 fixed right-0 bottom-0 left-0 z-40 border-t backdrop-blur-md sm:hidden"
    >
      <ul
        className="mx-auto flex max-w-md items-center justify-around px-2 py-1"
        style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}
      >
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-[10px] font-semibold tracking-wide transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className={cn('size-5', active && 'stroke-[2.5]')} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
