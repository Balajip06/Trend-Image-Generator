import { describe, expect, it, vi } from 'vitest'

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://testref.supabase.co')

import { DEFAULT_TREND_INPUT, type TrendInput } from './input-schema'
import { collectImageInputs, interpolatePrompt } from './interpolate'

// Valid Supabase Storage URLs used by collectImageInputs tests
const STORAGE = (name: string) =>
  `https://testref.supabase.co/storage/v1/object/public/uploads/${name}`

const couple: TrendInput = {
  fields: [
    { type: 'image', name: 'user_photo', label: 'You', required: true, min_count: 1, max_count: 1 },
    {
      type: 'image',
      name: 'partner_photo',
      label: 'Partner',
      required: true,
      min_count: 1,
      max_count: 1,
    },
    { type: 'text', name: 'caption', label: 'Caption', required: false, max_length: 50 },
    {
      type: 'select',
      name: 'style',
      label: 'Style',
      required: true,
      options: [
        { value: 'ghibli', label: 'Ghibli' },
        { value: 'pixar', label: 'Pixar' },
      ],
    },
  ],
}

describe('interpolatePrompt', () => {
  it('substitutes text + select placeholders', () => {
    expect(
      interpolatePrompt('A {{style}} portrait, caption "{{caption}}"', couple, {
        style: 'ghibli',
        caption: 'forever',
      })
    ).toBe('A ghibli portrait, caption "forever"')
  })

  it('substitutes the same placeholder multiple times', () => {
    expect(interpolatePrompt('{{style}} / {{style}} / {{style}}', couple, { style: 'pixar' })).toBe(
      'pixar / pixar / pixar'
    )
  })

  it('treats missing optional text field as empty string', () => {
    expect(
      interpolatePrompt('caption=[{{caption}}] style={{style}}', couple, { style: 'ghibli' })
    ).toBe('caption=[] style=ghibli')
  })

  it('throws on missing required text/select field', () => {
    expect(() => interpolatePrompt('{{style}}', couple, {})).toThrow(/style/)
  })

  it('throws on unknown placeholder', () => {
    expect(() => interpolatePrompt('{{nope}}', couple, {})).toThrow(/nope/)
  })

  it('ignores image-field name placeholders (they are forwarded multimodal)', () => {
    // user_photo is an image field — referencing it in prompt is invalid
    expect(() => interpolatePrompt('{{user_photo}}', couple, { user_photo: 'url' })).toThrow(
      /user_photo/
    )
  })

  it('rejects array value for text field', () => {
    expect(() => interpolatePrompt('{{caption}}', couple, { caption: ['a', 'b'] })).toThrow(/array/)
  })

  it('tolerates whitespace inside placeholder braces', () => {
    expect(interpolatePrompt('{{  style  }}', couple, { style: 'ghibli' })).toBe('ghibli')
  })
})

describe('collectImageInputs', () => {
  it('returns image URLs in field-declaration order', () => {
    expect(
      collectImageInputs(couple, {
        partner_photo: STORAGE('partner.jpg'),
        user_photo: STORAGE('user.jpg'),
        caption: 'ignored',
      })
    ).toEqual([STORAGE('user.jpg'), STORAGE('partner.jpg')])
  })

  it('flattens arrays from multi-image fields', () => {
    const multi: TrendInput = {
      fields: [
        {
          type: 'image',
          name: 'family',
          label: 'Family',
          required: true,
          min_count: 1,
          max_count: 4,
        },
      ],
    }
    expect(
      collectImageInputs(multi, {
        family: [STORAGE('a.jpg'), STORAGE('b.jpg'), STORAGE('c.jpg')],
      })
    ).toEqual([STORAGE('a.jpg'), STORAGE('b.jpg'), STORAGE('c.jpg')])
  })

  it('throws on missing required image', () => {
    expect(() => collectImageInputs(DEFAULT_TREND_INPUT, {})).toThrow(/user_photo/)
  })

  it('skips empty optional image', () => {
    const schema: TrendInput = {
      fields: [
        {
          type: 'image',
          name: 'optional_ref',
          label: 'Ref',
          required: false,
          min_count: 1,
          max_count: 1,
        },
      ],
    }
    expect(collectImageInputs(schema, {})).toEqual([])
  })
})
