'use client'

import { Loader2, Upload } from 'lucide-react'
import { useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { prepareImageForUpload } from '@/lib/utils/image'
import { uploadTrendImage } from './actions'

interface ImageUrlFieldProps {
  id: string
  name: string
  defaultValue?: string | null
}

/**
 * URL text input + an upload button that fills it in. Kept as one text
 * input under the hood (not a separate hidden field) so `readTrendForm`'s
 * existing `formData.get(name)` + `z.string().url()` validation needs no
 * changes — uploading just writes the resulting public URL into the input.
 */
export function ImageUrlField({ id, name, defaultValue }: ImageUrlFieldProps) {
  const [value, setValue] = useState(defaultValue ?? '')
  const [busy, setBusy] = useState(false)

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setBusy(true)
    try {
      const prepared = await prepareImageForUpload(file)
      const fd = new FormData()
      fd.set('file', prepared.file)
      const result = await uploadTrendImage(fd)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setValue(result.url)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        name={name}
        type="url"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="https://…"
        className="flex-1"
      />
      <label
        htmlFor={`${id}-file`}
        className="border-input bg-background hover:bg-muted/50 flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm transition-colors"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        <span className="hidden sm:inline">{busy ? 'Uploading…' : 'Upload'}</span>
        <input
          id={`${id}-file`}
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={busy}
          onChange={onFileChange}
        />
      </label>
    </div>
  )
}
