import type { ReactNode } from 'react'

/**
 * Minimal passthrough layout for the dev-only route group.
 *
 * Lives in its own segment so the styleguide page can opt out of the
 * public site chrome (header/footer with Logo and nav). Each page inside
 * this group must still guard its render against `NODE_ENV=production` —
 * the layout intentionally does NOT enforce that, because route-group
 * layouts cannot call `notFound()` reliably without also hiding child
 * 404 metadata.
 */
export default function DevLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
