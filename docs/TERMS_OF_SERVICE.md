# Trendly — Terms of Service (Draft)

**Status:** Draft. Not yet hosted on the live site. Once `app/(public)/terms/page.tsx` is built, this file becomes the canonical source and the page renders from it.

**Last updated:** 2026-05-29.

---

## 1. Acceptance

By using Trendly, you agree to these Terms. If you do not agree, do not use the service.

## 2. The service

Trendly is a viral-trend image generator. You provide a photo. The service runs a curated text prompt against an AI image-generation model and returns a new image. The catalog of trends is operated by Trendly.

## 3. Personal use only

**All generated outputs are licensed to you for personal, non-commercial use only.** You may:

- Share generated outputs on personal social media (Instagram, TikTok, X, etc.).
- Print generated outputs for personal use.
- Use generated outputs as a profile picture or avatar on personal accounts.

You may **not**:

- Resell generated outputs as merchandise, prints, NFTs, stock images, or downloadable assets.
- Redistribute generated outputs as part of a commercial product or service.
- Train other machine-learning models on Trendly outputs.
- Claim generated outputs as your original artwork in any commercial context.
- Use generated outputs in advertising for any third-party brand.

## 4. Style references and intellectual property

Trendly's trend prompts may reference specific artistic styles, named productions, or creator names (e.g. "in the visual language of Studio Ghibli", "in the style of a Pixar 3D character", "Stranger Things-style poster lighting"). These references are stylistic — they describe a look and feel — and the outputs are intended to evoke that aesthetic, not to recreate copyrighted characters, scenes, logos, or trade dress.

You are responsible for how you use any output:

- Do not pass off an output as official artwork from any named studio, brand, or creator.
- Do not use outputs in any commercial context that implies endorsement by or affiliation with a referenced franchise, studio, or creator.
- Do not use outputs in any context that violates trademark or right-of-publicity law in your jurisdiction.

If a rights-holder of a referenced franchise contacts Trendly with a takedown, we will:

1. Remove the affected trend within 24 hours.
2. Re-prompt the trend to drop the named reference.
3. Notify users who generated outputs under that trend that their downloads remain personal-use only and they should not redistribute.

## 5. Photo content

You retain all rights to the photos you upload. Trendly does not claim ownership of your uploads. Uploaded photos are stored privately for 24 hours then permanently deleted (free tier) or as long as your account is active (Pro tier).

You may only upload photos you have the right to upload. Specifically:

- Photos of yourself: always OK.
- Photos of other consenting adults: only with their explicit permission.
- Photos of minors: only photos of your own children, and only if you have full custody / parental rights.
- Photos of celebrities, public figures, or strangers without consent: **not allowed**.
- Photos containing identifying details (license plates, addresses, ID documents) of others: **not allowed**.

## 6. Prohibited content

You may not use Trendly to generate:

- Sexually explicit imagery of any person.
- Imagery of minors in any sexualized or harmful context.
- Imagery designed to harass, defame, or impersonate a specific real person.
- Imagery that depicts illegal acts.
- Imagery that violates the AI provider's safety policies (the model will reject these — repeated attempts may result in account suspension).

## 7. AI-quality disclaimer

AI image generation is non-deterministic. The same prompt can produce different results. We make no guarantee about output quality, accuracy, or resemblance to your input photo. **Credits spent on completed generations are not refundable on the basis of quality.** Failed generations (safety reject, timeout, error) are automatically refunded.

## 8. Account and billing

- Free tier: 5 generations per week, reset every Sunday 00:00 UTC.
- Credits: never expire while your account is active. Purchased credits are one-time, USD-denominated, processed through Stripe.
- Refunds: full refunds for unspent credit packs within 7 days of purchase. Used credits are not refundable.
- Account deletion: you may delete your account at any time from the Settings page. We honor GDPR Article 17 (right to erasure) — your profile is marked deleted immediately and fully purged within 30 days. See `docs/RUNBOOK.md` for details.

## 9. Data and privacy

See `docs/PRIVACY_POLICY.md` (when published) for the full privacy policy. Summary:

- Uploaded photos: 24-hour TTL (free), forever-while-active (Pro).
- Generated outputs: 30-day TTL (free), forever-while-active (Pro).
- We use PostHog for product analytics (you can opt out) and Sentry for error monitoring.
- We do not sell your data.
- See your data via Settings → Your data (GDPR Article 15 export).

## 10. Changes

We may update these Terms. Material changes will be announced via email and on the home page banner at least 14 days before they take effect.

## 11. Contact

For takedowns, billing disputes, or any other concerns: support@trendly.example (placeholder — wire to real email before launch).

---

**Engineering notes** (delete before publishing the public ToS):

- This is the working draft referenced by `.claude/lessons.md` 2026-05-29 entry on franchise-IP risk in trend prompts.
- §3 ("Personal use only") is the explicit liability-shifting clause the user requested.
- §4 ("Style references and IP") is the takedown protocol.
- §6 ("Prohibited content") is mostly mirrored by Gemini's safety filter at generation time, but the explicit user-facing list also lets us suspend accounts that repeatedly try to bypass.
- When wiring this into a public page, link from the footer of `app/(public)/layout.tsx` + the login form copy ("By continuing you agree to our terms"). The login form already has that line — the link target needs `/terms`.
- Also: render JSON-LD `LegalDocument` schema on the public ToS page for SEO.
