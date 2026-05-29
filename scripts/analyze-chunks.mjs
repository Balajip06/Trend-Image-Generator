// Bundle-analysis helper. Reads route stats produced by Turbopack analyzer
// (run `pnpm next build --experimental-analyze` first) and prints:
//   1. Per-route First Load JS table sorted descending.
//   2. Top heaviest routes' unique chunks (delta vs the /_not-found baseline)
//      so you can see what code is actually unique to each route.
//
// See docs/BUNDLE_ANALYSIS.md for guidance on what to investigate.
import fs from 'node:fs'
import path from 'node:path'

const statsPath = './.next/diagnostics/route-bundle-stats.json'
if (!fs.existsSync(statsPath)) {
  console.error('Missing', statsPath, '- run `pnpm next build --experimental-analyze` first.')
  process.exit(1)
}

const data = JSON.parse(fs.readFileSync(statsPath, 'utf8'))

console.log('# Per-route First Load JS (uncompressed)\n')
data
  .slice()
  .sort((a, b) => b.firstLoadUncompressedJsBytes - a.firstLoadUncompressedJsBytes)
  .forEach((r) => {
    console.log(
      r.route.padEnd(40),
      (r.firstLoadUncompressedJsBytes / 1024).toFixed(1) + ' KB',
      '(' + r.firstLoadChunkPaths.length + ' chunks)',
    )
  })

const chunkSize = {}
data.forEach((r) =>
  r.firstLoadChunkPaths.forEach((p) => {
    try {
      chunkSize[p] = fs.statSync(p).size
    } catch {}
  }),
)
const notFound = data.find((r) => r.route === '/_not-found')
const baseline = new Set(notFound?.firstLoadChunkPaths ?? [])

console.log('\n# Unique chunks per top-6 heaviest routes\n')
data
  .slice()
  .sort((a, b) => b.firstLoadUncompressedJsBytes - a.firstLoadUncompressedJsBytes)
  .slice(0, 6)
  .forEach((r) => {
    const unique = r.firstLoadChunkPaths.filter((p) => !baseline.has(p))
    const uniqueBytes = unique.reduce((s, p) => s + (chunkSize[p] || 0), 0)
    console.log('---', r.route, 'unique:', (uniqueBytes / 1024).toFixed(1) + ' KB')
    unique
      .map((p) => ({ p, sz: chunkSize[p] || 0 }))
      .sort((a, b) => b.sz - a.sz)
      .forEach(({ p, sz }) => console.log('  ', (sz / 1024).toFixed(1) + 'KB', path.basename(p)))
  })
