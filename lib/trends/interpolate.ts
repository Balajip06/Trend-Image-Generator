import type { TrendInput } from './input-schema'
import { assertStorageUrl } from '@/lib/storage/validate-image-url'

/**
 * Values supplied by the user at generation time, keyed by field name.
 * Image fields hold one or more Supabase Storage URLs.
 * Text/select fields hold the user-supplied string.
 */
export type TrendInputValues = Record<string, string | string[]>

/**
 * Substitutes `{{field_name}}` placeholders in a prompt template with text/select
 * values from the user payload. Image fields are NOT substituted into prompt text —
 * they are forwarded to Gemini as multimodal inputs alongside the prompt.
 *
 * @throws when a required text/select field is missing or an unknown placeholder appears.
 */
export function interpolatePrompt(
  template: string,
  schema: TrendInput,
  values: TrendInputValues
): string {
  const textLikeFields = new Map(
    schema.fields.filter((f) => f.type !== 'image').map((f) => [f.name, f] as const)
  )

  return template.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_full, name: string) => {
    const field = textLikeFields.get(name)
    if (!field) {
      throw new Error(`Unknown placeholder in prompt template: {{${name}}}`)
    }
    const raw = values[name]
    if (raw === undefined || raw === null || raw === '') {
      if (field.required) {
        throw new Error(`Required field missing: ${name}`)
      }
      return ''
    }
    if (Array.isArray(raw)) {
      throw new Error(`Field ${name} expected text but got array`)
    }
    return raw
  })
}

/**
 * Extracts ordered list of image-field values (Supabase URLs) for Gemini multimodal input.
 */
export function collectImageInputs(schema: TrendInput, values: TrendInputValues): string[] {
  const urls: string[] = []
  for (const field of schema.fields) {
    if (field.type !== 'image') continue
    const raw = values[field.name]
    if (raw === undefined || raw === null || raw === '') {
      if (field.required) {
        throw new Error(`Required image missing: ${field.name}`)
      }
      continue
    }
    if (typeof raw === 'string') {
      assertStorageUrl(raw)
      urls.push(raw)
    } else {
      raw.forEach(assertStorageUrl)
      urls.push(...raw)
    }
  }
  return urls
}
