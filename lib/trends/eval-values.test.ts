import { describe, expect, it, vi } from 'vitest'

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://testref.supabase.co')

import { buildEvalValues } from './eval-values'
import { interpolatePrompt, collectImageInputs } from './interpolate'
import type { TrendInput } from './input-schema'

const IMG = 'https://testref.supabase.co/storage/v1/object/sign/uploads/sample.jpg'

describe('buildEvalValues', () => {
  it('binds the single eval image URL to every image field', () => {
    const schema: TrendInput = {
      fields: [
        {
          type: 'image',
          name: 'user_photo',
          label: 'Photo',
          required: true,
          min_count: 1,
          max_count: 1,
        },
      ],
    }
    const v = buildEvalValues(schema, IMG)
    expect(v.user_photo).toBe(IMG)
  })

  it('uses text field default when provided', () => {
    const schema: TrendInput = {
      fields: [
        {
          type: 'image',
          name: 'photo',
          label: 'Photo',
          required: true,
          min_count: 1,
          max_count: 1,
        },
        {
          type: 'text',
          name: 'caption',
          label: 'Caption',
          required: false,
          max_length: 50,
          default: 'hello world',
        },
      ],
    }
    expect(buildEvalValues(schema, IMG).caption).toBe('hello world')
  })

  it('emits an empty string for text fields without a default', () => {
    const schema: TrendInput = {
      fields: [
        {
          type: 'image',
          name: 'photo',
          label: 'Photo',
          required: true,
          min_count: 1,
          max_count: 1,
        },
        { type: 'text', name: 'mood', label: 'Mood', required: false, max_length: 50 },
      ],
    }
    expect(buildEvalValues(schema, IMG).mood).toBe('')
  })

  it('falls back to the first select option when no default is set', () => {
    const schema: TrendInput = {
      fields: [
        {
          type: 'image',
          name: 'photo',
          label: 'Photo',
          required: true,
          min_count: 1,
          max_count: 1,
        },
        {
          type: 'select',
          name: 'style',
          label: 'Style',
          required: true,
          options: [
            { value: 'soft', label: 'Soft' },
            { value: 'bold', label: 'Bold' },
          ],
        },
      ],
    }
    expect(buildEvalValues(schema, IMG).style).toBe('soft')
  })

  it('prefers select default over first option', () => {
    const schema: TrendInput = {
      fields: [
        {
          type: 'image',
          name: 'photo',
          label: 'Photo',
          required: true,
          min_count: 1,
          max_count: 1,
        },
        {
          type: 'select',
          name: 'style',
          label: 'Style',
          required: true,
          options: [
            { value: 'soft', label: 'Soft' },
            { value: 'bold', label: 'Bold' },
          ],
          default: 'bold',
        },
      ],
    }
    expect(buildEvalValues(schema, IMG).style).toBe('bold')
  })

  it('produced values flow cleanly through interpolatePrompt + collectImageInputs', () => {
    const schema: TrendInput = {
      fields: [
        {
          type: 'image',
          name: 'photo',
          label: 'Photo',
          required: true,
          min_count: 1,
          max_count: 1,
        },
        {
          type: 'text',
          name: 'mood',
          label: 'Mood',
          required: false,
          max_length: 50,
          default: 'cinematic',
        },
        {
          type: 'select',
          name: 'palette',
          label: 'Palette',
          required: true,
          options: [
            { value: 'warm', label: 'Warm' },
            { value: 'cool', label: 'Cool' },
          ],
          default: 'cool',
        },
      ],
    }
    const values = buildEvalValues(schema, IMG)
    const out = interpolatePrompt('A {{mood}} {{palette}} portrait', schema, values)
    expect(out).toBe('A cinematic cool portrait')
    expect(collectImageInputs(schema, values)).toEqual([IMG])
  })

  it('required text field without default throws via interpolatePrompt — caller surfaces missing_eval_default', () => {
    const schema: TrendInput = {
      fields: [
        {
          type: 'image',
          name: 'photo',
          label: 'Photo',
          required: true,
          min_count: 1,
          max_count: 1,
        },
        { type: 'text', name: 'subject', label: 'Subject', required: true, max_length: 50 },
      ],
    }
    const values = buildEvalValues(schema, IMG)
    expect(() => interpolatePrompt('A {{subject}} portrait', schema, values)).toThrow(
      /Required field missing/
    )
  })
})
