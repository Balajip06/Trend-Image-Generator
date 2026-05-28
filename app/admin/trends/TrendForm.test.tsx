import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TrendForm } from './TrendForm'

afterEach(() => {
  cleanup()
})

// A no-op server-action stand-in. The DOM `action` attr is React-managed
// (formAction / synthetic submit), so we assert on the form's structure +
// the prop's identity, not on raw HTML.
const noopAction = vi.fn(async (): Promise<void> => {})

describe('TrendForm', () => {
  it('renders all five Card section titles', () => {
    render(<TrendForm action={noopAction} submitLabel="Save" />)
    expect(screen.getByText('Identity')).toBeInTheDocument()
    expect(screen.getByText('Generation')).toBeInTheDocument()
    expect(screen.getByText('Media')).toBeInTheDocument()
    expect(screen.getByText('SEO')).toBeInTheDocument()
    // The Schema card title contains an HTML entity (&amp;) — match by exact text.
    expect(screen.getByText('Schema & FAQ')).toBeInTheDocument()
  })

  it('renders the submit button with the provided submitLabel', () => {
    render(<TrendForm action={noopAction} submitLabel="Create trend" />)
    expect(screen.getByRole('button', { name: 'Create trend' })).toBeInTheDocument()
  })

  it('pre-fills text/url/number fields and selects from initial values', () => {
    render(
      <TrendForm
        action={noopAction}
        submitLabel="Save"
        initial={{
          slug: 'glow-up',
          title: 'Glow Up',
          description: 'A subtle warm grade.',
          prompt_template: 'Make {{user_photo}} glow.',
          model: 'nano-banana',
          aspect_ratio: '9:16',
          display_order: 7,
          thumbnail_url: 'https://cdn.example.com/thumb.jpg',
          sample_before_url: 'https://cdn.example.com/before.jpg',
          sample_after_url: 'https://cdn.example.com/after.jpg',
          seo_title: 'Glow Up trend',
          seo_description: 'Try the viral glow-up.',
        }}
      />,
    )

    expect(screen.getByLabelText('Title')).toHaveValue('Glow Up')
    expect(screen.getByLabelText('Slug')).toHaveValue('glow-up')
    expect(screen.getByLabelText('Description')).toHaveValue('A subtle warm grade.')
    expect(screen.getByLabelText('Prompt template')).toHaveValue('Make {{user_photo}} glow.')
    expect(screen.getByLabelText('Model')).toHaveValue('nano-banana')
    expect(screen.getByLabelText('Aspect ratio')).toHaveValue('9:16')
    expect(screen.getByLabelText('Display order')).toHaveValue(7)
    expect(screen.getByLabelText('Thumbnail URL')).toHaveValue('https://cdn.example.com/thumb.jpg')
    expect(screen.getByLabelText('Sample before URL')).toHaveValue(
      'https://cdn.example.com/before.jpg',
    )
    expect(screen.getByLabelText('Sample after URL')).toHaveValue(
      'https://cdn.example.com/after.jpg',
    )
    expect(screen.getByLabelText('SEO title')).toHaveValue('Glow Up trend')
    expect(screen.getByLabelText('SEO description')).toHaveValue('Try the viral glow-up.')
  })

  it('renders with empty values when no initial prop is provided', () => {
    render(<TrendForm action={noopAction} submitLabel="Save" />)
    expect(screen.getByLabelText('Title')).toHaveValue('')
    expect(screen.getByLabelText('Slug')).toHaveValue('')
    expect(screen.getByLabelText('Description')).toHaveValue('')
    expect(screen.getByLabelText('Prompt template')).toHaveValue('')
    // Defaults for selects when no initial value.
    expect(screen.getByLabelText('Model')).toHaveValue('nano-banana-pro')
    expect(screen.getByLabelText('Aspect ratio')).toHaveValue('1:1')
    expect(screen.getByLabelText('Display order')).toHaveValue(0)
    expect(screen.getByLabelText('Input schema')).toHaveValue('')
    expect(screen.getByLabelText('FAQ')).toHaveValue('')
  })

  it('renders the extraActions slot next to the submit button', () => {
    render(
      <TrendForm
        action={noopAction}
        submitLabel="Save"
        extraActions={<button type="button">Delete</button>}
      />,
    )
    const deleteBtn = screen.getByRole('button', { name: 'Delete' })
    const saveBtn = screen.getByRole('button', { name: 'Save' })
    expect(deleteBtn).toBeInTheDocument()
    // Both buttons must share the same sticky action bar.
    expect(deleteBtn.parentElement).toBe(saveBtn.parentElement)
  })

  it('renders the banner slot above the form fields', () => {
    const { container } = render(
      <TrendForm
        action={noopAction}
        submitLabel="Save"
        banner={<div data-testid="banner-marker">Heads up.</div>}
      />,
    )
    const banner = screen.getByTestId('banner-marker')
    expect(banner).toBeInTheDocument()
    // Banner is the first child inside the form (before any Card).
    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    expect(form?.firstElementChild).toBe(banner)
  })

  it('wraps everything in a <form> element with flex-col gap-6 layout', () => {
    const { container } = render(<TrendForm action={noopAction} submitLabel="Save" />)
    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    expect(form).toHaveClass('flex')
    expect(form).toHaveClass('flex-col')
    expect(form).toHaveClass('gap-6')
  })

  it('JSON-stringifies the input_schema object into the textarea', () => {
    render(
      <TrendForm
        action={noopAction}
        submitLabel="Save"
        initial={{
          input_schema: {
            fields: [
              { type: 'image', name: 'user_photo', label: 'Your photo', required: true },
            ],
          },
        }}
      />,
    )
    const ta = screen.getByLabelText('Input schema') as HTMLTextAreaElement
    expect(ta.value).toBe(
      JSON.stringify(
        {
          fields: [
            { type: 'image', name: 'user_photo', label: 'Your photo', required: true },
          ],
        },
        null,
        2,
      ),
    )
    // Must be valid JSON.
    expect(() => JSON.parse(ta.value)).not.toThrow()
  })

  it('JSON-stringifies the faq array into the textarea', () => {
    const faq = [{ question: 'Is it free?', answer: '5 free per week.' }]
    render(<TrendForm action={noopAction} submitLabel="Save" initial={{ faq }} />)
    const ta = screen.getByLabelText('FAQ') as HTMLTextAreaElement
    expect(ta.value).toBe(JSON.stringify(faq, null, 2))
    expect(JSON.parse(ta.value)).toEqual(faq)
  })

  it('renders empty textareas (not "null" or "undefined") when JSON fields are nullish', () => {
    render(
      <TrendForm
        action={noopAction}
        submitLabel="Save"
        initial={{ input_schema: null, faq: undefined }}
      />,
    )
    expect(screen.getByLabelText('Input schema')).toHaveValue('')
    expect(screen.getByLabelText('FAQ')).toHaveValue('')
  })

  it('passes a pre-existing JSON string through verbatim instead of double-stringifying', () => {
    const raw = '{"fields":[]}'
    render(<TrendForm action={noopAction} submitLabel="Save" initial={{ input_schema: raw }} />)
    expect(screen.getByLabelText('Input schema')).toHaveValue(raw)
  })
})
