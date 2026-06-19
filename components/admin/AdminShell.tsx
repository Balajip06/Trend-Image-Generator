'use client'

import {
  Activity,
  Archive,
  ArrowLeftRight,
  BarChart3,
  Crown,
  DollarSign,
  Download,
  Gauge,
  Gift,
  Inbox,
  LifeBuoy,
  LogOut,
  Menu,
  Receipt,
  Settings,
  Shield,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Logo } from '@/components/brand/Logo'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils/cn'

interface AdminShellProps {
  children: ReactNode
  email: string | null
  signOutAction: () => Promise<void>
}

interface NavItem {
  href: string
  label: string
  icon: ReactNode
  /** When set, the item is considered active for nested routes (e.g. /admin/trends/[id]) */
  matchPrefix?: boolean
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    title: 'Overview',
    items: [{ href: '/admin', label: 'Dashboard', icon: <Gauge className="size-4" /> }],
  },
  {
    title: 'Growth',
    items: [
      {
        href: '/admin/engagement',
        label: 'Engagement',
        icon: <BarChart3 className="size-4" />,
      },
      {
        href: '/admin/users',
        label: 'Users',
        icon: <Users className="size-4" />,
      },
      {
        href: '/admin/referrals',
        label: 'Referrals',
        icon: <Gift className="size-4" />,
      },
    ],
  },
  {
    title: 'Revenue',
    items: [
      {
        href: '/admin/margin',
        label: 'Margin',
        icon: <DollarSign className="size-4" />,
      },
      {
        href: '/admin/refunds',
        label: 'Refunds',
        icon: <LifeBuoy className="size-4" />,
      },
      {
        href: '/admin/marketing-spend',
        label: 'Marketing spend',
        icon: <Receipt className="size-4" />,
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      {
        href: '/admin/generations',
        label: 'Live monitor',
        icon: <Activity className="size-4" />,
      },
      {
        href: '/admin/trends',
        label: 'Trends',
        icon: <Sparkles className="size-4" />,
        matchPrefix: true,
      },
      {
        href: '/admin/suggestions',
        label: 'Suggestions',
        icon: <Inbox className="size-4" />,
      },
      {
        href: '/admin/audit',
        label: 'Audit',
        icon: <Archive className="size-4" />,
      },
      {
        href: '/admin/export',
        label: 'Export',
        icon: <Download className="size-4" />,
      },
      {
        href: '/admin/vip',
        label: 'VIP',
        icon: <Crown className="size-4" />,
      },
      {
        href: '/admin/kimp',
        label: 'KIMP360',
        icon: <Shield className="size-4" />,
      },
      {
        href: '/admin/settings',
        label: 'Settings',
        icon: <Settings className="size-4" />,
      },
    ],
  },
] as const

function isActive(pathname: string | null, item: NavItem): boolean {
  if (!pathname) return false
  if (item.matchPrefix) return pathname === item.href || pathname.startsWith(`${item.href}/`)
  return pathname === item.href
}

function Sidebar({
  pathname,
  onNavigate,
  email,
  signOutAction,
}: {
  pathname: string | null
  onNavigate?: () => void
  email: string | null
  signOutAction: () => Promise<void>
}) {
  return (
    <div className="flex h-full flex-col gap-6 px-3 py-5">
      <Link
        href="/admin"
        aria-label="Admin home"
        onClick={onNavigate}
        className="hover:bg-muted/60 focus-visible:ring-ring/60 flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <Logo wordmark={false} size="sm" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Admin console</span>
          <Badge
            variant="outline"
            className="mt-0.5 w-fit rounded-full px-2 py-0 text-[10px] uppercase"
          >
            internal
          </Badge>
        </div>
      </Link>

      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto" aria-label="Admin sections">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-1">
            <p className="text-muted-foreground/80 px-2 text-[10px] font-semibold tracking-[0.18em] uppercase">
              {group.title}
            </p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'focus-visible:ring-ring/60 flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
                        active
                          ? 'bg-muted text-foreground font-semibold'
                          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      )}
                    >
                      <span
                        className={cn(
                          'grid size-7 place-items-center rounded-lg border border-transparent',
                          active
                            ? 'border-border bg-background text-foreground shadow-sm'
                            : 'bg-muted/60 text-muted-foreground'
                        )}
                      >
                        {item.icon}
                      </span>
                      <span className="flex-1">{item.label}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-border/60 bg-muted/40 flex flex-col gap-2 rounded-xl border p-3">
        {email && (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-muted-foreground/80 text-[10px] font-semibold tracking-[0.18em] uppercase">
                Signed in
              </p>
              <p className="text-foreground truncate text-xs font-semibold" title={email}>
                {email}
              </p>
            </div>
            <form action={signOutAction}>
              <button
                type="submit"
                aria-label="Sign out"
                className="border-border/60 bg-background text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-ring/60 grid size-7 place-items-center rounded-lg border transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <LogOut className="size-3.5" aria-hidden="true" />
              </button>
            </form>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/"
            onClick={onNavigate}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 inline-flex items-center gap-1.5 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
            aria-label="← App"
          >
            <ArrowLeftRight className="size-3.5" aria-hidden="true" />← App
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </div>
  )
}

