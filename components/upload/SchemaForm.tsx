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
  /**
   * When set, renders a full-form overlay with a spinner + this label —
   * covers the multi-step upload → generate window that the disabled submit
   * button alone doesn't communicate. Undefined = no overlay.
   */
  phaseLabel?: string
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
  phaseLabel,
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
    [onSubmit, state.files, state.values, validate]
  )

  return (
    <form onSubmit={handleSubmit} className={cn('relative flex flex-col gap-6', className)}>
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

      {phaseLabel && (
        <div
          role="status"
          aria-live="polite"
          className="bg-background/70 absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl text-center backdrop-blur-sm"
        >
          <div className="border-muted-foreground/30 border-t-foreground size-10 animate-spin rounded-full border-4" />
          <p className="text-sm font-medium">{phaseLabel}</p>
        </div>
      )}
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
          {field.hint && <span className="text-muted-foreground text-xs">{field.hint}</span>}
        </Label>
        <Input
          id={field.name}
          maxLength={field.max_length}
          value={typeof values[field.name] === 'string' ? (values[field.name] as string) : ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onText(field.name, e.target.value)}
          className="h-12 rounded-xl"
        />
        {error && <span className="text-destructive text-xs">{error}</span>}
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
        {field.hint && <span className="text-muted-foreground text-xs">{field.hint}</span>}
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
      {error && <span className="text-destructive text-xs">{error}</span>}
    </div>
  )
}

interface ImageFieldProps {
  field: Extract<TrendField, { type: 'image' }>
  files: File[]
  error?: string
  onFiles: (files: File[]) => void
}

function ImageField(props: ImageFieldProps) {
  if (props.field.max_count > 1) {
    return <MultiSlotImageField {...props} />
  }
  return <SingleImageField {...props} />
}

function SingleImageField({ field, files, error, onFiles }: ImageFieldProps) {
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
    [field.max_count, onFiles]
  )

  const removeAt = useCallback(
    (idx: number) => {
      const next = files.filter((_, i) => i !== idx)
      onFiles(next)
    },
    [files, onFiles]
  )

  const inputId = `file-${field.name}`

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId} className="flex items-baseline justify-between">
        <span>
          {field.label}
          {field.required && <span className="text-[var(--brand-grad-1)]"> *</span>}
        </span>
        {field.hint && <span className="text-muted-foreground text-xs">{field.hint}</span>}
      </Label>

      {previews.length > 0 ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {previews.map((src, idx) => (
            <div
              key={src}
              className="group border-border bg-muted relative aspect-square overflow-hidden rounded-2xl border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Preview ${idx + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeAt(idx)}
                aria-label="Remove photo"
                className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
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
              : 'border-border bg-muted/40 hover:border-foreground/30'
          )}
        >
          <div className="bg-gradient-hero shadow-glow-pink grid size-12 place-items-center rounded-full text-white">
            <Upload className="size-5" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Drop a photo, or tap to browse</span>
            <span className="text-muted-foreground text-xs">JPG, PNG, HEIC up to ~20MB</span>
          </div>
        </label>
      )}

      <input
        id={inputId}
        type="file"
        accept="image/*,.heic,.heif"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          if (e.target.files) handleFileList(e.target.files)
        }}
        className="sr-only"
      />

      {error && <span className="text-destructive text-xs">{error}</span>}
    </div>
  )
}

/**
 * Multi-photo upload UI: renders exactly `field.max_count` fixed slots, each
 * with its own hidden file input + preview. Each slot is independent — picking
 * a file in slot 2 doesn't disturb slot 0. Submit gate (in parent `validate()`)
 * requires `>= field.min_count` filled slots.
 *
 * Slots are kept index-aligned to a sparse `(File | null)[]` so removing the
 * middle slot doesn't shift the rest. On submit we collapse to a dense `File[]`
 * for the parent to forward to the upload pipeline.
 */
