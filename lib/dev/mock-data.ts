/**
 * MOCK_TRENDS dev-mode fixtures.
 *
 * Gated on `process.env.MOCK_TRENDS === 'true'`. When enabled, repository
 * + auth-gated RSC pages short-circuit to in-memory fixtures so the consumer
 * flow can be screenshot-tested without Supabase Docker, Gemini, or any other
 * external dependency.
 *
 * The 15 trend rows mirror the real seed scripts (scripts/seed-trends.ts +
 * scripts/seed-trends-more.ts) so MOCK mode shows the same surface a logged-in
 * user would see against the live Supabase project.
 *
 * Production behavior unchanged when flag absent.
 */
import type { PublicTrend } from '@/lib/trends/repository'
import type { TrendInput } from '@/lib/trends/input-schema'

export const MOCK_TRENDS_ENABLED = process.env.MOCK_TRENDS === 'true'

/**
 * Whether demo/mock fallbacks may stand in for empty real data. Allowed in any
 * non-production environment so local + preview layouts read meaningfully, and
 * NEVER in production — there, empty tables render honest empty states instead
 * of seed numbers (otherwise every admin page shows the same demo figures).
 *
 * Set DISABLE_DEMO_FALLBACK=true locally to force honest empty states even in
 * dev — useful while verifying the admin dashboard against real (possibly
 * still-empty) Supabase tables instead of seed figures.
 */
export const MOCKS_ALLOWED =
  process.env.NODE_ENV !== 'production' && process.env.DISABLE_DEMO_FALLBACK !== 'true'

const ISO_NOW = '2026-05-28T12:00:00.000Z'
// `activated_at` mix: first 3 mock trends are NEW (within 14 days of ISO_NOW),
// rest are older. Drives the NEW-badge logic on the studio rail.
const ISO_RECENT = '2026-05-20T12:00:00.000Z' // ~8d before ISO_NOW
const ISO_OLD = '2026-04-01T12:00:00.000Z' // ~57d before ISO_NOW

// Distinct, monotonically-decreasing created_at per mock row so idx 0 is the
// newest. Mirrors prod ordering (created_at desc) without relying on Date.now.
const MOCK_CREATED_BASE_MS = Date.parse(ISO_NOW)
const DAY_MS = 24 * 60 * 60 * 1000
function mockCreatedAt(idx: number): string {
  return new Date(MOCK_CREATED_BASE_MS - idx * DAY_MS).toISOString()
}

export const MOCK_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'demo@trendly.dev',
}

export const MOCK_PROFILE = {
  email: MOCK_USER.email,
  credits_balance: 42,
  free_used_this_week: 2,
  referral_code: 'a1b2c3d4e5f6',
  bonus_credits_earned: 10,
}

