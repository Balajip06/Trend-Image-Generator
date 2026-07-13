'use client'

import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function DataExportButton() {
  const onExport = () => {
    toast('Preparing your data…', {
      description: 'Your download will start in a moment.',
    })
    // Hard nav so the browser handles `content-disposition: attachment`
    // and saves the file. No client state to manage.
    window.location.href = '/api/me/export'
  }
  return (
    <Button type="button" variant="outline" size="lg" onClick={onExport} className="rounded-full">
      <Download className="size-4" />
      Download my data
    </Button>
  )
}
