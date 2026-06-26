'use client'

import {
  Activity,
  Archive,
  ArrowLeftRight,
  BarChart3,
  ChevronDown,
  Crown,
  DollarSign,
  Download,
  Gauge,
  Gift,
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
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Logo } from '@/components/brand/Logo'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { cn } from '@/lib/utils/cn'

/** Live counts surfaced as nav badges. Keys map to NavItem.countKey. */
export interface NavCounts {
  trendsUntested: number
  generationsActive: number
}

interface AdminShellProps {
  children: ReactNode
  email: string | null
  counts?: NavCounts
  signOutAction: () => Promise<void>
}

interface NavItem {
  href: string
  label: string
  icon: ReactNode
  /** When set, the item is active for nested routes (e.g. /admin/trends/[id]) */
  matchPrefix?: boolean
  /** When set, render a count badge from NavCounts[countKey] (hidden if 0). */
  countKey?: keyof NavCounts
  /** Badge tone: 'attention' (amber) nudges action, 'live' (emerald) is informational. */
  badgeTone?: 'attention' | 'live'
}

interface NavGroup {
  /** Stable key used for the collapsed-state localStorage map. */
  key: string
  title: string
  items: NavItem[]
}

// Reorganized IA (Suggestions removed; VIP + KIMP360 merged into "Access").
const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: 'overview',
    title: 'Overview',
    items: [{ href: '/admin', label: 'Dashboard', icon: <Gauge className="size-4" /> }],
  },
  {
    key: 'catalogue',
    title: 'Catalogue',
    items: [
      {
        href: '/admin/trends',
        label: 'Trends',
        icon: <Sparkles className="size-4" />,
        matchPrefix: true,
        countKey: 'trendsUntested',
        badgeTone: 'attention',
      },
      {
        href: '/admin/generations',
        label: 'Live monitor',
        icon: <Activity className="size-4" />,
        countKey: 'generationsActive',
        badgeTone: 'live',
      },
    ],
  },
  {
    key: 'growth',
    title: 'Growth',
    items: [
      { href: '/admin/engagement', label: 'Engagement', icon: <BarChart3 className="size-4" /> },
      { href: '/admin/users', label: 'Users', icon: <Users className="size-4" /> },
      { href: '/admin/referrals', label: 'Referrals', icon: <Gift className="size-4" /> },
    ],
  },
  {
    key: 'revenue',
    title: 'Revenue',
    items: [
      { href: '/admin/margin', label: 'Margin', icon: <DollarSign className="size-4" /> },
      { href: '/admin/refunds', label: 'Refunds', icon: <LifeBuoy className="size-4" /> },
      {
        href: '/admin/marketing-spend',
        label: 'Marketing spend',
        icon: <Receipt className="size-4" />,
      },
    ],
  },
  {
    key: 'access',
    title: 'Access',
    items: [
      { href: '/admin/vip', label: 'VIP', icon: <Crown className="size-4" /> },
      { href: '/admin/kimp', label: 'KIMP360', icon: <Shield className="size-4" /> },
    ],
  },
  {
    key: 'system',
    title: 'System',
    items: [
      { href: '/admin/audit', label: 'Audit', icon: <Archive className="size-4" /> },
      { href: '/admin/export', label: 'Export', icon: <Download className="size-4" /> },
      { href: '/admin/settings', label: 'Settings', icon: <Settings className="size-4" /> },
    ],
  },
] as const

const COLLAPSE_STORAGE_KEY = 'admin-nav-collapsed'

function isActive(pathname: string | null, item: NavItem): boolean {
  if (!pathname) return false
  if (item.matchPrefix) return pathname === item.href || pathname.startsWith(`${item.href}/`)
  return pathname === item.href
}

/**
 * Per-group collapsed state, persisted to localStorage. Initialized empty so
 * server + first client render agree (all groups open); the stored map is
 * applied in an effect to avoid a hydration mismatch.
 */
function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY)
      // Intentional one-time post-mount sync: server renders all-open to avoid a
      // hydration mismatch, then we apply the persisted collapse state. Not a
      // cascading-render risk (runs once, empty deps).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setCollapsed(JSON.parse(raw) as Record<string, boolean>)
    } catch {
      // Corrupt/unavailable storage — fall back to all-open.
    }
  }, [])

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Non-fatal — collapse just won't persist.
      }
      return next
    })
  }, [])

  return { collapsed, toggle }
}

function CountBadge({ value, tone }: { value: number; tone: NavItem['badgeTone'] }) {
  if (value <= 0) return null
  return (
    <span
      className={cn(
        'ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
        tone === 'live'
          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
          : 'bg-amber-400/20 text-amber-700 dark:text-amber-300'
      )}
      aria-label={`${value} ${tone === 'live' ? 'in progress' : 'need attention'}`}
    >
      {value > 99 ? '99+' : value}
    </span>
  )
}