const SINGLE_PHOTO: TrendInput = {
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

const THUMBS: Record<string, string> = {
  'ghibli-portrait': '/thumbnails/ghibli-portrait.webp',
  'pixar-3d-character': '/thumbnails/pixar-3d-character.webp',
  'anime-portrait': '/thumbnails/anime-portrait.webp',
  'vintage-polaroid': '/thumbnails/vintage-polaroid.webp',
  'marble-statue': '/thumbnails/marble-statue.webp',
  'stranger-things-poster': '/thumbnails/stranger-things-poster.webp',
  'action-figure-box': '/thumbnails/action-figure-box.webp',
  'funko-pop-figure': '/thumbnails/funko-pop-figure.webp',
  'lego-minifigure': '/thumbnails/lego-minifigure.webp',
  'wes-anderson-pastel': '/thumbnails/wes-anderson-pastel.webp',
  'renaissance-oil-painting': '/thumbnails/renaissance-oil-painting.webp',
  'south-park-cartoon': '/thumbnails/south-park-cartoon.webp',
  'cyberpunk-neon': '/thumbnails/cyberpunk-neon.webp',
  'y2k-digicam-flash': '/thumbnails/y2k-digicam-flash.webp',
  'linkedin-headshot': '/thumbnails/linkedin-headshot.webp',
  'claymation-selfie': '/thumbnails/claymation-selfie.webp',
  'barbie-box': '/thumbnails/barbie-box.webp',
  'vintage-magazine-cover': '/thumbnails/vintage-magazine-cover.webp',
  'manga-panel': '/thumbnails/manga-panel.webp',
  'ai-passport-photo': '/thumbnails/ai-passport-photo.webp',
}

interface Seed {
  slug: string
  title: string
  description: string
  model: 'nano-banana-2' | 'nano-banana-2-lite'
  aspect: PublicTrend['aspect_ratio']
  faq: Array<{ question: string; answer: string }>
}

const SEEDS: Seed[] = [
  {
    slug: 'ghibli-portrait',
    title: 'Ghibli-style portrait',
    description: 'Turn your selfie into a soft, painterly Studio Ghibli still.',
    model: 'nano-banana-2-lite',
    aspect: '1:1',
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
        answer: 'Clear front-facing photos with even lighting work best.',
      },
    ],
  },
  {
    slug: 'pixar-3d-character',
    title: 'Pixar 3D character',
    description: 'Reimagine yourself as a Pixar-style 3D animated character.',
    model: 'nano-banana-2-lite',
    aspect: '1:1',
    faq: [
      { question: 'How long does it take?', answer: 'About 20–40 seconds per generation.' },
      {
        question: 'Can I use it commercially?',
        answer: 'Outputs are yours but Pixar likeness is for personal use only.',
      },
    ],
  },
  {
    slug: 'anime-portrait',
    title: 'Anime-style portrait',
    description: 'Bold-line anime portrait inspired by modern shōnen art.',
    model: 'nano-banana-2-lite',
    aspect: '3:4',
    faq: [
      {
        question: 'Will it look like me?',
        answer: 'Yes — the AI preserves facial features while applying the anime style.',
      },
    ],
  },
  {
    slug: 'vintage-polaroid',
    title: 'Vintage Polaroid',
    description: 'Faded, sun-soaked 1970s Polaroid aesthetic with a white border.',
    model: 'nano-banana-2',
    aspect: '1:1',
    faq: [
      {
        question: 'Does it add the Polaroid border?',
        answer: 'Yes — the white frame is part of the output.',
      },
    ],
  },
  {
    slug: 'marble-statue',
    title: 'Greek marble statue',
    description: 'You, sculpted in classical Greek marble. Dramatic lighting included.',
    model: 'nano-banana-2-lite',
    aspect: '3:4',
    faq: [
      {
        question: 'Does it work on full body shots?',
        answer: 'Yes, though headshots tend to look the most dramatic.',
      },
    ],
  },
  {
    slug: 'stranger-things-poster',
    title: 'Stranger Things 80s poster',
    description:
      'Cinematic Netflix-style poster — neon red & teal, fog, retro grain, Upside Down vibes.',
    model: 'nano-banana-2-lite',
    aspect: '3:4',
    faq: [
      {
        question: 'Does it preserve my face?',
        answer: 'Yes — facial features are kept while lighting/color/atmosphere are restyled.',
      },
      {
        question: 'Why 3:4?',
        answer: 'Matches classic VHS / movie-poster framing and reads well as a story or print.',
      },
    ],
  },
  {
    slug: 'action-figure-box',
    title: 'Action figure in box',
    description:
      'You as a collectible toy, packaged in a branded blister card — Barbie / Funko vibes.',
    model: 'nano-banana-2-lite',
    aspect: '3:4',
    faq: [
      {
        question: 'Can I change the accessories?',
        answer:
          'V1 ships fixed accessories (laptop, coffee, headphones). Custom in a later release.',
      },
      {
        question: 'Random cardback?',
        answer: 'Yes — the model picks color/style each run. Generate a few to find one you like.',
      },
    ],
  },
  {
    slug: 'funko-pop-figure',
    title: 'Funko Pop figure',
    description: 'You as the chunky-headed, dot-eyed vinyl collectible — clean studio backdrop.',
    model: 'nano-banana-2-lite',
    aspect: '1:1',
    faq: [
      {
        question: 'Does it keep my hairstyle?',
        answer: 'The prompt preserves hairstyle + clothing palette so the Pop is recognizable.',
      },
      {
        question: 'Can I put it in a box?',
        answer: 'Use the "Action figure in box" trend — it ships the figure already packaged.',
      },
    ],
  },
  {
    slug: 'lego-minifigure',
    title: 'LEGO minifigure',
    description: 'You as a smooth yellow LEGO minifigure with printed face + accessories.',
    model: 'nano-banana-2-lite',
    aspect: '1:1',
    faq: [
      {
        question: 'Why yellow skin?',
        answer:
          'Classic LEGO minifigures use the iconic yellow face. Custom skin tones in a later release.',
      },
    ],
  },
  {
    slug: 'wes-anderson-pastel',
    title: 'Wes Anderson pastel',
    description:
      'Centered symmetrical composition, pastel palette, dollhouse lighting — Grand Budapest aesthetic.',
    model: 'nano-banana-2-lite',
    aspect: '16:9',
    faq: [
      {
        question: 'Why 16:9?',
        answer:
          'Matches Wes Anderson’s anamorphic cinematic framing and reads as a film still on social.',
      },
    ],
  },
  {
    slug: 'renaissance-oil-painting',
    title: 'Renaissance oil painting',
    description: 'You as a 16th-century noble — chiaroscuro lighting, brushwork, gold-leaf frame.',
    model: 'nano-banana-2-lite',
    aspect: '3:4',
    faq: [
      {
        question: 'Can I pick the era?',
        answer: 'V1 uses High Renaissance (~1500s). Baroque + Rococo land in a future release.',
      },
    ],
  },
  {
    // NOTE: Seed inserted slug as `south-park-cartoon`. Keep mock in sync with
    // what's actually in Supabase, not the trend-list checklist label.
    slug: 'south-park-cartoon',
    title: 'South Park character',
    description:
      'You as a paper-cutout South Park kid — round head, beady eyes, mountain backdrop.',
    model: 'nano-banana-2',
    aspect: '1:1',
    faq: [
      {
        question: 'Why the quick model?',
        answer: "South Park's flat low-detail style doesn't need Pro. Quick is faster and cheaper.",
      },
    ],
  },
  {
    slug: 'cyberpunk-neon',
    title: 'Cyberpunk neon portrait',
    description:
      'You as a Night City netrunner — chrome implants, rain-slick neon streets, holographic ads.',
    model: 'nano-banana-2-lite',
    aspect: '3:4',
    faq: [
      {
        question: 'How prominent are the implants?',
        answer: 'Subtle by default — small chrome plates + temple chip. Re-roll for variations.',
      },
    ],
  },
  {
    slug: 'y2k-digicam-flash',
    title: 'Y2K digicam flash',
    description:
      '2006 nightlife aesthetic — harsh on-camera flash, glowy skin, low-res digicam grain.',
    model: 'nano-banana-2',
    aspect: '1:1',
    faq: [
      {
        question: 'Does it work on group photos?',
        answer:
          'Yes — multi-person photos read as classic 2000s party shots. Faces stay recognizable.',
      },
    ],
  },
  {
    slug: 'linkedin-headshot',
    title: 'LinkedIn headshot',
    description:
      'Professional studio headshot from any selfie — soft key light, neutral backdrop, business attire.',
    model: 'nano-banana-2-lite',
    aspect: '1:1',
    faq: [
      {
        question: 'Will it look fake?',
        answer:
          'Natural skin texture + authentic studio lighting. Most outputs pass for real headshots.',
      },
      {
        question: 'Keep my own outfit?',
        answer: 'V1 swaps to business attire. Outfit-preserving mode is on the roadmap.',
      },
    ],
  },
  {
    slug: 'claymation-selfie',
    title: 'Claymation selfie',
    description: 'You reimagined as a chunky, handcrafted clay character — Aardman meets Laika.',
    model: 'nano-banana-2-lite',
    aspect: '1:1',
    faq: [
      {
        question: 'Will it look like me?',
        answer:
          'Yes — hair colour, hairstyle, glasses, and distinctive features are translated into clay texture.',
      },
      {
        question: 'Can I use group photos?',
        answer: 'Single subjects give the best results.',
      },
    ],
  },
  {
    slug: 'barbie-box',
    title: 'Barbie doll box',
    description:
      'You as a Barbie doll packaged in a glossy pink branded box — complete with career label.',
    model: 'nano-banana-2-lite',
    aspect: '3:4',
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
    ],
  },
  {
    slug: 'vintage-magazine-cover',
    title: '70s magazine cover',
    description:
      'You on the cover of a glossy 1970s lifestyle magazine — bold typography, warm film grain.',
    model: 'nano-banana-2-lite',
    aspect: '3:4',
    faq: [
      {
        question: 'Does it add real text?',
        answer: 'The AI generates placeholder magazine-style headlines — not real brand names.',
      },
      {
        question: 'Which decade?',
        answer: 'V1 is tuned for 1970–1978. Other decades coming in a future release.',
      },
    ],
  },
  {
    slug: 'manga-panel',
    title: 'Manga panel',
    description:
      'You as a black-and-white manga panel — crisp ink lines, screen-tone shading, dramatic energy.',
    model: 'nano-banana-2-lite',
    aspect: '1:1',
    faq: [
      {
        question: 'Is it black and white only?',
        answer: 'Yes — authentic manga uses pure ink and dot-screen halftone, no colour.',
      },
      {
        question: 'Will it keep my features?',
        answer: 'Hairstyle, glasses, and distinctive features are all preserved in ink-line form.',
      },
    ],
  },
  {
    slug: 'ai-passport-photo',
    title: 'AI passport photo',
    description:
      'A hyper-realistic official-style ID portrait — neutral backdrop, perfect exposure, print-ready.',
    model: 'nano-banana-2-lite',
    aspect: '1:1',
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
    ],
  },
]

