import { BookOpenText, Fire, Flower, Leaf, Sparkle, Star, Target } from '@phosphor-icons/react'

export const PERSONA_ICON_KEYS = ['flower', 'star', 'leaf', 'book', 'fire', 'target']

const PERSONA_ICON_MAP = {
  flower: Flower,
  star: Star,
  leaf: Leaf,
  book: BookOpenText,
  fire: Fire,
  target: Target,
}

export function PersonaAvatarIcon({ iconKey, size = 24, color = 'currentColor', weight = 'duotone' }) {
  const Icon = PERSONA_ICON_MAP[iconKey] || Sparkle

  return <Icon size={size} color={color} weight={weight} />
}