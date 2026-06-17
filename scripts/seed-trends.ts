/**
 * Inserts a starter set of viral-trend rows into the linked Supabase project
 * using the service-role client. Bypasses RLS. Safe to re-run — slug is the
 * conflict target and existing rows are left untouched.
 *
 * Run: pnpm dlx tsx scripts/seed-trends.ts
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import type { TrendInput } from '../lib/trends/input-schema'

config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

interface FAQ {
  question: string
  answer: string
}

interface SeedTrend {
  slug: string
  title: string
  description: string
  prompt_template: string
  model: 'nano-banana' | 'nano-banana-pro'
  aspect_ratio: '1:1' | '3:4' | '16:9' | '9:16'
  input_schema: TrendInput
  display_order: number
  seo_title: string
  seo_description: string
  faq: FAQ[]
  is_active: boolean
  eval_status: 'passed'
}

const singlePhoto: TrendInput = {
  fields: [
    {
      type: 'image',
      name: 'user_photo',
      label: 'Your photo',
      required: true,
      min_count: 1,
      max_count: 1,
      hint: 'Clear front-facing photo with even lighting works best.',
    },
  ],
}

const trends: SeedTrend[] = [
  {
    slug: 'ghibli-portrait',
    title: 'Ghibli-style portrait',
    description: 'Turn your selfie into a soft, painterly Studio Ghibli still.',
    prompt_template:
      "A Studio Ghibli-style hand-painted portrait of the subject in the reference photo, rendered in the visual language of Hayao Miyazaki and Studio Ghibli circa Spirited Away and Howl's Moving Castle. Soft watercolor textures, gentle gradient backgrounds in pastel sky tones, painterly cloud detail, warm late-afternoon golden-hour lighting, subtle blush on the cheeks, expressive eyes with characteristic Ghibli highlights and catchlights, slightly simplified facial geometry while preserving the subject's exact age, ethnicity, hair color, hairstyle, and individual features. Square 1:1 composition, head and shoulders framed, centered. No text, no logos, no watermarks, no extra people in frame.",
    model: 'nano-banana-pro',
    aspect_ratio: '1:1',
    input_schema: singlePhoto,
    display_order: 9,
    seo_title: 'Ghibli-style portrait generator — turn your photo into a Studio Ghibli still',
    seo_description:
      'Free Ghibli-style portrait generator. Upload a photo and get a soft, painterly result in seconds.',
    faq: [
      {
        question: 'Is it free?',
        answer: 'You get 5 free generations per week. Buy credits if you need more.',
      },
      {
        question: 'Does it work on iPhone?',
        answer: 'Yes — all modern mobile + desktop browsers are supported.',
      },
      {
        question: 'What photos work best?',
        answer:
          'Clear front-facing photos with even lighting work best. Group shots vary in quality.',
      },
    ],
    is_active: true,
    eval_status: 'passed',
  },
  {
    slug: 'pixar-3d-character',
    title: 'Pixar 3D character',
    description: 'Reimagine yourself as a Pixar-style 3D animated character.',
    prompt_template:
      "A Pixar Animation Studios 3D character portrait of the subject in the reference photo, rendered in the modern Pixar production style of Soul, Turning Red, and Inside Out 2. Subsurface-scattering skin shader, soft cinematic key light at 45 degrees with warm fill from camera-right, slightly oversized expressive eyes with proper iris detail and catchlights, soft volumetric hair with strand-level detail, friendly approachable proportions with a hint of facial caricature, clean studio backdrop with a subtle radial gradient. Preserve the subject's exact ethnicity, age range, hair color and hairstyle, eyewear if present, and any distinctive features. Photoreal 3D render quality. Square 1:1 framing, head-and-shoulders composition. No text, no logos, no captions.",
    model: 'nano-banana-pro',
    aspect_ratio: '1:1',
    input_schema: singlePhoto,
    display_order: 2,
    seo_title: 'Pixar character generator — turn yourself into a Pixar 3D animation',
    seo_description:
      'Get a Pixar-style 3D character of yourself. Upload one photo and the AI does the rest.',
    faq: [
      { question: 'How long does it take?', answer: 'About 20-40 seconds per generation.' },
      {
        question: 'Can I use it commercially?',
        answer: 'Outputs are yours but stylistic likeness to Pixar IP is for personal use only.',
      },
    ],
    is_active: true,
    eval_status: 'passed',
  },
  {
    slug: 'anime-portrait',
    title: 'Anime-style portrait',
    description: 'Bold-line anime portrait inspired by modern shōnen art.',
    prompt_template:
      "A high-quality anime portrait of the subject in the reference photo, executed in the modern shōnen production style of MAPPA, Wit Studio, and Ufotable (think Jujutsu Kaisen, Attack on Titan, Demon Slayer). Crisp confident black ink linework, vibrant cel-shaded color blocks with two-tone shadow rendering, dramatic side lighting from camera-left, dynamic wind-blown hair with motion lines, characteristic anime eyes with multiple highlight points and detailed irises, slight idealization of jaw and cheekbones while preserving the subject's exact ethnicity, age range, hairstyle, and hair color. Portrait 3:4 framing, head and upper torso visible, with a subtle action-implied background (motion lines, soft bokeh, or atmospheric perspective). No text, no logos, no subtitles.",
    model: 'nano-banana-pro',
    aspect_ratio: '3:4',
    input_schema: singlePhoto,
    display_order: 3,
    seo_title: 'Anime portrait generator — turn your photo into anime art',
    seo_description:
      'Upload a photo, get an anime-style portrait in seconds. Sharp lines, vivid colors, free to try.',
    faq: [
      {
        question: 'Will it look like me?',
        answer: 'Yes — the AI preserves facial features while applying the anime style.',
      },
    ],
    is_active: true,
    eval_status: 'passed',
  },
  {
    slug: 'vintage-polaroid',
    title: 'Vintage Polaroid',
    description: 'Faded, sun-soaked 1970s Polaroid aesthetic with a white border.',
    prompt_template:
      "A genuine-looking 1970s Polaroid SX-70 photograph of the subject in the reference photo. Square format with the classic Polaroid white border (thicker bottom edge for the iconic developer tab). Slightly faded, low-saturation colors with the warm pink-and-yellow color cast typical of expired Polaroid film. Soft inherent film grain. Mild orange-red light leak bleeding from the top-right corner. Slightly out-of-focus shallow depth-of-field as if shot at f/4.5 on the integrated SX-70 lens. Subject framed candidly, naturally lit by window light or warm tungsten room lighting. Preserve the subject's exact facial features, age, ethnicity, hairstyle, and clothing color palette. The image must look like it was actually shot in 1976, not a digital filter applied today. No modern artifacts, no text overlay, no watermarks.",
    model: 'nano-banana',
    aspect_ratio: '1:1',
    input_schema: singlePhoto,
    display_order: 4,
    seo_title: 'Vintage Polaroid generator — turn any photo into a 70s Polaroid',
    seo_description:
      'Faded colors, film grain, classic Polaroid white border. Upload any photo to try it.',
    faq: [
      {
        question: 'Does it add the Polaroid border?',
        answer: 'Yes — the white frame is part of the output.',
      },
    ],
    is_active: true,
    eval_status: 'passed',
  },
  {
    slug: 'marble-statue',
    title: 'Greek marble statue',
    description: 'You, sculpted in classical Greek marble. Dramatic lighting included.',
    prompt_template:
      "A photoreal classical Greek marble statue of the subject in the reference photo, sculpted in the Hellenistic tradition (think Pergamon Altar, Venus de Milo, the Apollo Belvedere). Pure Carrara white marble with subtle natural veining, visible chisel marks on any draped fabric, faint amber-toned patina in deep recesses suggesting age, micro-cracks suggesting two millennia of museum display. Dramatic single-source side-lighting from the upper-left at 45 degrees, creating deep shadow falloff that emphasizes three-dimensional form. Dark velvet-black gallery background. Portrait 3:4 framing, head and upper torso visible, classical contrapposto if shown below the shoulders. Preserve the subject's exact bone structure, facial proportions, hairstyle (rendered as carved hair in the classical period style), and any distinctive features. Photographic quality, as if shot on a Hasselblad medium format with a single softbox inside the British Museum. No text, no plinth label, no other people in frame.",
    model: 'nano-banana-pro',
    aspect_ratio: '3:4',
    input_schema: singlePhoto,
    display_order: 5,
    seo_title: 'Marble statue generator — turn your photo into a Greek sculpture',
    seo_description:
      'Get an ultra-realistic classical Greek marble statue of yourself. Free to try.',
    faq: [
      {
        question: 'Does it work on full body shots?',
        answer: 'Yes, though headshots tend to look the most dramatic.',
      },
    ],
    is_active: true,
    eval_status: 'passed',
  },
]

async function main() {
  let inserted = 0
  let skipped = 0
  const errors: string[] = []

  for (const trend of trends) {
    const { data, error } = await supabase
      .from('trends')
      .insert(trend)
      .select('id, slug')
      .maybeSingle()

    if (error) {
      if (error.message.includes('duplicate key')) {
        skipped += 1
        console.log(`  skip ${trend.slug} (already exists)`)
      } else {
        errors.push(`${trend.slug}: ${error.message}`)
        console.error(`  FAIL ${trend.slug}: ${error.message}`)
      }
      continue
    }
    inserted += 1
    console.log(`  + ${trend.slug} (${(data as { id: string }).id})`)
  }

  console.log('')
  console.log(`Inserted: ${inserted}`)
  console.log(`Skipped:  ${skipped}`)
  console.log(`Errors:   ${errors.length}`)
  if (errors.length > 0) process.exit(1)
}

void main()