function hexId(seed: number): string {
  // Deterministic v4-shape UUID per index so RLS-style id lookups stay stable.
  const stamp = seed.toString(16).padStart(2, '0')
  return `${stamp}${stamp}${stamp}${stamp}-${stamp}${stamp}-4${stamp}${stamp.slice(0, 1)}-8${stamp}${stamp.slice(0, 1)}-${stamp}${stamp}${stamp}${stamp}${stamp}${stamp}`
}

export const MOCK_TRENDS: PublicTrend[] = SEEDS.map((seed, idx) => {
  const thumb = THUMBS[seed.slug] ?? '/thumbnails/ghibli-portrait.webp'
  return {
    id: hexId(idx + 1),
    slug: seed.slug,
    title: seed.title,
    description: seed.description,
    thumbnail_url: thumb,
    sample_before_url: null,
    sample_after_url: thumb,
    aspect_ratio: seed.aspect,
    model: seed.model,
    input_schema: SINGLE_PHOTO,
    seo_title: `${seed.title} — Trendly`,
    seo_description: seed.description,
    faq: seed.faq,
    display_order: idx,
    created_at: mockCreatedAt(idx),
    updated_at: ISO_NOW,
    activated_at: idx < 3 ? ISO_RECENT : ISO_OLD,
  }
})

