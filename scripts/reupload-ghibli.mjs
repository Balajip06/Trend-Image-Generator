import sharp from 'sharp'
import { readFileSync, statSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://rkvhpiienwdeawqkrdxm.supabase.co'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(SUPABASE_URL, KEY)

await sharp('C:/Users/balaj/Downloads/images/gibli.png')
  .resize(1024, 1024, { fit: 'cover', position: 'center' })
  .webp({ quality: 82 })
  .toFile('./public/thumbnails/ghibli-portrait.webp')

const { size } = statSync('./public/thumbnails/ghibli-portrait.webp')
console.log('compressed:', Math.round(size / 1024) + 'KB')

const data = readFileSync('./public/thumbnails/ghibli-portrait.webp')
const { error } = await supabase.storage
  .from('thumbnails')
  .upload('ghibli-portrait.webp', data, { contentType: 'image/webp', upsert: true })

if (error) {
  console.error('err:', error.message)
  process.exit(1)
}
console.log('uploaded ok')
