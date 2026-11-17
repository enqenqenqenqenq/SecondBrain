import { fold, matches, parseQuery } from './search'
import type { Card } from './storage'

// Карточки, подходящие под запрос: по имени и по прозвищам, без регистра, «ё» как «е».
// Пустой запрос подходит всем. Порядок сохраняется.
export function matchCards(cards: Card[], query: string): Card[] {
  const words = parseQuery(query)
  if (words.length === 0) return cards
  return cards.filter((card) => matches(fold([card.name, ...card.aliases].join(' ')), words))
}

// Есть ли карточка с точно таким именем или прозвищем. Нужна, чтобы не предлагать создать дубль.
export function hasExactCard(cards: Card[], name: string): boolean {
  const key = fold(name.trim())
  if (!key) return false
  return cards.some((c) => fold(c.name) === key || c.aliases.some((a) => fold(a) === key))
}
