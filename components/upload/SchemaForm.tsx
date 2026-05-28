'use client'

import { ImagePlus, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { GradientButton } from '@/components/brand/GradientButton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TrendField, TrendInput } from '@/lib/trends/input-schema'
import type { TrendInputValues } from '@/lib/trends/interpolate'
import { cn } from '@/lib/utils/cn'

interface SchemaFormProps {
  schema: TrendInput
  onSubmit: (payload: {
    values: TrendInputValues
    files: Record<string, File[]>
  }) => void | Promise<void>
  submitting?: boolean
  ctaLabel?: string
  className?: string
}

type LocalState = {
  values: TrendInputValues
  files: Record<string, File[]>
  fieldErrors: Record<string, string | undefined>
}

const emptyState: LocalState = { values: {}, files: {}, fieldErrors: {} }

export function SchemaForm({
  schema,
  onSubmit,
  submitting = false,
  ctaLabel = 'Generate',
  className,
}: SchemaFormProps) {
  const [state, setState] = useState<LocalState>(emptyState)

  const setText = useCallback((name: string, value: string) => {
    setState((s) => ({
      ...s,
      values: { ...s.values, [name]: value },
      fieldErrors: { ...s.fieldErrors, [name]: undefined },
    }))
  }, [])

  const setFiles = useCallback((name: string, files: File[]) => {
    setState((s) => ({
      ...s,
      files: { ...s.files, [name]: files },
      fieldErrors: { ...s.fieldErrors, [name]: undefined },
    }))
  }, [])

  const validate = useCallback((): boolean => {
    const fieldErrors: Record<string, string> = {}
    for (const field of schema.fields) {
      if (field.type === 'image') {
        const files = state.files[field.name] ?? []
        if (field.required && files.length < field.min_count) {
          fieldErrors[field.name] =
            `Upload at least ${field.min_count} photo${field.min_count === 1 ? '' : 's'}`
        }
        if (files.length > field.max_count) {
          fieldErrors[field.name] = `Up to ${field.max_count} allowed`
        }
      } else {
        const value = state.values[field.name]
        if (field.required && (value === undefined || value === '')) {
          fieldErrors[field.name] = `${field.label} is required`
        }
      }
    }
    setState((s) => ({ ...s, fieldErrors }))
    const ok = Object.keys(fieldErrors).length === 0
    if (!ok) {
      const first = Object.values(fieldErrors)[0]
      if (first) toast.error(first)
    }
    return ok
  }, [schema, state.files, state.values])

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      if (!validate()) return
      await onSubmit({ values: state.values, files: state.files })
    },
    [onSubmit, state.files, state.values, validate],
  )

  return (
    <form onSubmit={handleSubmit} className={cn('flex flex-col gap-6', className)}>
      {schema.fields.map((field) => (
        <FieldRenderer
          key={field.name}
          field={field}
          values={state.values}
          files={state.files}
          error={state.fieldErrors[field.name]}
          onText={setText}
          onFiles={setFiles}
        />
      ))}
      <GradientButton type="submit" disabled={submitting} size="lg" className="w-full">
        {submitting ? (
          <span className="inline-flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-white" />
            Generating…
          </span>
        ) : (
          ctaLabel
        )}
      </GradientButton>
    </form>
  )
}

interface FieldRendererProps {
  field: TrendField
  values: TrendInputValues
  files: Record<string, File[]>
  error?: string
  onText: (name: string, value: string) => void
  onFiles: (name: string, files: File[]) => void
}

