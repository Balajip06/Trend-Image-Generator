import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync } from 'fs'
import { join, basename, extname } from 'path'

const SUPABASE_URL = 'https://rkvhpiienwdeawqkrdxm.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = 'thumbnails'
const THUMBS_DIR = './public/thumbnails'

if (!SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY env var')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// Ensure bucket exists (public)
const { error: bucketErr } = await supabase.storage.createBucket(BUCKET, {
  public: true,
  allowedMimeTypes: ['image/webp'],
})
if (bucketErr && !bucketErr.message.includes('already exists')) {
  console.error('Bucket error:', bucketErr.message)
  process.exit(1)
}

const files = readdirSync(THUMBS_DIR).filter((f) => f.endsWith('.webp'))
const updates = []

for (const file of files) {
  const slug = basename(file, extname(file))
  const path = join(THUMBS_DIR, file)
  const data = readFileSync(path)

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(file, data, { contentType: 'image/webp', upsert: true })

  if (uploadErr) {
    console.error(`✗ ${slug}: ${uploadErr.message}`)
    continue
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(file)
  updates.push({ slug, url: publicUrl })
  console.log(`✓ ${slug} → ${publicUrl}`)
}

// Batch UPDATE all rows
for (const { slug, url } of updates) {
  const { error: updateErr } = await supabase
    .from('trends')
    .update({ thumbnail_url: url })
    .eq('slug', slug)

  if (updateErr) {
    console.error(`✗ DB update ${slug}: ${updateErr.message}`)
  } else {
    console.log(`  DB ✓ ${slug}`)
  }
}

console.log(`\nDone. ${updates.length}/15 thumbnails uploaded + DB updated.`)
