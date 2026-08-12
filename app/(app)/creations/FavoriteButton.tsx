'use client'

import { Star } from 'lucide-react'
import { useOptimistic, useTransition } from 'react'
import { toggleFavorite } from './actions'

interface FavoriteButtonProps {
  generationId: string
  isFavorite: boolean
}

export function FavoriteButton({ generationId, isFavorite }: FavoriteButtonProps) {
  const [optimisticFavorite, setOptimisticFavorite] = useOptimistic(isFavorite)
  const [pending, startTransition] = useTransition()

  const onClick = () => {
    startTransition(async () => {
      setOptimisticFavorite(!optimisticFavorite)
      const form = new FormData()
      form.set('generation_id', generationId)
      await toggleFavorite(form)
    })
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={optimisticFavorite ? 'Unfavorite' : 'Favorite'}
      aria-pressed={optimisticFavorite}
      className="border-border/60 bg-card/90 hover:bg-card grid size-8 place-items-center rounded-full border backdrop-blur-sm transition-colors disabled:opacity-60"
    >
      <Star
        className={`size-4 ${pending ? 'animate-pulse' : ''} ${
          optimisticFavorite ? 'fill-current text-[var(--brand-grad-1)]' : 'text-foreground/60'
        }`}
        aria-hidden
      />
    </button>
  )
}
