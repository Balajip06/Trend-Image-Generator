import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils/cn'

export interface TrendFormValues {
  slug?: string
  title?: string
  description?: string | null
  prompt_template?: string
  model?: 'nano-banana' | 'nano-banana-pro' | 'gpt-image'
  model_pinned?: boolean
  aspect_ratio?: '1:1' | '3:4' | '16:9' | '9:16'
  display_order?: number
  thumbnail_url?: string | null
  sample_before_url?: string | null
  sample_after_url?: string | null
  seo_title?: string | null
  seo_description?: string | null
  input_schema?: unknown
  faq?: unknown
  goes_live_at?: string | null
  is_featured?: boolean
  auto_deactivate_disabled?: boolean
  auto_deactivate_threshold?: number
  share_caption_template?: string | null
}

// Native <select> styled to match shadcn Input. Server actions read formData
// directly, so we avoid Radix Select's controlled-component requirement.
const selectClasses = cn(
  'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none',
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30'
)

const textareaClasses = cn(
  'w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none',
  'placeholder:text-muted-foreground',
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
  'dark:bg-input/30'
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

interface SectionProps {
  initial: TrendFormValues
}

export function IdentitySection({ initial }: SectionProps) {
  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="text-base">Identity</CardTitle>
        <CardDescription>How the trend appears across the catalogue and SSR pages.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" htmlFor="title">
          <Input
            id="title"
            name="title"
            required
            maxLength={200}
            defaultValue={initial.title ?? ''}
          />
        </Field>
        <Field label="Slug" htmlFor="slug" hint="lowercase kebab-case">
          <Input
            id="slug"
            name="slug"
            required
            pattern="^[a-z][a-z0-9\-]*$"
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
  )
}

export function GenerationSection({ initial }: SectionProps) {
  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="text-base">Generation</CardTitle>
        <CardDescription>
          Prompt template uses{' '}
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">{`{{field_name}}`}</code> for
          schema substitution.
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
              <option value="nano-banana-pro">nano-banana-pro (Gemini — quality)</option>
              <option value="nano-banana">nano-banana (Gemini — fast)</option>
              <option value="gpt-image">gpt-image (OpenAI)</option>
            </select>
          </Field>
          <Field label="Model source" htmlFor="model_pinned">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                id="model_pinned"
                name="model_pinned"
                value="true"
                defaultChecked={initial.model_pinned ?? true}
              />
              Pin model (uncheck to follow global default)
            </label>
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
  )
}

export function MediaSection({ initial }: SectionProps) {
  return (
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
  )
}

export function SeoSection({ initial }: SectionProps) {
  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="text-base">SEO</CardTitle>
        <CardDescription>
          Used by the SSR trend page, Open Graph metadata, and the Share sheet.
        </CardDescription>
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
        <Field
          label="Share caption template"
          htmlFor="share_caption_template"
          hint="Supports {trend_title} and {site_url}"
          className="sm:col-span-2"
        >
          <textarea
            id="share_caption_template"
            name="share_caption_template"
            rows={4}
            maxLength={300}
            defaultValue={initial.share_caption_template ?? ''}
            placeholder="Made my {trend_title} on Trendly — {site_url}"
            className={cn(textareaClasses, 'min-h-24')}
          />
          <p className="text-muted-foreground/80 text-[11px]">
            Pre-filled when users tap Share. Supports{' '}
            <code className="bg-muted rounded px-1 py-0.5">{`{trend_title}`}</code> and{' '}
            <code className="bg-muted rounded px-1 py-0.5">{`{site_url}`}</code> substitution. Leave
            blank for default &ldquo;Made my X on Trendly&rdquo;.
          </p>
        </Field>
      </CardContent>
    </Card>
  )
}

// Converts an ISO timestamp to the value format expected by <input type="datetime-local">
// ("YYYY-MM-DDTHH:mm"). Returns empty string when null/invalid so the field renders blank.
function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  // Use local time so the value matches what the admin will type back in.
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function LifecycleSection({ initial }: SectionProps) {
  const threshold = initial.auto_deactivate_threshold ?? 5
  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="text-base">Lifecycle</CardTitle>
        <CardDescription>
          Scheduling, featured placement, and cold-trend auto-deactivate behaviour.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Go live at"
          htmlFor="goes_live_at"
          hint="Leave blank to publish immediately when active."
          className="sm:col-span-2"
        >
          <Input
            id="goes_live_at"
            name="goes_live_at"
            type="datetime-local"
            defaultValue={isoToDatetimeLocal(initial.goes_live_at)}
          />
        </Field>

        <CheckboxField
          id="is_featured"
          name="is_featured"
          label="Featured"
          hint="Floats to top of catalogue + exempt from auto-deactivate."
          defaultChecked={initial.is_featured ?? false}
        />

        <CheckboxField
          id="auto_deactivate_disabled"
          name="auto_deactivate_disabled"
          label="Disable auto-deactivate"
          hint="When on, this trend won't be cold-removed if engagement drops."
          defaultChecked={initial.auto_deactivate_disabled ?? false}
        />

        <Field
          label="Auto-deactivate threshold"
          htmlFor="auto_deactivate_threshold"
          hint="Auto-removed if completed gens in the last 7 days fall below this."
          className="sm:col-span-2"
        >
          <Input
            id="auto_deactivate_threshold"
            name="auto_deactivate_threshold"
            type="number"
            min={1}
            max={100}
            defaultValue={threshold}
          />
        </Field>
      </CardContent>
    </Card>
  )
}

interface CheckboxFieldProps {
  id: string
  name: string
  label: string
  hint?: string
  defaultChecked?: boolean
}

function CheckboxField({ id, name, label, hint, defaultChecked }: CheckboxFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="border-input hover:bg-muted/30 flex cursor-pointer items-start gap-3 rounded-lg border bg-transparent px-3 py-2.5 text-sm shadow-xs transition-colors"
      >
        <input
          id={id}
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          className="border-input mt-0.5 size-4 rounded accent-[var(--brand-grad-1,#ec4899)]"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-foreground font-medium">{label}</span>
          {hint && <span className="text-muted-foreground text-[11px]">{hint}</span>}
        </span>
      </label>
    </div>
  )
}

export function SchemaFaqSection({ initial }: SectionProps) {
  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="text-base">Schema &amp; FAQ</CardTitle>
        <CardDescription>
          JSON only. See{' '}
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            lib/trends/input-schema.ts
          </code>
          .
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
        <Label
          htmlFor={htmlFor}
          className="text-muted-foreground text-[11px] tracking-wide uppercase"
        >
          {label}
        </Label>
        {hint && <span className="text-muted-foreground/70 text-[11px]">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
