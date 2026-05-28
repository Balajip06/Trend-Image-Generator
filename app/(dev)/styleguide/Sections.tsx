'use client'

/**
 * Styleguide section components. Split out from page.tsx so each file stays
 * under the 800-line cap and the page can stay a thin composition.
 *
 * All client-side because most sections use interactivity (toasts,
 * motion togglers, Dialog/Select primitives that depend on hooks).
 */
import * as React from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { GradientButton } from '@/components/brand/GradientButton'
import { Logo } from '@/components/brand/Logo'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// ---------- Tokens ----------

interface SwatchSpec {
  name: string
  /** CSS var name without leading -- */
  cssVar: string
}

const SURFACE_TOKENS: SwatchSpec[] = [
  { name: 'background', cssVar: 'background' },
  { name: 'foreground', cssVar: 'foreground' },
  { name: 'card', cssVar: 'card' },
  { name: 'card-foreground', cssVar: 'card-foreground' },
  { name: 'popover', cssVar: 'popover' },
  { name: 'popover-foreground', cssVar: 'popover-foreground' },
  { name: 'primary', cssVar: 'primary' },
  { name: 'primary-foreground', cssVar: 'primary-foreground' },
  { name: 'secondary', cssVar: 'secondary' },
  { name: 'secondary-foreground', cssVar: 'secondary-foreground' },
  { name: 'muted', cssVar: 'muted' },
  { name: 'muted-foreground', cssVar: 'muted-foreground' },
  { name: 'accent', cssVar: 'accent' },
  { name: 'accent-foreground', cssVar: 'accent-foreground' },
  { name: 'destructive', cssVar: 'destructive' },
  { name: 'destructive-foreground', cssVar: 'destructive-foreground' },
  { name: 'border', cssVar: 'border' },
  { name: 'input', cssVar: 'input' },
  { name: 'ring', cssVar: 'ring' },
]

const BRAND_TOKENS: SwatchSpec[] = [
  { name: 'brand-grad-1 (pink)', cssVar: 'brand-grad-1' },
  { name: 'brand-grad-2 (orange)', cssVar: 'brand-grad-2' },
  { name: 'brand-grad-3 (gold)', cssVar: 'brand-grad-3' },
  { name: 'brand-cyan', cssVar: 'brand-cyan' },
  { name: 'brand-violet', cssVar: 'brand-violet' },
]

function Swatch({ spec }: { spec: SwatchSpec }) {
  const [resolved, setResolved] = React.useState<string>('—')
  const ref = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!ref.current) return
    const value = getComputedStyle(ref.current).backgroundColor
    setResolved(value || '—')
  }, [])

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={ref}
        className="size-24 rounded-md border border-border/60"
        style={{ background: `var(--${spec.cssVar})` }}
      />
      <div className="flex flex-col text-xs">
        <span className="font-medium">{spec.name}</span>
        <span className="font-mono text-muted-foreground">--{spec.cssVar}</span>
        <span className="font-mono text-muted-foreground">{resolved}</span>
      </div>
    </div>
  )
}

/** Forces a child subtree to render in light or dark regardless of the page theme. */
function ThemeScope({
  mode,
  children,
}: {
  mode: 'light' | 'dark'
  children: React.ReactNode
}) {
  return (
    <div
      className={mode === 'dark' ? 'dark' : ''}
      // Apply the surface so the swatches read against the correct base.
      style={{ background: 'var(--background)', color: 'var(--foreground)' }}
    >
      <div className="rounded-md border border-border/60 p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {mode}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {children}
        </div>
      </div>
    </div>
  )
}

