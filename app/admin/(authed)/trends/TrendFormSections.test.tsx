import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  GenerationSection,
  IdentitySection,
  MediaSection,
  SchemaFaqSection,
  SeoSection,
  type TrendFormValues,
} from './TrendFormSections'

afterEach(() => {
  cleanup()
})

describe('IdentitySection', () => {
  it('renders slug + title + description inputs pre-filled from initial values', () => {
    // Arrange / Act
    render(
      <IdentitySection
        initial={{ slug: 'glow-up', title: 'Glow Up', description: 'Warm filmic grade' }}
      />
    )

    // Assert
    expect(screen.getByLabelText('Title')).toHaveValue('Glow Up')
    expect(screen.getByLabelText('Slug')).toHaveValue('glow-up')
    expect(screen.getByLabelText('Description')).toHaveValue('Warm filmic grade')
  })

  it('marks slug and title as required', () => {
    render(<IdentitySection initial={{}} />)
    expect(screen.getByLabelText('Title')).toBeRequired()
    expect(screen.getByLabelText('Slug')).toBeRequired()
  })

  it('renders inside a Card with the Identity title', () => {
    render(<IdentitySection initial={{}} />)
    expect(screen.getByText('Identity')).toBeInTheDocument()
  })
})

describe('GenerationSection', () => {
  it('renders prompt_template + model + aspect_ratio + display_order controls', () => {
    render(<GenerationSection initial={{}} />)
    expect(screen.getByLabelText('Prompt template')).toBeInTheDocument()
    expect(screen.getByLabelText('Model')).toBeInTheDocument()
    expect(screen.getByLabelText('Aspect ratio')).toBeInTheDocument()
    expect(screen.getByLabelText('Display order')).toBeInTheDocument()
  })

  it('pre-selects model + aspect_ratio + display_order from initial values', () => {
    render(
      <GenerationSection
        initial={{
          prompt_template: 'Render {{user_photo}}',
          model: 'nano-banana-2',
          aspect_ratio: '9:16',
          display_order: 12,
        }}
      />
    )
    expect(screen.getByLabelText('Prompt template')).toHaveValue('Render {{user_photo}}')
    expect(screen.getByLabelText('Model')).toHaveValue('nano-banana-2')
    expect(screen.getByLabelText('Aspect ratio')).toHaveValue('9:16')
    expect(screen.getByLabelText('Display order')).toHaveValue(12)
  })

  it('defaults to gpt-image-2 / 1:1 / 0 when no initial values supplied', () => {
    render(<GenerationSection initial={{}} />)
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-image-2')
    expect(screen.getByLabelText('Aspect ratio')).toHaveValue('1:1')
    expect(screen.getByLabelText('Display order')).toHaveValue(0)
  })

  it('renders inside a Card with the Generation title', () => {
    render(<GenerationSection initial={{}} />)
    expect(screen.getByText('Generation')).toBeInTheDocument()
  })
})

describe('MediaSection', () => {
  it('renders three URL inputs (thumbnail, sample_before, sample_after)', () => {
    render(<MediaSection initial={{}} />)
    expect(screen.getByLabelText('Thumbnail')).toBeInTheDocument()
    expect(screen.getByLabelText('Sample before')).toBeInTheDocument()
    expect(screen.getByLabelText('Sample after')).toBeInTheDocument()
  })

  it('pre-fills the URL inputs from initial values', () => {
    render(
      <MediaSection
        initial={{
          thumbnail_url: 'https://cdn.example.com/t.jpg',
          sample_before_url: 'https://cdn.example.com/b.jpg',
          sample_after_url: 'https://cdn.example.com/a.jpg',
        }}
      />
    )
    expect(screen.getByLabelText('Thumbnail')).toHaveValue('https://cdn.example.com/t.jpg')
    expect(screen.getByLabelText('Sample before')).toHaveValue('https://cdn.example.com/b.jpg')
    expect(screen.getByLabelText('Sample after')).toHaveValue('https://cdn.example.com/a.jpg')
  })

  it('renders inside a Card with the Media title', () => {
    render(<MediaSection initial={{}} />)
    expect(screen.getByText('Media')).toBeInTheDocument()
  })
})

