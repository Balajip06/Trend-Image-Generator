import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from './database.types'

export async function updateSession(request: NextRequest) {
  // Dev-only escape hatch: MOCK_TRENDS=true short-circuits auth so Playwright
  // baselines can render authed pages without a real Supabase session.
  // Never set MOCK_TRENDS in production.
  if (process.env.MOCK_TRENDS === 'true') {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Public admin surfaces (login, forgot/reset password) are reachable
  // without an admin session — the whole point is letting admins establish
  // one. The gate below skips them so the redirect loop can't form.
  const ADMIN_PUBLIC = ['/admin/login', '/admin/forgot-password', '/admin/reset-password']
  const isAdminPublic = ADMIN_PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  // Admin gate
  if (pathname.startsWith('/admin') && !isAdminPublic) {
    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = '/admin/login'
      url.searchParams.set('next', pathname)
      return NextResponse.redirect(url)
    }
    const { data: adminRow } = await supabase
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!adminRow) {
      const url = request.nextUrl.clone()
      url.pathname = '/admin/login'
      url.searchParams.set('error', 'not_admin')
      return NextResponse.redirect(url)
    }
  }

  // Authed-area gate
  const AUTHED_PREFIXES = ['/creations', '/settings', '/studio', '/result']
  if (AUTHED_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('next', pathname)
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