function FieldRenderer({ field, values, files, error, onText, onFiles }: FieldRendererProps) {
  if (field.type === 'image') {
    return (
      <ImageField
        field={field}
        files={files[field.name] ?? []}
        error={error}
        onFiles={(list) => onFiles(field.name, list)}
      />
    )
  }
  if (field.type === 'text') {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={field.name} className="flex items-baseline justify-between">
          <span>
            {field.label}
            {field.required && <span className="text-[var(--brand-grad-1)]"> *</span>}
          </span>
          {field.hint && <span className="text-xs text-muted-foreground">{field.hint}</span>}
        </Label>
        <Input
          id={field.name}
          maxLength={field.max_length}
          value={typeof values[field.name] === 'string' ? (values[field.name] as string) : ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onText(field.name, e.target.value)}
          className="h-12 rounded-xl"
        />
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    )
  }
  // select
  const current =
    typeof values[field.name] === 'string' ? (values[field.name] as string) : (field.default ?? '')
  return (
    <div className="flex flex-col gap-2">
      <Label className="flex items-baseline justify-between">
        <span>
          {field.label}
          {field.required && <span className="text-[var(--brand-grad-1)]"> *</span>}
        </span>
        {field.hint && <span className="text-xs text-muted-foreground">{field.hint}</span>}
      </Label>
      <Select value={current} onValueChange={(v) => onText(field.name, v)}>
        <SelectTrigger className="h-12 rounded-xl">
          <SelectValue placeholder="Pick one…" />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

interface ImageFieldProps {
  field: Extract<TrendField, { type: 'image' }>
  files: File[]
  error?: string
  onFiles: (files: File[]) => void
}

function ImageField({ field, files, error, onFiles }: ImageFieldProps) {
  const [dragOver, setDragOver] = useState(false)
  const [previews, setPreviews] = useState<string[]>([])

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f))
    // Sync state with externally-created blob URLs; revoke on unmount to free
    // memory. The setState must happen in the effect because the URLs are
    // created here and consumed by the JSX below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviews(urls)
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [files])

  const handleFileList = useCallback(
    (incoming: FileList | File[]) => {
      const arr = Array.from(incoming).slice(0, field.max_count)
      onFiles(arr)
    },
    [field.max_count, onFiles],
  )

  const removeAt = useCallback(
    (idx: number) => {
      const next = files.filter((_, i) => i !== idx)
      onFiles(next)
    },
    [files, onFiles],
  )

  const inputId = `file-${field.name}`

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId} className="flex items-baseline justify-between">
        <span>
          {field.label}
          {field.required && <span className="text-[var(--brand-grad-1)]"> *</span>}
        </span>
        {field.hint && <span className="text-xs text-muted-foreground">{field.hint}</span>}
      </Label>

      {previews.length > 0 ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {previews.map((src, idx) => (
            <div
              key={src}
              className="group relative aspect-square overflow-hidden rounded-2xl border border-border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Preview ${idx + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeAt(idx)}
                aria-label="Remove photo"
                className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          {previews.length < field.max_count && (
            <label
              htmlFor={inputId}
              className="grid aspect-square cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-[var(--brand-grad-1)] hover:text-foreground"
            >
              <div className="flex flex-col items-center gap-1 text-xs font-medium">
                <ImagePlus className="size-5" />
                Add more
              </div>
            </label>
          )}
        </div>
      ) : (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            if (e.dataTransfer.files?.length) handleFileList(e.dataTransfer.files)
          }}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors',
            dragOver
              ? 'border-[var(--brand-grad-1)] bg-[var(--brand-grad-1)]/5'
              : 'border-border bg-muted/40 hover:border-foreground/30',
          )}
        >
          <div className="grid size-12 place-items-center rounded-full bg-gradient-hero text-white shadow-glow-pink">
            <Upload className="size-5" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Drop a photo, or tap to browse</span>
            <span className="text-xs text-muted-foreground">
              JPG, PNG, HEIC up to ~20MB
              {field.max_count > 1 ? ` • up to ${field.max_count} photos` : ''}
            </span>
          </div>
        </label>
      )}

      <input
        id={inputId}
        type="file"
        accept="image/*,.heic,.heif"
        multiple={field.max_count > 1}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          if (e.target.files) handleFileList(e.target.files)
        }}
        className="sr-only"
      />

      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
