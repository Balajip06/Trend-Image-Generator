/**
 * One-off: insert 10 additional viral image trends via service-role client.
 * Idempotent — uses upsert-by-slug (insert ignored on conflict).
 *
 * Researched 2026-05 from current TikTok/Instagram viral chatter +
 * Nano Banana Pro / ChatGPT image trend roundups.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

interface FAQ {
  question: string
  answer: string
}

interface NewTrend {
  slug: string
  title: string
  description: string
  prompt_template: string
  model: 'nano-banana-2' | 'nano-banana-2-lite'
  aspect_ratio: '1:1' | '3:4' | '16:9' | '9:16'
  display_order: number
  seo_title: string
  seo_description: string
  faq: FAQ[]
}

const DEFAULT_SCHEMA = {
  fields: [
    {
      type: 'image' as const,
      name: 'user_photo',
      label: 'Your photo',
      required: true,
      min_count: 1,
      max_count: 1,
      hint: 'Clear front-facing photo works best.',
    },
  ],
}

const trends: NewTrend[] = [
  {
    slug: 'stranger-things-poster',
    title: 'Stranger Things 80s poster',
    description:
      'Cinematic Netflix-style poster — neon red & teal, fog, retro grain, Upside Down vibes.',
    prompt_template:
      "A cinematic Stranger Things key-art poster of the subject in the reference photo, in the visual language of the Netflix series seasons 3-4 and the Kyle Lambert official poster illustrations. Heavy 1980s small-town atmosphere — Hawkins Indiana at dusk. Strong neon-red and teal rim lighting on the subject (signature Stranger Things complementary palette), with deep navy shadows in the negative space. Volumetric ground-level fog rolling across the lower third. Distant red neon sign glow on the horizon. Subtle 35mm film grain and faint VHS scan lines overlaid. Anamorphic lens flares emanating from off-frame upper-right. Slight chromatic aberration on highlights. The subject wears a serious cinematic expression with supernatural Upside Down tension implied — perhaps a tendril of red lightning or wisps of dark mist behind them. Portrait 3:4 movie-poster framing. Preserve the subject's exact face, age, ethnicity, and hairstyle. No text, no title cards, no logos, no named characters from the show.",
    model: 'nano-banana-2-lite',
    aspect_ratio: '3:4',
    display_order: 10,
    seo_title: 'Stranger Things poster generator — turn your photo into an 80s Netflix scene',
    seo_description:
      'Free Stranger Things AI poster generator. Upload a photo and get a cinematic Upside Down style portrait in seconds.',
    faq: [
      {
        question: 'Does it preserve my face?',
        answer:
          'Yes — the prompt instructs the model to keep facial features unchanged while restyling lighting, color, and atmosphere.',
      },
      {
        question: 'Why 3:4 aspect?',
        answer:
          'Matches classic VHS / movie-poster framing and works well as an Instagram story or print.',
      },
      {
        question: 'What photo works best?',
        answer:
          'A clear front-facing photo with the subject occupying most of the frame. Strong original lighting helps.',
      },
    ],
  },
  {
    slug: 'action-figure-box',
    title: 'Action figure in box',
    description:
      'You as a collectible toy, packaged in a branded blister card — Barbie / Star Wars / Funko vibes.',
    prompt_template:
      "An ultra-detailed studio product photograph of a collectible action figure based on the subject in the reference photo, sealed inside a glossy plastic blister-pack mounted to a colorful retail cardback. The figure stands centered inside the bubble in a dynamic neutral pose, wearing a stylized outfit inspired by the subject's actual clothing palette. Accessories arranged beside the figure inside the bubble: a tiny laptop, a coffee cup, and over-ear headphones — each in scale and matching the action-figure plastic look. The cardback features bold contrasting color blocks, a fictional brand wordmark at the top (illegible / blurred so no real IP), a starburst tagline, and a barcode footprint at the bottom. Bright frontal lighting as if on a toy-store shelf, with realistic specular highlights on the curved plastic bubble. Slight handling wear on the cardback edges. Portrait 3:4 framing. Preserve the subject's exact face, age, ethnicity, hairstyle, and clothing color palette. No real brand names, no real IP references, no legible text other than abstract sign-painting marks.",
    model: 'nano-banana-2-lite',
    aspect_ratio: '3:4',
    display_order: 11,
    seo_title: 'AI action figure generator — turn your photo into a boxed collectible',
    seo_description:
      'The viral "Barbie box" trend in one click. Upload a photo and get yourself as a packaged action figure with accessories.',
    faq: [
      {
        question: 'Can I change the accessories?',
        answer:
          'V1 ships fixed accessories (laptop, coffee, headphones). Custom accessories arrive in a later release.',
      },
      {
        question: 'Is the cardback design random?',
        answer:
          'Yes — the model picks the color and style each run. Generate a few to find one you like.',
      },
    ],
  },
  {
    slug: 'funko-pop-figure',
    title: 'Funko Pop figure',
    description: 'You as the chunky-headed, dot-eyed vinyl collectible — clean studio backdrop.',
    prompt_template:
      "A photoreal studio product photograph of an official-style Funko Pop! vinyl figure of the subject in the reference photo. The figure has the characteristic oversized cube head (head-to-body ratio approximately 1:1), a simple matte plastic body, smooth glossy vinyl finish, the iconic round black dot eyes with no whites or pupils, and no rendered mouth or nose (classic Pop style). The hairstyle is sculpted as a separate molded plastic piece in the exact style and color of the subject's actual hair. Clothing is rendered as printed graphics on the simple cylindrical torso, matching the subject's clothing color palette. Optional small accessory in one hand (book, coffee cup, camera, microphone) matching the subject's vibe. Clean light-gray seamless studio backdrop with a subtle drop shadow under the figure. Camera at the figure's eye level, slight three-quarter angle, soft three-point lighting. Square 1:1 framing. Preserve hairstyle, hair color, clothing palette, glasses if present, and any distinctive accessories so the Pop is unambiguously the subject. No Funko text, no display box, no real brand logos.",
    model: 'nano-banana-2-lite',
    aspect_ratio: '1:1',
    display_order: 12,
    seo_title: 'Funko Pop generator — turn your photo into a vinyl figure',
    seo_description:
      'Free AI tool that turns any photo into a Funko Pop style collectible figure with dot eyes.',
    faq: [
      {
        question: 'Does it keep my hairstyle?',
        answer:
          'The prompt instructs the model to preserve hairstyle + clothing palette so the Pop is recognizable as you.',
      },
      {
        question: 'Can I put it in a box?',
        answer:
          'Use the "Action figure in box" trend instead — it ships the figure already packaged.',
      },
    ],
  },
  {
    slug: 'lego-minifigure',
    title: 'LEGO minifigure',
    description: 'You as a smooth yellow LEGO minifigure with printed face + accessories.',
    prompt_template:
      "A photoreal studio product photograph of an official-style LEGO minifigure based on the subject in the reference photo. Construction: smooth glossy plastic in classic minifigure proportions — cylindrical torso, blocky trapezoidal head, two stud-attached arms with claw hands, short legs. Yellow plastic head (classic LEGO skin tone) with a printed face matching the subject's expression and any glasses or distinctive features (eyes, eyebrows, mouth printed in clean clear marks). Hair piece is a separately molded LEGO element in the exact style and color of the subject's actual hair. Printed torso graphic reflects the subject's clothing color palette and pattern. One LEGO accessory in hand matching the subject's vibe (cup, book, tool, instrument). Clean white studio backdrop with a faint drop shadow under the figure. Three-quarter camera angle, soft three-point lighting, slight specular highlights on the glossy plastic. Square 1:1 framing. No LEGO logo, no instruction text, no real brand graphics in the printing.",
    model: 'nano-banana-2-lite',
    aspect_ratio: '1:1',
    display_order: 13,
    seo_title: 'LEGO minifigure generator — turn your photo into a brick toy',
    seo_description:
      'Upload a photo and get yourself as an official-looking LEGO minifigure with printed face and accessories.',
    faq: [
      {
        question: 'Why yellow skin?',
        answer:
          'Classic LEGO minifigures use the iconic yellow face. Custom skin tones arrive in a later release.',
      },
    ],
  },
  {
    slug: 'wes-anderson-pastel',
    title: 'Wes Anderson pastel',
    description:
      'Centered symmetrical composition, pastel palette, dollhouse lighting — Grand Budapest aesthetic.',
    prompt_template:
      "A cinematic Wes Anderson-style portrait of the subject in the reference photo, shot in the visual language of The Grand Budapest Hotel, Asteroid City, and The French Dispatch. Perfectly centered symmetrical composition with the subject dead-center facing camera, deadpan neutral expression preserved exactly from the reference. Flat dollhouse-like backdrop (a uniformly wallpapered wall, a hotel hallway, or a stage set), perfectly head-on. Pastel color palette — mint green, salmon pink, mustard yellow, dusty cream, powder blue — with one dominant pastel for the backdrop. Soft even diffuse front lighting like a museum diorama (no dramatic shadows). Subtle 16mm film grain. Props arranged with obsessive symmetry on either side of the subject (matching potted plants, paired books, mirrored objects). 16:9 anamorphic widescreen framing. Preserve the subject's exact face, age, ethnicity, hairstyle, clothing, and posture — only the surrounding context becomes Wes Anderson. No legible text, no signage in any readable language.",
    model: 'nano-banana-2-lite',
    aspect_ratio: '16:9',
    display_order: 14,
    seo_title: 'Wes Anderson AI portrait — pastel symmetrical photo generator',
    seo_description:
      'Free generator that turns your photo into a Wes Anderson style symmetrical pastel portrait.',
    faq: [
      {
        question: 'Why 16:9?',
        answer:
          "Matches Wes Anderson's anamorphic cinematic framing and reads as a film still on social.",
      },
    ],
  },
  {
    slug: 'renaissance-oil-painting',
    title: 'Renaissance oil painting',
    description: 'You as a 16th-century noble — chiaroscuro lighting, brushwork, gold-leaf frame.',
    prompt_template:
      "A photoreal High Renaissance oil-painting portrait of the subject in the reference photo, in the visual tradition of Leonardo da Vinci, Raphael, and Hans Holbein the Younger circa 1500-1530. Three-quarter view of the head and upper torso. Dark moody background — a dim Italian interior with a small distant window of soft daylight. Dramatic chiaroscuro lighting from a single window source at upper-left, creating soft falloff across the face. Period-accurate clothing: high collared linen shirt, dark velvet or brocade doublet, perhaps a pearl earring or a thin gold chain. Visible oil-paint brushwork, particularly in the background and clothing folds. Subtle craquelure (fine age cracks) across the painted surface. Implied gold-leaf frame just outside the canvas edge. Dignified, contemplative expression preserved from the reference. Preserve the subject's exact bone structure, age, ethnicity, hair color, and hairstyle. Portrait 3:4 aspect. No text, no signature, no anachronistic objects — no modern glasses, no modern jewelry, no contemporary haircuts.",
    model: 'nano-banana-2-lite',
    aspect_ratio: '3:4',
    display_order: 15,
    seo_title: 'Renaissance oil painting AI — turn your photo into a 16th-century portrait',
    seo_description:
      'Upload a selfie and get an oil-painted Renaissance noble portrait with chiaroscuro lighting.',
    faq: [
      {
        question: 'Can I pick the era?',
        answer:
          'V1 uses High Renaissance (~1500s). Baroque, Rococo, and Romantic eras land in a future release.',
      },
    ],
  },
  {
    slug: 'south-park-cartoon',
    title: 'South Park character',
    description:
      'You as a paper-cutout South Park kid — round head, beady eyes, mountain backdrop.',
    prompt_template:
      "A South Park-style paper-cutout cartoon version of the subject in the reference photo, in the exact visual language of the Comedy Central series (Trey Parker / Matt Stone). Construction-paper aesthetic with deliberately flat, simple shapes. Round oval head with small beady black eyes, white pupils, no rendered nose (or only the simplest curved line), simple stubby stick limbs. The subject wears a winter coat in a primary color (red, blue, green, or orange — pick one matching the subject's actual clothing palette) plus a knit pom-pom beanie or hat in a contrasting color. South Park's signature Colorado mountain-town backdrop: rolling snow-covered hills, dark pine trees, a wooden fence, a small wooden cabin or sign in the distance. Flat lighting, no rendered shadows, deliberate paper-doll cut-out look. Preserve the subject's hair color (rendered as a flat colored shape peeking from under the hat) and clothing color palette, but stylize all features to the South Park visual vocabulary. Square 1:1 framing. No legible text, no Comedy Central logo.",
    model: 'nano-banana-2',
    aspect_ratio: '1:1',
    display_order: 16,
    seo_title: 'South Park AI generator — turn your photo into a Colorado cartoon',
    seo_description:
      'Free AI tool that turns any photo into a South Park style paper-cutout cartoon.',
    faq: [
      {
        question: 'Why the quick model?',
        answer:
          "South Park's flat low-detail style doesn't need the Pro model — Quick generates faster and saves credits.",
      },
    ],
  },
  {
    slug: 'cyberpunk-neon',
    title: 'Cyberpunk neon portrait',
    description:
      'You as a Night City netrunner — chrome implants, rain-slick neon streets, holographic ads.',
    prompt_template:
      "A cinematic cyberpunk neon-noir portrait of the subject in the reference photo, in the visual language of Blade Runner 2049, Cyberpunk: Edgerunners, and Ghost in the Shell. Subtle chrome cybernetic implants — a thin jaw plate, a glowing temple chip, a neck port — placed tastefully so the subject's face remains the focal point. Rain-slick Night City street background with vivid pink and cyan neon signage out of focus behind them, holographic kanji advertisements reflecting on the wet pavement below. Soft volumetric fog. Strong rim-light on the subject's hair and shoulders in hot magenta from camera-right, with cyan key-light from camera-left for a complementary palette. Slight CRT scanline overlay and chromatic aberration on highlights. Futuristic streetwear: a high-collared technical jacket with reflective trim, perhaps a glowing neckline LED. Intense piercing gaze preserved from the reference. Photoreal cinematic quality, shot as if on an ARRI Alexa with anamorphic lenses. Portrait 3:4 framing. Preserve the subject's exact face, age, ethnicity, and hairstyle. No legible text, no real brand names, no weapons.",
    model: 'nano-banana-2-lite',
    aspect_ratio: '3:4',
    display_order: 0,
    seo_title: 'Cyberpunk portrait generator — Night City neon photo AI',
    seo_description:
      'Turn your selfie into a cyberpunk netrunner portrait with chrome implants and neon streets.',
    faq: [
      {
        question: 'How prominent are the implants?',
        answer:
          'Subtle by default — small chrome plates and a temple chip. Generate again for a different variation.',
      },
    ],
  },
  {
    slug: 'y2k-digicam-flash',
    title: 'Y2K digicam flash',
    description:
      '2006 nightlife aesthetic — harsh on-camera flash, glowy skin, low-res digicam grain.',
    prompt_template:
      "An authentic-looking late-2000s digital point-and-shoot camera flash photo of the subject in the reference photo, shot circa 2006-2008 on a 5-megapixel Canon PowerShot or Sony Cyber-shot. Direct harsh on-camera flash creating slightly overexposed highlights on the face and forehead, with deep falloff into near-black background. Low-resolution digicam noise pattern at ISO 400, mild chromatic aberration on edges, subtle motion blur, slightly imperfect candid framing (subject not centered, head clipped on one side). Y2K nightlife mood: a dim bar, club bathroom, or house party room implied by the background — out-of-focus party debris (red Solo cup, leather couch, string lights, posters on a wall). Subject looking casual and unposed, mid-laugh or mid-conversation. Slight grain. Date stamp in the bottom-right corner in small red LED-style font formatted as '09 22 2007 23:14'. Square 1:1 framing (cropped from the original 4:3 digicam aspect). Preserve the subject's exact face, age, ethnicity, hairstyle, and clothing. No modern smartphone artifacts, no Instagram filter look — this must look genuinely shot on hardware from 2007.",
    model: 'nano-banana-2',
    aspect_ratio: '1:1',
    display_order: 18,
    seo_title: 'Y2K digicam flash AI — 2000s nightlife photo generator',
    seo_description:
      'Recreate the viral 2000s digital camera flash aesthetic — harsh flash, glowy skin, faded grain.',
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
    prompt_template:
      "A professional studio LinkedIn headshot of the subject in the reference photo, in the visual quality of a top-tier corporate headshot photographer (Peter Hurley / Jeff Bark school). Soft three-point lighting setup: warm key light at 45 degrees from camera-right, fill light at -30 degrees, subtle hair light from behind. Neutral muted-gray or soft-blue gradient backdrop. Sharp focus on the eyes with creamy bokeh background (shot as if at f/2.8 on an 85mm equivalent lens). Subtle natural smile preserved from the reference (or a confident closed-mouth expression if the subject isn't smiling). Business-professional attire: a tailored blazer or smart blouse/shirt, replacing the original clothing — pick a color (charcoal, navy, burgundy, forest green) that complements the subject's skin tone. Subtle, tasteful skin retouching that preserves natural texture, freckles, pores, and laugh lines — DO NOT plastic-smooth the skin. Visible eye catchlights from the key light. Slight backdrop vignette. Square 1:1 framing, head-and-shoulders, with the subject slightly off-center per rule of thirds. Preserve the subject's exact face, ethnicity, age, hairstyle and hair color. No logo, no name plate, no text overlay.",
    model: 'nano-banana-2-lite',
    aspect_ratio: '1:1',
    display_order: 19,
    seo_title: 'LinkedIn headshot generator — professional photo from any selfie',
    seo_description:
      'Upload a casual selfie and get a polished LinkedIn-ready professional headshot with studio lighting.',
    faq: [
      {
        question: 'Will it look fake?',
        answer:
          'The prompt asks for natural skin texture and authentic studio lighting. Most outputs pass for real headshots.',
      },
      {
        question: 'Can I keep my own outfit?',
        answer: 'V1 swaps to business attire. Outfit-preserving mode is on the roadmap.',
      },
    ],
  },
]

async function main() {
  let inserted = 0
  let skipped = 0
  let errors = 0

  for (const trend of trends) {
    const row = {
      ...trend,
      input_schema: DEFAULT_SCHEMA,
      is_active: true,
      eval_status: 'passed',
    }
    const { data, error } = await supabase
      .from('trends')
      .insert(row)
      .select('id, slug')
      .maybeSingle()

    if (error) {
      if (error.code === '23505' || error.message.includes('duplicate')) {
        console.log(`  = ${trend.slug} (already exists)`)
        skipped++
      } else {
        console.error(`  ✗ ${trend.slug}: ${error.message}`)
        errors++
      }
      continue
    }
    if (data) {
      console.log(`  + ${data.slug} (${data.id})`)
      inserted++
    }
  }

  console.log('')
  console.log(`Inserted: ${inserted}`)
  console.log(`Skipped:  ${skipped}`)
  console.log(`Errors:   ${errors}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
