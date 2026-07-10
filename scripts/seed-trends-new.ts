/**
 * Seeds 6 new viral-trend rows (June 2026 batch):
 *   claymation-selfie, barbie-box, pixar-character (already exists — skip),
 *   vintage-magazine-cover, manga-panel, passport-photo
 *
 * Run: pnpm dlx tsx scripts/seed-trends-new.ts
 * Safe to re-run — slug is the conflict target, existing rows are left untouched.
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
  model: 'nano-banana-2' | 'nano-banana-2-lite'
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
    slug: 'claymation-selfie',
    title: 'Claymation selfie',
    description: 'You reimagined as a chunky, handcrafted clay character — Aardman meets Laika.',
    prompt_template:
      "A stop-motion claymation character portrait of the subject in the reference photo, rendered in the handcrafted clay animation style of Aardman (Wallace & Gromit, Shaun the Sheep) crossed with Laika Studios (Coraline, Kubo). Visible clay fingerprint texture on all surfaces, slightly irregular surface sheen consistent with real plasticine under tungsten stage lighting, chunky simplified body proportions, oversized round head with a wide expressive mouth and prominent teeth, small beady eyes with subtle catchlight dots pressed into clay, puffy rounded limbs with no sharp edges, slightly imperfect symmetry as if hand-sculpted. Warm three-point stage lighting casting a soft warm key from upper-left, soft fill from camera-right, subtle rim light. Colour palette: warm terracotta skin tones with bold primary clothing colours. Preserve the subject's hair colour, rough hairstyle, and any distinctive features (glasses, beard, freckles) translated into clay textures. Square 1:1 composition, head and upper torso, plain canvas-grey backdrop. No text, no watermarks.",
    model: 'nano-banana-2-lite',
    aspect_ratio: '1:1',
    input_schema: singlePhoto,
    display_order: 16,
    seo_title: 'Claymation selfie generator — turn your photo into a clay character',
    seo_description:
      'Upload a photo and get a chunky handcrafted claymation version of yourself. Aardman-style, free to try.',
    faq: [
      {
        question: 'Will it look like me?',
        answer:
          'Yes — hair colour, hairstyle, glasses, and distinctive features are all translated into clay texture.',
      },
      {
        question: 'Is Pro model needed?',
        answer:
          'Yes — the clay texture and lighting complexity need the Pro model to look convincingly handmade.',
      },
      {
        question: 'Can I use group photos?',
        answer:
          'Single subjects give the best results. Group shots work but only the main subject gets styled.',
      },
    ],
    is_active: true,
    eval_status: 'passed',
  },
  {
    slug: 'barbie-box',
    title: 'Barbie doll box',
    description:
      'You as a Barbie doll packaged in a glossy pink branded box — complete with career label.',
    prompt_template:
      "A photorealistic product shot of a Barbie-style fashion doll packaged inside a glossy pink branded toy box, styled after Mattel's classic Barbie packaging circa 2023 (Barbie The Movie era). The doll inside the box is a stylised version of the subject in the reference photo: smooth porcelain-quality skin, wide bright eyes with long lashes, high-gloss lips in coral or fuchsia, perfect symmetrical features, and a fashionable outfit matching the subject's clothing colour palette. The box: bright hot-pink gloss cardboard with a clear acetate window panel on the front, gold foil Barbie logo at the top, a custom career or personality label at the bottom in bold white sans-serif font (e.g. 'Creative Director Barbie', 'CEO Barbie', 'Artist Barbie' — choose a fitting career based on the subject's appearance), pink tissue paper padding behind the doll, pink twist-ties holding the doll in position. Product photography lighting: soft studio overhead with sharp catch-light on the acetate window. Portrait 3:4 framing, full box in frame with slight perspective tilt for visual interest. No copyright text, no Mattel trademark, no real brand name — only the stylised visual aesthetic. No extra people.",
    model: 'nano-banana-2-lite',
    aspect_ratio: '3:4',
    input_schema: singlePhoto,
    display_order: 17,
    seo_title: 'Barbie box generator — put yourself in a Barbie doll box',
    seo_description:
      'Turn your photo into a Barbie-style doll in a glossy pink box. Viral trend, free to try.',
    faq: [
      {
        question: 'Does it add a career label?',
        answer: 'Yes — the AI picks a fitting career label based on your appearance and style.',
      },
      {
        question: 'Will it preserve my face?',
        answer:
          'Facial features are idealised in the Barbie doll style while keeping you recognisable.',
      },
      {
        question: 'Why 3:4?',
        answer: 'Portrait framing fits the full toy box and reads perfectly as a story or print.',
      },
    ],
    is_active: true,
    eval_status: 'passed',
  },
  {
    slug: 'vintage-magazine-cover',
    title: '70s magazine cover',
    description:
      'You on the cover of a glossy 1970s lifestyle magazine — bold typography, warm film grain.',
    prompt_template:
      "A photorealistic vintage magazine cover featuring the subject in the reference photo, styled as a high-glamour 1970s American lifestyle or fashion magazine (think Vogue, Cosmopolitan, or Time circa 1972–1978). Editorial photography quality: warm Kodachrome film colour science, slightly overexposed highlights with creamy skin tones, shallow-depth-of-field 85mm portrait lens look, subtle film halation on light sources, visible fine grain consistent with Kodak Tri-X pushed to ISO 800. Art direction: bold condensed magazine masthead typography at the top in an era-accurate serif or slab-serif (placeholder text 'GLOSS' or 'VIVA' in white with a drop shadow), two or three cover-line headlines in yellow or white along the left edge (e.g. 'How to Own Every Room', 'The Style Issue', 'Summer's Biggest Trends'), barcode-free lower-right corner. Colour palette: earthy warm tones — burnt orange, mustard yellow, avocado green clothing and background. The subject is positioned centre-frame, looking directly at camera with a confident editorial gaze, head-and-shoulders to three-quarter framing. Preserve the subject's exact facial features, ethnicity, hair colour, and hairstyle. The image should look genuinely printed on slightly aged glossy magazine stock. Portrait 3:4. No real brand names, no real logos.",
    model: 'nano-banana-2-lite',
    aspect_ratio: '3:4',
    input_schema: singlePhoto,
    display_order: 18,
    seo_title: '70s magazine cover generator — put yourself on a vintage magazine',
    seo_description:
      'Get a retro 1970s magazine cover with your face. Kodachrome colours, bold headlines, free to try.',
    faq: [
      {
        question: 'Does it add real text?',
        answer: 'The AI generates placeholder magazine-style headlines — not real brand names.',
      },
      {
        question: 'Which decade?',
        answer: 'V1 is tuned for 1970–1978. Other decades coming in a future release.',
      },
      {
        question: 'Works on group photos?',
        answer: 'Single subjects work best for the editorial cover look.',
      },
    ],
    is_active: true,
    eval_status: 'passed',
  },
  {
    slug: 'manga-panel',
    title: 'Manga panel',
    description:
      'You as a black-and-white manga panel — crisp ink lines, screen-tone shading, dramatic energy.',
    prompt_template:
      "A high-quality black-and-white manga panel featuring the subject in the reference photo, drawn in the classic shōnen manga tradition of Tite Kubo (Bleach), Masashi Kishimoto (Naruto), and Eiichiro Oda (One Piece). Pure black ink on white, zero colour, zero grey wash — only hard black fills and Zip-a-tone dot-screen halftone patterns for shadow and texture. Linework: confident varying-weight brushwork, thick outlines on silhouette edges, thin secondary detail lines, speed-line (kakusen) burst background emanating from the subject to suggest dramatic intensity or movement. Shading: traditional circular dot-screen halftone (N-screen 45°) on shadows and hair, solid black fills in deepest shadow areas. Facial style: slightly exaggerated manga proportions — large dramatic eyes with multiple pupil highlight points and thick lash lines, sharp defined jaw and cheekbone structure, anime-style simplified nose. Preserve the subject's gender presentation, approximate age range, hairstyle silhouette, hair volume, and any distinctive features (glasses rendered as crisp ink lines, beard as hatching). Panel composition: a bold ¾-angle portrait with visible shoulder and upper torso, a thin rectangular panel border, and a single expressive Japanese-style sound-effect 'SFX' mark (e.g. ドン or ザ) faintly behind the subject. Square 1:1. No text captions, no speech bubbles, no colour.",
    model: 'nano-banana-2-lite',
    aspect_ratio: '1:1',
    input_schema: singlePhoto,
    display_order: 19,
    seo_title: 'Manga panel generator — turn your photo into black-and-white manga art',
    seo_description:
      'Get a crisp manga panel of yourself — ink lines, halftone shading, dramatic energy. Free to try.',
    faq: [
      {
        question: 'Is it black and white only?',
        answer: 'Yes — authentic manga uses pure ink and dot-screen halftone, no colour.',
      },
      {
        question: 'Which manga style?',
        answer: 'Tuned for modern shōnen (Bleach / Naruto era). Other styles in future releases.',
      },
      {
        question: 'Will it keep my features?',
        answer: 'Hairstyle, glasses, and distinctive features are all preserved in ink-line form.',
      },
    ],
    is_active: true,
    eval_status: 'passed',
  },
  {
    slug: 'ai-passport-photo',
    title: 'AI passport photo',
    description:
      'A hyper-realistic official-style ID portrait — neutral backdrop, perfect exposure, print-ready.',
    prompt_template:
      'A hyper-realistic official government-style identification passport photograph of the subject in the reference photo, matching ICAO Document 9303 photographic specifications. Plain white or off-white seamless backdrop with zero shadow falloff, subjects face occupying 70-80% of frame height, centered, head slightly below vertical midpoint, neutral facial expression with mouth closed, both eyes open and clearly visible, no hair covering the face. Lighting: high-key flat lighting with a gentle soft-box at camera position plus two white-card fill reflectors eliminating all background shadow, resulting in a pure white background with no vignette. Skin: natural, accurate colour rendering with no beautification, no skin-smoothing, no saturation boost — the goal is authentic documentary accuracy, not glamour. Any glasses that appear in the source photo are removed (ICAO 2022 rules). Preserve exact ethnicity, skin tone, natural hair colour and style (neatly presented), and all facial features with no idealisation. Photographic quality: medium-format studio strobe look. Square 1:1, tight head-and-shoulders crop with a small amount of space above the head. No timestamp, no studio logo, no visible serial number, no country name, no borders — clean documentation-style photograph only.',
    model: 'nano-banana-2-lite',
    aspect_ratio: '1:1',
    input_schema: singlePhoto,
    display_order: 20,
    seo_title: 'AI passport photo generator — studio-quality ID photo from any selfie',
    seo_description:
      'Get a hyper-realistic passport-style photo from any selfie. White backdrop, perfect lighting, free to try.',
    faq: [
      {
        question: 'Is it officially valid?',
        answer:
          'AI-generated photos may not be accepted by all governments. Check your local rules before submitting.',
      },
      {
        question: 'Does it remove glasses?',
        answer: 'Yes — ICAO 2022 rules prohibit glasses, so the AI removes them automatically.',
      },
      {
        question: 'What makes a good source photo?',
        answer: 'Front-facing, neutral expression, even lighting, no hat. Any decent selfie works.',
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