function MultiSlotImageField({ field, files, error, onFiles }: ImageFieldProps) {
  const max = field.max_count
  // Reconstruct sparse slot array from incoming dense file list. Files that
  // come in via parent (e.g. after a removal) are packed left-to-right. New
  // slot picks from this component always update via `setSlotFile` which keeps
  // the index alignment locally.
  const [slots, setSlots] = useState<(File | null)[]>(() => {
    const arr: (File | null)[] = Array(max).fill(null)
    for (let i = 0; i < Math.min(files.length, max); i++) arr[i] = files[i]
    return arr
  })

  // Sync slots → dense `files` upward. Skips initial mount if external `files`
  // already matches to avoid a needless render loop.
  useEffect(() => {
    const dense = slots.filter((f): f is File => f !== null)
    const sameLength = dense.length === files.length
    const sameRefs = sameLength && dense.every((f, i) => f === files[i])
    if (!sameRefs) onFiles(dense)
    // We intentionally exclude `files` + `onFiles` from deps: this effect is
    // the slots→parent direction. Including them would loop because
    // `onFiles` updates `files`, which then re-runs this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots])

  const [previews, setPreviews] = useState<(string | null)[]>(() => Array(max).fill(null))

  useEffect(() => {
    const urls = slots.map((f) => (f ? URL.createObjectURL(f) : null))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviews(urls)
    return () => {
      urls.forEach((u) => {
        if (u) URL.revokeObjectURL(u)
      })
    }
  }, [slots])

  const setSlotFile = useCallback((idx: number, file: File | null) => {
    setSlots((s) => {
      const next = [...s]
      next[idx] = file
      return next
    })
  }, [])

  const filledCount = slots.filter(Boolean).length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <Label className="flex items-baseline gap-2">
          <span>
            {field.label}
            {field.required && <span className="text-[var(--brand-grad-1)]"> *</span>}
          </span>
          <span className="text-muted-foreground text-xs">
            {filledCount}/{max}
            {field.min_count > 1 ? ` · min ${field.min_count}` : ''}
          </span>
        </Label>
        {field.hint && <span className="text-muted-foreground text-xs">{field.hint}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
        {slots.map((file, idx) => (
          <SlotCell
            key={`${field.name}-${idx}`}
            fieldName={field.name}
            idx={idx}
            file={file}
            preview={previews[idx] ?? null}
            onPick={(f) => setSlotFile(idx, f)}
            onClear={() => setSlotFile(idx, null)}
          />
        ))}
      </div>

      {error && <span className="text-destructive text-xs">{error}</span>}
    </div>
  )
}

interface SlotCellProps {
  fieldName: string
  idx: number
  file: File | null
  preview: string | null
  onPick: (file: File) => void
  onClear: () => void
}

function SlotCell({ fieldName, idx, file, preview, onPick, onClear }: SlotCellProps) {
  const inputId = `file-${fieldName}-${idx}`
  const [dragOver, setDragOver] = useState(false)

  const handlePick = useCallback(
    (incoming: FileList | File[]) => {
      const first = Array.from(incoming)[0]
      if (first) onPick(first)
    },
    [onPick]
  )

  return (
    <div className="relative w-full sm:w-32">
      <input
        id={inputId}
        type="file"
        accept="image/*,.heic,.heif"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          if (e.target.files?.length) handlePick(e.target.files)
          // Reset so picking the same file twice in a row still fires onChange.
          e.target.value = ''
        }}
        className="sr-only"
      />
      {file && preview ? (
        <div className="group border-border/60 bg-muted relative aspect-square w-full overflow-hidden rounded-2xl border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt={`Photo ${idx + 1}`} className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={onClear}
            aria-label={`Remove photo ${idx + 1}`}
            className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
          >
            <X className="size-3.5" />
          </button>
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
            if (e.dataTransfer.files?.length) handlePick(e.dataTransfer.files)
          }}
          className={cn(
            'text-muted-foreground grid aspect-square w-full cursor-pointer place-items-center rounded-2xl border-2 border-dashed transition-colors',
            dragOver
              ? 'text-foreground border-[var(--brand-grad-1)] bg-[var(--brand-grad-1)]/5'
              : 'border-border/60 bg-muted/40 hover:border-foreground/30 hover:text-foreground'
          )}
        >
          <div className="flex flex-col items-center gap-1 text-xs font-medium">
            <ImagePlus className="size-5" />
            Add photo
          </div>
        </label>
      )}
    </div>
  )
}
