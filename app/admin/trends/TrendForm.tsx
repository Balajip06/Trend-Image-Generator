import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils/cn'

interface TrendFormValues {
  slug?: string
  title?: string
  description?: string | null
  prompt_template?: string
  model?: 'nano-banana' | 'nano-banana-pro'
  aspect_ratio?: '1:1' | '3:4' | '16:9' | '9:16'
  display_order?: number
  thumbnail_url?: string | null
  sample_before_url?: string | null
  sample_after_url?: string | null
  seo_title?: string | null
  seo_description?: string | null
  input_schema?: unknown
  faq?: unknown
}

interface TrendFormProps {
  action: (formData: FormData) => Promise<void>
  initial?: TrendFormValues
  submitLabel: string
  banner?: ReactNode
  extraActions?: ReactNode
}

// Native <select> styled to match shadcn Input. Server actions read formData
// directly, so we avoid Radix Select's controlled-component requirement.
const selectClasses = cn(
  'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none',
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
)

const textareaClasses = cn(
  'w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none',
  'placeholder:text-muted-foreground',
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
  'dark:bg-input/30',
)

function jsonString(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

export function TrendForm({ action, initial = {}, submitLabel, banner, extraActions }: TrendFormProps) {
  return (
    <form action={action} className="flex flex-col gap-6">
      {banner}

      <Card className="gap-5">
        <CardHeader>
          <CardTitle className="text-base">Identity</CardTitle>
          <CardDescription>How the trend appears across the catalogue and SSR pages.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="title">
            <Input id="title" name="title" required maxLength={200} defaultValue={initial.title ?? ''} />
          </Field>
          <Field label="Slug" htmlFor="slug" hint="lowercase kebab-case">
            <Input
              id="slug"
              name="slug"
              required
              pattern="^[a-z][a-z0-9-]*$"
              maxLength={120}
              defaultValue={initial.slug ?? ''}
            />
          </Field>
          <Field label="Description" htmlFor="description" className="sm:col-span-2">
            <textarea
              id="description"
              name="description"
              maxLength={1000}
              defaultValue={initial.description ?? ''}
              className={cn(textareaClasses, 'min-h-20')}
            />
          </Field>
        </CardContent>
      </Card>

      <Card className="gap-5">
        <CardHeader>
          <CardTitle className="text-base">Generation</CardTitle>
          <CardDescription>
            Prompt template uses <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{`{{field_name}}`}</code>{' '}
            for schema substitution.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="Prompt template" htmlFor="prompt_template">
            <textarea
              id="prompt_template"
              name="prompt_template"
              required
              minLength={10}
              maxLength={2000}
              defaultValue={initial.prompt_template ?? ''}
              className={cn(textareaClasses, 'min-h-32 font-mono text-xs')}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Model" htmlFor="model">
              <select
                id="model"
                name="model"
                defaultValue={initial.model ?? 'nano-banana-pro'}
                className={selectClasses}
              >
                <option value="nano-banana-pro">nano-banana-pro</option>
                <option value="nano-banana">nano-banana (quick)</option>
              </select>
            </Field>
            <Field label="Aspect ratio" htmlFor="aspect_ratio">
              <select
                id="aspect_ratio"
                name="aspect_ratio"
                defaultValue={initial.aspect_ratio ?? '1:1'}
                className={selectClasses}
              >
                <option value="1:1">1:1</option>
                <option value="3:4">3:4</option>
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
              </select>
            </Field>
            <Field label="Display order" htmlFor="display_order">
              <Input
                id="display_order"
                type="number"
                name="display_order"
                min={0}
                max={9999}
                defaultValue={initial.display_order ?? 0}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-5">
        <CardHeader>
          <CardTitle className="text-base">Media</CardTitle>
          <CardDescription>Thumbnail + before/after sample URLs (publicly hosted).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Thumbnail URL" htmlFor="thumbnail_url">
            <Input
              id="thumbnail_url"
              name="thumbnail_url"
              type="url"
              defaultValue={initial.thumbnail_url ?? ''}
            />
          </Field>
          <Field label="Sample before URL" htmlFor="sample_before_url">
            <Input
              id="sample_before_url"
              name="sample_before_url"
              type="url"
              defaultValue={initial.sample_before_url ?? ''}
            />
          </Field>
          <Field label="Sample after URL" htmlFor="sample_after_url">
            <Input
              id="sample_after_url"
              name="sample_after_url"
              type="url"
              defaultValue={initial.sample_after_url ?? ''}
            />
          </Field>
        </CardContent>
      </Card>

      <Card className="gap-5">
        <CardHeader>
          <CardTitle className="text-base">SEO</CardTitle>
          <CardDescription>Used by the SSR trend page + Open Graph metadata.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="SEO title" htmlFor="seo_title">
            <Input
              id="seo_title"
              name="seo_title"
              maxLength={200}
              defaultValue={initial.seo_title ?? ''}
            />
          </Field>
          <Field label="SEO description" htmlFor="seo_description">
            <Input
              id="seo_description"
              name="seo_description"
              maxLength={300}
              defaultValue={initial.seo_description ?? ''}
            />
          </Field>
        </CardContent>
      </Card>

      <Card className="gap-5">
        <CardHeader>
          <CardTitle className="text-base">Schema &amp; FAQ</CardTitle>
          <CardDescription>
            JSON only. See <code className="rounded bg-muted px-1 py-0.5 text-[11px]">lib/trends/input-schema.ts</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="Input schema" htmlFor="input_schema">
            <textarea
              id="input_schema"
              name="input_schema"
              defaultValue={jsonString(initial.input_schema)}
              placeholder='{"fields":[{"type":"image","name":"user_photo","label":"Your photo","required":true,"min_count":1,"max_count":1}]}'
              className={cn(textareaClasses, 'min-h-32 font-mono text-xs')}
            />
          </Field>
          <Field label="FAQ" htmlFor="faq">
            <textarea
              id="faq"
              name="faq"
              defaultValue={jsonString(initial.faq)}
              placeholder='[{"question":"Is it free?","answer":"5 free per week."}]'
              className={cn(textareaClasses, 'min-h-32 font-mono text-xs')}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-card/95 px-4 py-3 shadow-soft backdrop-blur">
        <Button type="submit" size="lg">
          {submitLabel}
        </Button>
        {extraActions}
      </div>
    </form>
  )
}

interface FieldProps {
  label: string
  htmlFor: string
  hint?: string
  className?: string
  children: ReactNode
}

function Field({ label, htmlFor, hint, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between">
        <Label htmlFor={htmlFor} className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
        {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
