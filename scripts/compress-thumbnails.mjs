import sharp from 'sharp'
import { readdirSync, mkdirSync } from 'fs'
import { join, basename, extname } from 'path'

const SRC = 'C:/Users/balaj/Downloads/images'
const DEST = './public/thumbnails'
const TARGET_SIZE = 1024

mkdirSync(DEST, { recursive: true })

const files = readdirSync(SRC).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))

for (const file of files) {
  const src = join(SRC, file)
  const name = basename(file, extname(file))
  const dest = join(DEST, `${name}.webp`)

  await sharp(src)
    .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'cover', position: 'center' })
    .webp({ quality: 82 })
    .toFile(dest)

  const { size } = (await import('fs')).statSync(dest)
  console.log(`✓ ${name}.webp — ${Math.round(size / 1024)}KB`)
}

console.log('\nDone. All thumbnails in public/thumbnails/')