/**
 * Admin shell — persistent sidebar nav grouped by domain
 * (Overview / Growth / Revenue / Operations) plus a slide-in drawer below
 * the `md` breakpoint. Borrows brand Logo + theme toggle from the consumer
 * app but skips the gradient surface — admin is workhorse, not viral.
 *
 * Mobile drawer behavior:
 * - Hidden by default below `md:`; hamburger button (top-left, sticky) opens.
 * - Drawer slides in from the left, full-height, with semi-transparent backdrop.
 * - Backdrop click, close button, and Escape all close the drawer.
 * - On open, focus moves to the close button for keyboard users.
 */
export function AdminShell({ children, email, signOutAction }: AdminShellProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  const close = () => setMobileOpen(false)

  // Close drawer on Escape — only attach the listener when open so we don't
  // leak global keydown handlers for every admin page render.
  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMobileOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen])

  // Move focus to the close button when the drawer opens so keyboard users
  // can immediately Tab through the nav or hit Escape to dismiss.
  useEffect(() => {
    if (mobileOpen) {
      closeButtonRef.current?.focus()
    }
  }, [mobileOpen])

  return (
    <div className="bg-background text-foreground flex min-h-screen">
      <aside className="border-border/60 bg-card/40 hidden w-64 shrink-0 border-r md:block">
        <div className="sticky top-0 h-screen">
          <Sidebar pathname={pathname} email={email} signOutAction={signOutAction} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border/60 bg-background/85 sticky top-0 z-30 flex items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur-md md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            aria-controls="admin-mobile-drawer"
            className="border-border/60 bg-background text-foreground hover:bg-muted focus-visible:ring-ring/60 grid size-9 place-items-center rounded-xl border transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <Menu className="size-4" aria-hidden="true" />
          </button>
          <Link
            href="/admin"
            className="focus-visible:ring-ring/60 flex items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:outline-none"
          >
            <Logo wordmark={false} size="sm" />
            <span className="text-sm font-semibold tracking-tight">Admin console</span>
            <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] uppercase">
              internal
            </Badge>
          </Link>
          {/* Right-side spacer so the title stays visually centered next to the hamburger */}
          <span className="size-9" aria-hidden="true" />
        </header>

        <div
          id="admin-mobile-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Admin navigation"
          data-state={mobileOpen ? 'open' : 'closed'}
          className={cn(
            'fixed inset-0 z-40 md:hidden',
            mobileOpen ? 'pointer-events-auto' : 'pointer-events-none'
          )}
        >
          <div
            className={cn(
              'bg-background/70 absolute inset-0 backdrop-blur-sm transition-opacity duration-200',
              mobileOpen ? 'opacity-100' : 'opacity-0'
            )}
            onClick={close}
            aria-hidden="true"
          />
          <div
            className={cn(
              'border-border/60 bg-card relative flex h-full w-72 flex-col border-r shadow-2xl transition-transform duration-200 ease-out',
              mobileOpen ? 'translate-x-0' : '-translate-x-full'
            )}
          >
            <div className="flex items-center justify-end px-3 py-3">
              <button
                ref={closeButtonRef}
                type="button"
                onClick={close}
                aria-label="Close menu"
                className="border-border/60 bg-background text-foreground hover:bg-muted focus-visible:ring-ring/60 grid size-9 place-items-center rounded-xl border transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {/* Only mount the drawer's nav while open — keeps closed-state
                  links out of the a11y tree and prevents duplicate-link
                  collisions with the desktop sidebar. */}
              {mobileOpen ? (
                <Sidebar
                  pathname={pathname}
                  onNavigate={close}
                  email={email}
                  signOutAction={signOutAction}
                />
              ) : null}
            </div>
          </div>
        </div>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 md:px-10 md:py-10">
          {children}
        </main>
      </div>
    </div>
  )
}
