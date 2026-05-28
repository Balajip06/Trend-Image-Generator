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

const ISO_NOW = '2026-05-28T12:00:00.000Z'

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

// 5 brand-gradient SVG placeholders. Cycled across 15 trends — picks the same
// thumb for the same slug deterministically.
const THUMBS = [
  '/mock/sample-1.svg',
  '/mock/sample-2.svg',
  '/mock/sample-3.svg',
  '/mock/sample-4.svg',
  '/mock/sample-5.svg',
] as const

interface Seed {
  slug: string
  title: string
  description: string
  model: 'nano-banana' | 'nano-banana-pro'
  aspect: PublicTrend['aspect_ratio']
  faq: Array<{ question: string; answer: string }>
}

const SEEDS: Seed[] = [
  {
    slug: 'ghibli-portrait',
    title: 'Ghibli-style portrait',
    description: 'Turn your selfie into a soft, painterly Studio Ghibli still.',
    model: 'nano-banana-pro',
    aspect: '1:1',
    faq: [
      { question: 'Is it free?', answer: 'You get 5 free generations per week. Buy credits if you need more.' },
      { question: 'Does it work on iPhone?', answer: 'Yes — all modern mobile + desktop browsers are supported.' },
      { question: 'What photos work best?', answer: 'Clear front-facing photos with even lighting work best.' },
    ],
  },
  {
    slug: 'pixar-3d-character',
    title: 'Pixar 3D character',
    description: 'Reimagine yourself as a Pixar-style 3D animated character.',
    model: 'nano-banana-pro',
    aspect: '1:1',
    faq: [
      { question: 'How long does it take?', answer: 'About 20–40 seconds per generation.' },
      { question: 'Can I use it commercially?', answer: 'Outputs are yours but Pixar likeness is for personal use only.' },
    ],
  },
  {
    slug: 'anime-portrait',
    title: 'Anime-style portrait',
    description: 'Bold-line anime portrait inspired by modern shōnen art.',
    model: 'nano-banana-pro',
    aspect: '3:4',
    faq: [
      { question: 'Will it look like me?', answer: 'Yes — the AI preserves facial features while applying the anime style.' },
    ],
  },
  {
    slug: 'vintage-polaroid',
    title: 'Vintage Polaroid',
    description: 'Faded, sun-soaked 1970s Polaroid aesthetic with a white border.',
    model: 'nano-banana',
    aspect: '1:1',
    faq: [
      { question: 'Does it add the Polaroid border?', answer: 'Yes — the white frame is part of the output.' },
    ],
  },
  {
    slug: 'marble-statue',
    title: 'Greek marble statue',
    description: 'You, sculpted in classical Greek marble. Dramatic lighting included.',
    model: 'nano-banana-pro',
    aspect: '3:4',
    faq: [
      { question: 'Does it work on full body shots?', answer: 'Yes, though headshots tend to look the most dramatic.' },
    ],
  },
  {
    slug: 'stranger-things-poster',
    title: 'Stranger Things 80s poster',
    description: 'Cinematic Netflix-style poster — neon red & teal, fog, retro grain, Upside Down vibes.',
    model: 'nano-banana-pro',
    aspect: '3:4',
    faq: [
      { question: 'Does it preserve my face?', answer: 'Yes — facial features are kept while lighting/color/atmosphere are restyled.' },
      { question: 'Why 3:4?', answer: 'Matches classic VHS / movie-poster framing and reads well as a story or print.' },
    ],
  },
  {
    slug: 'action-figure-box',
    title: 'Action figure in box',
    description: 'You as a collectible toy, packaged in a branded blister card — Barbie / Funko vibes.',
    model: 'nano-banana-pro',
    aspect: '3:4',
    faq: [
      { question: 'Can I change the accessories?', answer: 'V1 ships fixed accessories (laptop, coffee, headphones). Custom in a later release.' },
      { question: 'Random cardback?', answer: 'Yes — the model picks color/style each run. Generate a few to find one you like.' },
    ],
  },
  {
    slug: 'funko-pop-figure',
    title: 'Funko Pop figure',
    description: 'You as the chunky-headed, dot-eyed vinyl collectible — clean studio backdrop.',
    model: 'nano-banana-pro',
    aspect: '1:1',
    faq: [
      { question: 'Does it keep my hairstyle?', answer: 'The prompt preserves hairstyle + clothing palette so the Pop is recognizable.' },
      { question: 'Can I put it in a box?', answer: 'Use the "Action figure in box" trend — it ships the figure already packaged.' },
    ],
  },
  {
    slug: 'lego-minifigure',
    title: 'LEGO minifigure',
    description: 'You as a smooth yellow LEGO minifigure with printed face + accessories.',
    model: 'nano-banana-pro',
    aspect: '1:1',
    faq: [
      { question: 'Why yellow skin?', answer: 'Classic LEGO minifigures use the iconic yellow face. Custom skin tones in a later release.' },
    ],
  },
  {
    slug: 'wes-anderson-pastel',
    title: 'Wes Anderson pastel',
    description: 'Centered symmetrical composition, pastel palette, dollhouse lighting — Grand Budapest aesthetic.',
    model: 'nano-banana-pro',
    aspect: '16:9',
    faq: [
      { question: 'Why 16:9?', answer: 'Matches Wes Anderson’s anamorphic cinematic framing and reads as a film still on social.' },
    ],
  },
  {
    slug: 'renaissance-oil-painting',
    title: 'Renaissance oil painting',
    description: 'You as a 16th-century noble — chiaroscuro lighting, brushwork, gold-leaf frame.',
    model: 'nano-banana-pro',
    aspect: '3:4',
    faq: [
      { question: 'Can I pick the era?', answer: 'V1 uses High Renaissance (~1500s). Baroque + Rococo land in a future release.' },
    ],
  },
  {
    // NOTE: Seed inserted slug as `south-park-cartoon`. Keep mock in sync with
    // what's actually in Supabase, not the trend-list checklist label.
    slug: 'south-park-cartoon',
    title: 'South Park character',
    description: 'You as a paper-cutout South Park kid — round head, beady eyes, mountain backdrop.',
    model: 'nano-banana',
    aspect: '1:1',
    faq: [
      { question: 'Why the quick model?', answer: "South Park's flat low-detail style doesn't need Pro. Quick is faster and cheaper." },
    ],
  },
  {
    slug: 'cyberpunk-neon',
    title: 'Cyberpunk neon portrait',
    description: 'You as a Night City netrunner — chrome implants, rain-slick neon streets, holographic ads.',
    model: 'nano-banana-pro',
    aspect: '3:4',
    faq: [
      { question: 'How prominent are the implants?', answer: 'Subtle by default — small chrome plates + temple chip. Re-roll for variations.' },
    ],
  },
  {
    slug: 'y2k-digicam-flash',
    title: 'Y2K digicam flash',
    description: '2006 nightlife aesthetic — harsh on-camera flash, glowy skin, low-res digicam grain.',
    model: 'nano-banana',
    aspect: '1:1',
    faq: [
      { question: 'Does it work on group photos?', answer: 'Yes — multi-person photos read as classic 2000s party shots. Faces stay recognizable.' },
    ],
  },
  {
    slug: 'linkedin-headshot',
    title: 'LinkedIn headshot',
    description: 'Professional studio headshot from any selfie — soft key light, neutral backdrop, business attire.',
    model: 'nano-banana-pro',
    aspect: '1:1',
    faq: [
      { question: 'Will it look fake?', answer: 'Natural skin texture + authentic studio lighting. Most outputs pass for real headshots.' },
      { question: 'Keep my own outfit?', answer: 'V1 swaps to business attire. Outfit-preserving mode is on the roadmap.' },
    ],
  },
]

function hexId(seed: number): string {
  // Deterministic v4-shape UUID per index so RLS-style id lookups stay stable.
  const stamp = seed.toString(16).padStart(2, '0')
  return `${stamp}${stamp}${stamp}${stamp}-${stamp}${stamp}-4${stamp}${stamp.slice(0, 1)}-8${stamp}${stamp.slice(0, 1)}-${stamp}${stamp}${stamp}${stamp}${stamp}${stamp}`
}

export const MOCK_TRENDS: PublicTrend[] = SEEDS.map((seed, idx) => {
  const thumb = THUMBS[idx % THUMBS.length]
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
    updated_at: ISO_NOW,
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