export type MockGenerationStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'failed_retryable'

export interface MockGeneration {
  id: string
  user_id: string
  trend_id: string
  status: MockGenerationStatus
  output_image_url: string | null
  error_message: string | null
  attempts: number
  idempotency_key: string
  created_at: string
  cost_usd: number
  completed_at: string | null
  purge_at: string | null
}

const TREND_GHIBLI = MOCK_TRENDS[0].id
const TREND_PIXAR = MOCK_TRENDS[1].id
const TREND_ANIME = MOCK_TRENDS[2].id

export const MOCK_GENERATIONS: MockGeneration[] = [
  {
    id: 'mock-completed',
    user_id: MOCK_USER.id,
    trend_id: TREND_GHIBLI,
    status: 'completed',
    output_image_url: '/mock/sample-1.svg',
    error_message: null,
    attempts: 1,
    idempotency_key: 'mock-key-completed',
    created_at: ISO_NOW,
    cost_usd: 0.024,
    completed_at: ISO_NOW,
    purge_at: null,
  },
  {
    id: 'mock-processing',
    user_id: MOCK_USER.id,
    trend_id: TREND_GHIBLI,
    status: 'processing',
    output_image_url: null,
    error_message: null,
    attempts: 1,
    idempotency_key: 'mock-key-processing',
    created_at: ISO_NOW,
    cost_usd: 0,
    completed_at: null,
    purge_at: null,
  },
  {
    id: 'mock-retryable',
    user_id: MOCK_USER.id,
    trend_id: TREND_PIXAR,
    status: 'failed_retryable',
    output_image_url: null,
    error_message: 'Transient upstream timeout. Retry available.',
    attempts: 2,
    idempotency_key: 'mock-key-retryable',
    created_at: ISO_NOW,
    cost_usd: 0,
    completed_at: null,
    purge_at: null,
  },
  {
    id: 'mock-failed',
    user_id: MOCK_USER.id,
    trend_id: TREND_ANIME,
    status: 'failed',
    output_image_url: null,
    error_message: 'Output rejected by safety filter. No credit charged.',
    attempts: 3,
    idempotency_key: 'mock-key-failed',
    created_at: ISO_NOW,
    cost_usd: 0,
    completed_at: null,
    purge_at: null,
  },
]

export function findMockGeneration(id: string): MockGeneration | null {
  return MOCK_GENERATIONS.find((g) => g.id === id) ?? null
}

export function findMockTrendById(id: string): PublicTrend | null {
  return MOCK_TRENDS.find((t) => t.id === id) ?? null
}
