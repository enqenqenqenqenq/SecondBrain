import { fold } from './search'
import type { CardKind, CompleteLink, LinkRole, NewCard } from './storage'

// То, что выбрал человек: существующая карточка или новая, которая создастся при сохранении записи
export type Picked =
  | { cardId: string; role: LinkRole | null }
  | { newCard: { kind: CardKind; name: string }; role: LinkRole | null }

const isLetter = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch)

export interface Mention {
  start: number // где стоит «@»
  query: string // что набрано после «@» до курсора
}

// Упоминание, которое сейчас набирается: «@» в начале строки или после пробела и слово после него до курсора.
// «@» посреди слова (почта, например) упоминанием не считается. Слово без пробелов и переносов.
export function findMention(text: string, caret: number): Mention | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  const query = before.slice(at + 1)
  if (/[\s@]/u.test(query)) return null
  if (at > 0 && !/\s/u.test(before[at - 1])) return null
  return { start: at, query }
}

// Подставляет имя вместо набранного «@слово». Возвращает новый текст и место курсора после имени и пробела.
export function applyMention(
  text: string,
  mention: Mention,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const rest = text.slice(caret)
  // Пробел после имени ставим, если дальше нет пробела или переноса, чтобы можно было сразу писать дальше
  const needsSpace = !/^[ \n]/u.test(rest)
  const head = `${text.slice(0, mention.start)}@${name}${needsSpace ? ' ' : ''}`
  // Если пробел уже был, курсор встаёт за него
  return { text: head + rest, caret: head.length + (rest.startsWith(' ') ? 1 : 0) }
}

// Роль по умолчанию для упоминания: человек упомянут, у места роли нет
export const mentionRole = (kind: CardKind): LinkRole | null =>
  kind === 'person' ? 'mentioned' : null

export interface Part {
  text: string
  cardId?: string // если часть это упоминание карточки
}

// Делит текст на обычные куски и упоминания известных карточек. Упоминание это «@» перед границей слова,
// имя карточки без учёта регистра и «ё», и граница слова после имени.
export function splitMentions(text: string, cards: { id: string; name: string }[]): Part[] {
  if (cards.length === 0 || !text.includes('@')) return [{ text }]
  const sorted = [...cards]
    .filter((c) => c.name.trim() !== '')
    .sort((a, b) => b.name.length - a.name.length)
  const folded = fold(text)
  const parts: Part[] = []
  let last = 0
  let i = 0
  while (i < text.length) {
    if (text[i] === '@' && (i === 0 || !isLetter(text[i - 1]))) {
      const hit = sorted.find((c) => {
        const end = i + 1 + c.name.length
        return folded.slice(i + 1, end) === fold(c.name) && !isLetter(text[end])
      })
      if (hit) {
        const end = i + 1 + hit.name.length
        if (i > last) parts.push({ text: text.slice(last, i) })
        parts.push({ text: text.slice(i, end), cardId: hit.id })
        last = end
        i = end
        continue
      }
    }
    i++
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts.length > 0 ? parts : [{ text }]
}

// Итоговые привязки записи: уже существующие плюс выбранные упоминанием. Если карточка уже привязана,
// её роль остаётся прежней. Одну и ту же новую карточку дважды не создаём.
export function buildCompletion(
  base: { cardId: string; role: LinkRole | null }[],
  picked: Picked[],
): { newCards: NewCard[]; links: CompleteLink[] } {
  const links: CompleteLink[] = base.map((b) => ({ cardId: b.cardId, role: b.role }))
  const have = new Set(base.map((b) => b.cardId))
  const newCards: NewCard[] = []
  for (const p of picked) {
    if ('cardId' in p) {
      if (have.has(p.cardId)) continue
      have.add(p.cardId)
      links.push({ cardId: p.cardId, role: p.role })
    } else {
      const { kind, name } = p.newCard
      let index = newCards.findIndex((c) => c.kind === kind && c.name === name)
      if (index === -1) {
        index = newCards.push({ kind, name }) - 1
        links.push({ newCard: index, role: p.role })
      }
    }
  }
  return { newCards, links }
}

// Оставляет только те выбранные упоминания, чьё «@Имя» осталось в тексте. Если человек выбрал имя,
// а потом стёр его из текста, привязка не нужна.
export function pruneMentions(
  text: string,
  picked: Picked[],
  cards: { id: string; name: string }[],
): Picked[] {
  const created = picked.flatMap((p) =>
    'newCard' in p ? [{ id: `new:${p.newCard.kind}:${p.newCard.name}`, name: p.newCard.name }] : [],
  )
  // Сравниваем по имени: у двух карточек с одним именем «@Имя» в тексте общее
  const present = new Set(
    splitMentions(text, [...cards, ...created])
      .filter((part) => part.cardId !== undefined)
      .map((part) => fold(part.text.slice(1))),
  )
  const nameOf = new Map(cards.map((c) => [c.id, c.name]))
  return picked.filter((p) => {
    const name = 'cardId' in p ? nameOf.get(p.cardId) : p.newCard.name
    return name !== undefined && present.has(fold(name))
  })
}