function Sidebar({
  pathname,
  counts,
  collapsed,
  toggle,
  onNavigate,
  email,
  signOutAction,
}: {
  pathname: string | null
  counts?: NavCounts
  collapsed: Record<string, boolean>
  toggle: (key: string) => void
  onNavigate?: () => void
  email: string | null
  signOutAction: () => Promise<void>
}) {
  return (
    <div className="flex h-full flex-col gap-5 px-3 py-5">
      <Link
        href="/admin"
        aria-label="Admin home"
        onClick={onNavigate}
        className="hover:bg-muted/60 focus-visible:ring-ring/60 flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <Logo wordmark={false} size="sm" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Admin console</span>
          <span className="text-muted-foreground/70 text-[10px] font-semibold tracking-[0.18em] uppercase">
            Internal
          </span>
        </div>
      </Link>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto" aria-label="Admin sections">
        {NAV_GROUPS.map((group) => {
          const isCollapsed = Boolean(collapsed[group.key])
          const listId = `admin-nav-${group.key}`
          // Surface the group's total badge count when collapsed so hidden
          // attention items still register.
          const groupCount = group.items.reduce(
            (sum, item) => sum + (item.countKey ? (counts?.[item.countKey] ?? 0) : 0),
            0
          )
          return (
            <div key={group.key} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggle(group.key)}
                aria-expanded={!isCollapsed}
                aria-controls={listId}
                className="text-muted-foreground/70 hover:text-foreground focus-visible:ring-ring/60 group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-semibold tracking-[0.18em] uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <ChevronDown
                  className={cn(
                    'size-3 transition-transform duration-200',
                    isCollapsed && '-rotate-90'
                  )}
                  aria-hidden="true"
                />
                <span>{group.title}</span>
                {isCollapsed && groupCount > 0 && (
                  <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-400/20 px-1 text-[9px] font-bold text-amber-700 tabular-nums dark:text-amber-300">
                    {groupCount > 99 ? '99+' : groupCount}
                  </span>
                )}
              </button>

              {!isCollapsed && (
                <ul id={listId} className="mt-0.5 mb-1 flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const active = isActive(pathname, item)
                    const count = item.countKey ? (counts?.[item.countKey] ?? 0) : 0
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onNavigate}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'focus-visible:ring-ring/60 relative flex items-center gap-2.5 rounded-xl py-2 pr-2.5 pl-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
                            active
                              ? 'bg-muted text-foreground font-semibold'
                              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                          )}
                        >
                          {active && (
                            <span
                              className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-[var(--brand-grad-1,#ec4899)]"
                              aria-hidden="true"
                            />
                          )}
                          <span
                            className={cn(
                              'grid size-7 shrink-0 place-items-center rounded-lg border border-transparent',
                              active
                                ? 'border-border bg-background text-foreground shadow-sm'
                                : 'bg-muted/60 text-muted-foreground'
                            )}
                          >
                            {item.icon}
                          </span>
                          <span className="flex-1 truncate">{item.label}</span>
                          {count > 0 && <CountBadge value={count} tone={item.badgeTone} />}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
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
 * (Overview / Catalogue / Growth / Revenue / Access / System) with collapsible
 * groups persisted to localStorage, live count badges, and a slide-in drawer
 * below the `md` breakpoint. Borrows brand Logo + theme toggle from the consumer
 * app but skips the gradient surface — admin is workhorse, not viral.
 *
 * Mobile drawer behavior:
 * - Hidden by default below `md:`; hamburger button (top-left, sticky) opens.
 * - Drawer slides in from the left, full-height, with semi-transparent backdrop.
 * - Backdrop click, close button, and Escape all close the drawer.
 * - On open, focus moves to the close button for keyboard users.
 */
export function AdminShell({ children, email, counts, signOutAction }: AdminShellProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const { collapsed, toggle } = useCollapsedGroups()

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
          <Sidebar
            pathname={pathname}
            counts={counts}
            collapsed={collapsed}
            toggle={toggle}
            email={email}
            signOutAction={signOutAction}
          />
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
                  counts={counts}
                  collapsed={collapsed}
                  toggle={toggle}
                  onNavigate={close}
                  email={email}
                  signOutAction={signOutAction}
                />
              ) : null}
            </div>
          </div>
        </div>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 md:px-10 md:py-10">
          {/* Keyed by route so each page fades in on navigation, but a same-route
              router.refresh (15s polling / realtime) does NOT remount → no twitch. */}
          <div key={pathname} className="animate-fade-up">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
