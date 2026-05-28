import { notFound } from 'next/navigation'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

import {
  AccordionSection,
  BadgesSection,
  BrandLayerSection,
  BrandSurfacesSection,
  ButtonsSection,
  CardSection,
  DialogSection,
  FormPrimitivesSection,
  MotionSection,
  ProgressSection,
  RadiusSection,
  SeparatorSection,
  SkeletonSection,
  SwitchSection,
  TabsSection,
  ToasterSection,
  TokensSection,
  TypographySection,
} from './Sections'

interface SectionDef {
  id: string
  title: string
  description: string
  Component: React.ComponentType
}

const SECTIONS: SectionDef[] = [
  {
    id: 'tokens',
    title: '1. Brand tokens',
    description:
      'Surface palette (light + dark) and brand gradient stops. Resolved values shown beneath each swatch.',
    Component: TokensSection,
  },
  {
    id: 'radius',
    title: '2. Radius scale',
    description: '--radius-sm through --radius-2xl applied to identical cards.',
    Component: RadiusSection,
  },
  {
    id: 'typography',
    title: '3. Typography',
    description: 'Heading scale, body, muted, monospace, and the gradient hero treatment.',
    Component: TypographySection,
  },
  {
    id: 'brand',
    title: '4. Brand layer',
    description: 'Logo sizes/variants and GradientButton sizes/states.',
    Component: BrandLayerSection,
  },
  {
    id: 'buttons',
    title: '5. Button (shadcn)',
    description: 'Every variant × every size, including disabled.',
    Component: ButtonsSection,
  },
  {
    id: 'badges',
    title: '6. Badge (shadcn)',
    description: 'Every badge variant.',
    Component: BadgesSection,
  },
  {
    id: 'form',
    title: '7. Form primitives (Input + Label + Select)',
    description: 'Default, disabled, typed inputs, required-asterisk label, and Select with defaultOpen.',
    Component: FormPrimitivesSection,
  },
  {
    id: 'skeleton',
    title: '8. Skeleton',
    description: 'Common skeleton shapes — line, block, circle.',
    Component: SkeletonSection,
  },
  {
    id: 'card',
    title: '9. Card',
    description: 'Header + description + content + footer composition.',
    Component: CardSection,
  },
  {
    id: 'dialog',
    title: '10. Dialog',
    description: 'Rendered with defaultOpen so the visual baseline can shoot it.',
    Component: DialogSection,
  },
  {
    id: 'accordion',
    title: '11. Accordion',
    description: 'Three items, the first defaultOpen.',
    Component: AccordionSection,
  },
  {
    id: 'tabs',
    title: '12. Tabs',
    description: 'Three tabs with a defaultValue.',
    Component: TabsSection,
  },
  {
    id: 'switch',
    title: '13. Switch',
    description: 'Interactive, on, and off states.',
    Component: SwitchSection,
  },
  {
    id: 'progress',
    title: '14. Progress',
    description: '0%, 50%, 100% — primary fill against muted track.',
    Component: ProgressSection,
  },
  {
    id: 'separator',
    title: '15. Separator',
    description: 'Horizontal and vertical orientations.',
    Component: SeparatorSection,
  },
  {
    id: 'toaster',
    title: '16. Sonner Toaster',
    description:
      'Toaster is mounted in app/layout.tsx — click a button to verify each level renders.',
    Component: ToasterSection,
  },
  {
    id: 'motion',
    title: '17. Motion utilities',
    description: 'Click a class to toggle it on the sample element. One-shot animations remount each click.',
    Component: MotionSection,
  },
  {
    id: 'brand-surfaces',
    title: '18. Brand surfaces',
    description: 'Gradient backgrounds and brand shadows.',
    Component: BrandSurfacesSection,
  },
]

/**
 * Dev-only styleguide. Renders every primitive, brand component, design
 * token, motion utility, and brand surface in one page.
 *
 * Gated on NODE_ENV !== 'production' — the route is dead-code-eliminated
 * (or 404'd) in production builds via `notFound()`. No public links to
 * this page; not added to sitemap.ts.
 */
export default function StyleguidePage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-extrabold tracking-tight">Styleguide</h1>
            <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
              dev only
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10 lg:grid lg:grid-cols-[200px_1fr] lg:gap-10">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 flex flex-col gap-1 text-sm">
            <span className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Sections
            </span>
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {section.title}
              </a>
            ))}
          </nav>
        </aside>

        <main className="flex flex-col gap-8">
          {SECTIONS.map(({ id, title, description, Component }) => (
            <Card key={id} id={id} className="scroll-mt-24">
              <CardHeader>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Component />
              </CardContent>
            </Card>
          ))}
        </main>
      </div>
    </div>
  )
}
