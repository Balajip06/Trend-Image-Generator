'use client'

import { Plus, Upload } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { prepareImageForUpload } from '@/lib/utils/image'

// Eval references persist and get re-run on later "Test" clicks, so sign for a
// long window rather than the short TTL used for one-shot customer generations.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365 // 1 year

interface EvalUploadFormProps {
  /** Server action bound to this trend id; expects label / image_url / demographic_tag. */
  addAction: (formData: FormData) => Promise<void>
}

/**
 * Uploads a test photo to the private `uploads` bucket (under the admin's own
 * folder, satisfying the uploads_self_insert RLS policy), signs it, and hands
 * the storage URL to addEvalInput. A storage URL is required because runEval →
 * collectImageInputs enforces an SSRF guard that only accepts uploads-bucket
 * URLs — an arbitrary pasted URL would be rejected at test time.
 */
export function EvalUploadForm({ addAction }: EvalUploadFormProps) {
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const file = fd.get('file')
    const label = String(fd.get('label') ?? '').trim()
    const tag = String(fd.get('demographic_tag') ?? '').trim()

    if (!(file instanceof File) || file.size === 0) {
      toast.error('Choose a photo to test with.')
      return
    }
    if (!label) {
      toast.error('Add a short label (e.g. “child”, “glasses”).')
      return
    }

    setBusy(true)
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        toast.error('Session expired — reload and try again.')
        setBusy(false)
        return
      }

      const prepared = await prepareImageForUpload(file)
      const path = `${user.id}/eval/${crypto.randomUUID()}.jpg`
      const { error: uploadErr } = await supabase.storage
        .from('uploads')
        .upload(path, prepared.file, { contentType: 'image/jpeg', upsert: true })
      if (uploadErr) throw new Error(uploadErr.message)

      const { data: signed, error: signErr } = await supabase.storage
        .from('uploads')
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
      if (signErr || !signed?.signedUrl) {
        throw new Error(signErr?.message ?? 'could not sign upload')
      }

      const out = new FormData()
      out.set('label', label)
      out.set('image_url', signed.signedUrl)
      if (tag) out.set('demographic_tag', tag)
      // addEvalInput revalidates + redirects back to the eval page on success.
      await addAction(out)
      formRef.current?.reset()
      setFileName(null)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    >
      <div className="flex flex-col gap-1.5 sm:col-span-1">
        <Label
          htmlFor="eval-file"
          className="text-muted-foreground text-[11px] tracking-wide uppercase"
        >
          Test photo
        </Label>
        <label
          htmlFor="eval-file"
          className="border-border/60 bg-background hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors"
        >
          <Upload className="size-4 shrink-0" />
          <span className="truncate">{fileName ?? 'Choose a photo…'}</span>
        </label>
        <input
          id="eval-file"
          name="file"
          type="file"
          accept="image/*"
          required
          className="sr-only"
          onChange={(e) => setFileName(e.currentTarget.files?.[0]?.name ?? null)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor="eval-label"
          className="text-muted-foreground text-[11px] tracking-wide uppercase"
        >
          Label
        </Label>
        <Input id="eval-label" name="label" required maxLength={80} placeholder="child / glasses" />
        <Input
          name="demographic_tag"
          maxLength={40}
          placeholder="tag (optional)"
          className="mt-1"
        />
      </div>
      <Button type="submit" disabled={busy} size="default">
        <Plus className="size-4" /> {busy ? 'Uploading…' : 'Add'}
      </Button>
    </form>
  )
}