export function TokensSection() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-6 lg:grid-cols-2">
        <ThemeScope mode="light">
          {SURFACE_TOKENS.map((spec) => (
            <Swatch key={`light-${spec.cssVar}`} spec={spec} />
          ))}
        </ThemeScope>
        <ThemeScope mode="dark">
          {SURFACE_TOKENS.map((spec) => (
            <Swatch key={`dark-${spec.cssVar}`} spec={spec} />
          ))}
        </ThemeScope>
      </div>
      <Separator />
      <div>
        <h3 className="mb-4 text-base font-semibold">Brand gradient stops</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          {BRAND_TOKENS.map((spec) => (
            <Swatch key={spec.cssVar} spec={spec} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------- Radius ----------

const RADII = [
  { name: 'radius-sm', cssVar: 'radius-sm', size: '0.5rem' },
  { name: 'radius-md', cssVar: 'radius-md', size: '0.75rem' },
  { name: 'radius-lg', cssVar: 'radius-lg', size: '1.25rem' },
  { name: 'radius-xl', cssVar: 'radius-xl', size: '1.75rem' },
  { name: 'radius-2xl', cssVar: 'radius-2xl', size: '2.5rem' },
] as const

export function RadiusSection() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {RADII.map((r) => (
        <div key={r.cssVar} className="flex flex-col gap-2">
          <div
            className="grid h-24 place-items-center border bg-muted text-xs text-muted-foreground"
            style={{ borderRadius: `var(--${r.cssVar})` }}
          >
            {r.size}
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            --{r.cssVar}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------- Typography ----------

export function TypographySection() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-5xl font-extrabold tracking-tight">H1 — Display</h1>
      <h2 className="text-3xl font-extrabold tracking-tight">H2 — Section</h2>
      <h3 className="text-xl font-semibold">H3 — Subsection</h3>
      <p className="text-base">
        Body text. Pick a viral trend. Upload your photo. Make the moment everyone
        is making.
      </p>
      <p className="text-sm text-muted-foreground">
        Muted text — meta, captions, helper copy.
      </p>
      <code className="rounded bg-muted px-2 py-1 font-mono text-sm">
        const example = &quot;font-mono code sample&quot;
      </code>
      <p className="text-4xl font-extrabold tracking-tight text-gradient-hero">
        Gradient hero text
      </p>
    </div>
  )
}

// ---------- Brand layer ----------

export function BrandLayerSection() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Logo</h3>
        <div className="flex flex-wrap items-center gap-6">
          <Logo size="sm" />
          <Logo size="md" />
          <Logo size="lg" />
          <Logo size="md" wordmark={false} />
          <Logo size="md" gradient />
          <Logo size="lg" gradient />
        </div>
      </div>
      <Separator />
      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
          GradientButton
        </h3>
        <div className="flex flex-wrap items-center gap-4">
          <GradientButton size="sm">Small</GradientButton>
          <GradientButton size="md">Medium</GradientButton>
          <GradientButton size="lg">Large</GradientButton>
          <GradientButton size="xl">Extra large</GradientButton>
          <GradientButton size="md" disabled>
            Disabled
          </GradientButton>
          <GradientButton asChild size="md">
            <Link href="#">As a Link</Link>
          </GradientButton>
          <GradientButton size="md">
            <Sparkles className="size-4" />
            With icon
          </GradientButton>
        </div>
      </div>
    </div>
  )
}

// ---------- Buttons ----------

const BUTTON_VARIANTS = [
  'default',
  'destructive',
  'outline',
  'secondary',
  'ghost',
  'link',
] as const

const BUTTON_SIZES = ['xs', 'sm', 'default', 'lg'] as const

export function ButtonsSection() {
  return (
    <div className="flex flex-col gap-6">
      {BUTTON_VARIANTS.map((variant) => (
        <div key={variant}>
          <div className="mb-2 text-xs font-mono text-muted-foreground">
            variant=&quot;{variant}&quot;
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {BUTTON_SIZES.map((size) => (
              <Button key={size} variant={variant} size={size}>
                {size}
              </Button>
            ))}
            <Button variant={variant} disabled>
              disabled
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------- Badges ----------

const BADGE_VARIANTS = [
  'default',
  'secondary',
  'destructive',
  'outline',
  'ghost',
  'link',
] as const

export function BadgesSection() {
  return (
    <div className="flex flex-wrap gap-3">
      {BADGE_VARIANTS.map((variant) => (
        <Badge key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  )
}

// ---------- Form primitives ----------

export function FormPrimitivesSection() {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="sg-default">Default</Label>
        <Input id="sg-default" placeholder="Type here..." />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="sg-disabled">Disabled</Label>
        <Input id="sg-disabled" placeholder="No input" disabled />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="sg-email">
          Email <span className="text-destructive">*</span>
        </Label>
        <Input id="sg-email" type="email" placeholder="you@trendly.app" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="sg-number">Number</Label>
        <Input id="sg-number" type="number" placeholder="42" />
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor="sg-select">Select (defaultOpen for screenshot)</Label>
        <Select defaultOpen>
          <SelectTrigger id="sg-select" className="w-full sm:w-72">
            <SelectValue placeholder="Pick a trend aspect" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1:1">Square (1:1)</SelectItem>
            <SelectItem value="3:4">Portrait (3:4)</SelectItem>
            <SelectItem value="9:16">Story (9:16)</SelectItem>
            <SelectItem value="16:9">Wide (16:9)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

// ---------- Skeleton + Card ----------

export function SkeletonSection() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="size-12 rounded-full" />
    </div>
  )
}

export function CardSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Card title</CardTitle>
        <CardDescription>
          A neutral container — used for trend tiles, eval panels, settings groups.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">
          Cards combine header, content, and footer slots. They consume
          <code className="ml-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
            --card
          </code>
          and have a soft shadow by default.
        </p>
      </CardContent>
      <CardFooter className="border-t pt-4">
        <Button size="sm">Primary action</Button>
      </CardFooter>
    </Card>
  )
}

// ---------- Dialog ----------

export function DialogSection() {
  return (
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button variant="outline">Open dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>
            Dialogs render in a portal — the overlay dims everything behind. Use
            for destructive confirms or focus-trapped flows.
          </DialogDescription>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">
          Body content goes here. The dialog is rendered with{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            defaultOpen
          </code>{' '}
          so the visual baseline can shoot it.
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Accordion ----------

export function AccordionSection() {
  return (
    <Accordion type="single" collapsible defaultValue="item-1" className="w-full">
      <AccordionItem value="item-1">
        <AccordionTrigger>How does the credit system work?</AccordionTrigger>
        <AccordionContent>
          5 free generations per week. Buy credit packs for unlimited generations.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Can I remove the watermark?</AccordionTrigger>
        <AccordionContent>
          Yes — Pro removes watermarks from downloads.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>What happens to my creations?</AccordionTrigger>
        <AccordionContent>
          Free: 30-day storage. Pro: stored forever.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

// ---------- Tabs ----------

export function TabsSection() {
  return (
    <Tabs defaultValue="trends" className="w-full">
      <TabsList>
        <TabsTrigger value="trends">Trends</TabsTrigger>
        <TabsTrigger value="eval">Eval</TabsTrigger>
        <TabsTrigger value="audit">Audit</TabsTrigger>
      </TabsList>
      <TabsContent value="trends" className="pt-4 text-sm text-muted-foreground">
        Trends tab — schema-driven admin CRUD.
      </TabsContent>
      <TabsContent value="eval" className="pt-4 text-sm text-muted-foreground">
        Eval tab — gates is_active=true on eval_status=passed.
      </TabsContent>
      <TabsContent value="audit" className="pt-4 text-sm text-muted-foreground">
        Audit tab — admin_audit_log viewer.
      </TabsContent>
    </Tabs>
  )
}

// ---------- Switch + Progress ----------

export function SwitchSection() {
  const [on, setOn] = React.useState(true)
  return (
    <div className="flex items-center gap-6">
      <div className="flex items-center gap-2">
        <Switch checked={on} onCheckedChange={setOn} id="sg-switch-on" />
        <Label htmlFor="sg-switch-on">Interactive</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked id="sg-switch-checked" onCheckedChange={() => undefined} />
        <Label htmlFor="sg-switch-checked">On</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={false}
          id="sg-switch-unchecked"
          onCheckedChange={() => undefined}
        />
        <Label htmlFor="sg-switch-unchecked">Off</Label>
      </div>
    </div>
  )
}

export function ProgressSection() {
  return (
    <div className="flex flex-col gap-3">
      <Progress value={0} />
      <Progress value={50} />
      <Progress value={100} />
    </div>
  )
}

// ---------- Separator ----------

export function SeparatorSection() {
  return (
    <div className="flex h-16 items-center gap-4 text-sm">
      <span>Above</span>
      <Separator />
      <span>Below</span>
      <Separator orientation="vertical" />
      <span>Right</span>
    </div>
  )
}

// ---------- Toaster trigger ----------

export function ToasterSection() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => toast('Default toast')}>Default</Button>
      <Button
        variant="secondary"
        onClick={() => toast.success('Generation complete')}
      >
        Success
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.info('Pro tip: upload portrait photos')}
      >
        Info
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.warning('Quota almost spent')}
      >
        Warning
      </Button>
      <Button
        variant="destructive"
        onClick={() => toast.error('Gemini returned a safety rejection')}
      >
        Error
      </Button>
    </div>
  )
}

// ---------- Motion ----------

const MOTION_UTILITIES = [
  'animate-fade-up',
  'animate-pop-in',
  'animate-pulse-glow',
  'animate-shimmer',
  'animate-float',
] as const

export function MotionSection() {
  const [active, setActive] = React.useState<(typeof MOTION_UTILITIES)[number] | null>(
    null,
  )
  // Bump the key so React remounts the sample element each toggle — the
  // one-shot animations (fade-up, pop-in) won't replay otherwise.
  const [key, setKey] = React.useState(0)

  const trigger = (cls: (typeof MOTION_UTILITIES)[number]) => {
    setActive(cls)
    setKey((k) => k + 1)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {MOTION_UTILITIES.map((cls) => (
          <Button
            key={cls}
            variant={active === cls ? 'default' : 'outline'}
            size="sm"
            onClick={() => trigger(cls)}
          >
            {cls}
          </Button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setActive(null)}>
          Reset
        </Button>
      </div>
      <div className="grid h-48 place-items-center rounded-lg border bg-muted/30">
        <div
          key={key}
          className={`size-20 rounded-xl brand-grad ${active ?? ''}`}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Active class:{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono">
          {active ?? '(none)'}
        </code>
      </p>
    </div>
  )
}

// ---------- Brand surfaces ----------

export function BrandSurfacesSection() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid h-60 place-items-center rounded-xl bg-gradient-hero text-white shadow-glow-pink">
        <div className="text-center">
          <div className="text-xs uppercase tracking-widest opacity-80">
            bg-gradient-hero
          </div>
          <div className="mt-2 text-2xl font-extrabold">Make the trend</div>
        </div>
      </div>
      <div className="grid h-32 place-items-center rounded-xl bg-gradient-cool text-white shadow-glow-cyan">
        <span className="text-sm font-medium uppercase tracking-widest">
          bg-gradient-cool
        </span>
      </div>
      <div className="relative h-40 overflow-hidden rounded-xl border">
        <div className="absolute inset-0 bg-gradient-spotlight opacity-50 blur-3xl" />
        <div className="relative grid h-full place-items-center">
          <span className="text-sm font-medium uppercase tracking-widest text-foreground/70">
            bg-gradient-spotlight + blur-3xl
          </span>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(['shadow-glow-pink', 'shadow-glow-cyan', 'shadow-soft', 'shadow-pop'] as const).map(
          (s) => (
            <div
              key={s}
              className={`grid h-28 place-items-center rounded-xl border bg-card ${s}`}
            >
              <span className="font-mono text-xs text-muted-foreground">{s}</span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
