import { useEffect, useState } from 'react'
import { watchCardFeed, watchCards } from './storage'
import type { Card, CardFeedEntry } from './storage'

// Все карточки людей и мест. Список обновляется сам. Пока читаем, null.
export function useCards(): Card[] | null {
  const [cards, setCards] = useState<Card[] | null>(null)
  useEffect(() => watchCards(setCards), [])
  return cards
}

// Лента одной карточки с ролями. Без карточки или пока читаем, null.
export function useCardFeed(cardId: string | null): CardFeedEntry[] | null {
  const [state, setState] = useState<{ id: string; feed: CardFeedEntry[] } | null>(null)
  useEffect(() => {
    if (cardId === null) return
    return watchCardFeed(cardId, (feed) => setState({ id: cardId, feed }))
  }, [cardId])
  // Лента чужой карточки, оставшаяся от прошлого выбора, не показывается
  return cardId !== null && state?.id === cardId ? state.feed : null
}