describe('SeoSection', () => {
  it('renders SEO title + SEO description inputs', () => {
    render(<SeoSection initial={{}} />)
    expect(screen.getByLabelText('SEO title')).toBeInTheDocument()
    expect(screen.getByLabelText('SEO description')).toBeInTheDocument()
  })

  it('pre-fills SEO inputs from initial values', () => {
    render(
      <SeoSection
        initial={{ seo_title: 'Glow Up trend', seo_description: 'Try the viral glow-up.' }}
      />
    )
    expect(screen.getByLabelText('SEO title')).toHaveValue('Glow Up trend')
    expect(screen.getByLabelText('SEO description')).toHaveValue('Try the viral glow-up.')
  })

  it('renders inside a Card with the SEO title', () => {
    render(<SeoSection initial={{}} />)
    expect(screen.getByText('SEO')).toBeInTheDocument()
  })
})

describe('SchemaFaqSection', () => {
  it('renders the two JSON textareas with their placeholder examples', () => {
    render(<SchemaFaqSection initial={{}} />)
    const schema = screen.getByLabelText('Input schema') as HTMLTextAreaElement
    const faq = screen.getByLabelText('FAQ') as HTMLTextAreaElement
    expect(schema).toBeInTheDocument()
    expect(faq).toBeInTheDocument()
    expect(schema.placeholder).toContain('fields')
    expect(faq.placeholder).toContain('question')
  })

  it('pretty-prints object initial values with jsonString (2-space indent)', () => {
    const schema = {
      fields: [{ type: 'image', name: 'user_photo', label: 'Your photo', required: true }],
    }
    const faq = [{ question: 'Is it free?', answer: '5 free per week.' }]
    render(<SchemaFaqSection initial={{ input_schema: schema, faq }} />)
    expect(screen.getByLabelText('Input schema')).toHaveValue(JSON.stringify(schema, null, 2))
    expect(screen.getByLabelText('FAQ')).toHaveValue(JSON.stringify(faq, null, 2))
  })

  it('renders empty strings (no "null"/"undefined") for nullish initial JSON', () => {
    render(<SchemaFaqSection initial={{ input_schema: null, faq: undefined }} />)
    expect(screen.getByLabelText('Input schema')).toHaveValue('')
    expect(screen.getByLabelText('FAQ')).toHaveValue('')
    // Defensive: the literal strings must NOT appear in the DOM.
    expect(screen.queryByText('null')).toBeNull()
    expect(screen.queryByText('undefined')).toBeNull()
  })

  it('passes a pre-existing JSON string through verbatim (no double-stringify)', () => {
    const raw = '{"fields":[]}'
    render(<SchemaFaqSection initial={{ input_schema: raw }} />)
    expect(screen.getByLabelText('Input schema')).toHaveValue(raw)
  })

  it('renders inside a Card with the "Schema & FAQ" title (matches HTML entity)', () => {
    render(<SchemaFaqSection initial={{}} />)
    expect(screen.getByText('Schema & FAQ')).toBeInTheDocument()
  })
})

describe('TrendFormValues type', () => {
  it('accepts the documented shape at compile time', () => {
    // Compile-time only: assigning a fully-populated value must type-check.
    const value: TrendFormValues = {
      slug: 'glow-up',
      title: 'Glow Up',
      description: 'desc',
      prompt_template: 'tmpl',
      model: 'nano-banana-2-lite',
      aspect_ratio: '1:1',
      display_order: 0,
      thumbnail_url: 'https://x',
      sample_before_url: 'https://x',
      sample_after_url: 'https://x',
      seo_title: 'x',
      seo_description: 'x',
      input_schema: { fields: [] },
      faq: [],
    }
    expect(value.slug).toBe('glow-up')
  })
})
