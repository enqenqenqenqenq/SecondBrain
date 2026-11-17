import { bumpClock } from './clock'
import { db, getDeviceId } from './db'
import { buildCard } from './cards'
import { isValidEvent } from './fuzzyTime'
import { idFromKey } from './ids'
import type { Card, EventTime, Link, LinkRole, NewCard, Note } from './types'

// Одна связь в желаемом итоге: существующая карточка или новая из списка newCards (по номеру).
// Роль не указана: у существующей связи остаётся прежняя, у новой пусто.
export type CompleteLink = { role?: LinkRole | null } & ({ cardId: string } | { newCard: number })

export interface CompleteInput {
  text?: string
  event?: EventTime
  newCards?: NewCard[]
  // Полный список карточек записи после дополнения. Что в нём отсутствует, будет отвязано.
  links: CompleteLink[]
  // Пометить запись дополненной в той же транзакции. Уже помеченная остаётся с прежним временем отметки.
  markReviewed?: boolean
}

export interface CompleteResult {
  note: Note
  createdCards: Card[]
}

const sameEvent = (a: EventTime, b: EventTime) =>
  a.precision === b.precision && a.from === b.from && a.to === b.to

// Дополнение записи одним действием: текст, время и привязки сохраняются вместе или не сохраняются совсем.
// Дополненной запись помечается только по просьбе (markReviewed), иначе отметка остаётся прежней.
export async function completeNote(noteId: string, input: CompleteInput): Promise<CompleteResult> {
  const text = input.text === undefined ? undefined : input.text.trim()
  if (text === '') throw new Error('Текст записи не может быть пустым')
  if (input.event && !isValidEvent(input.event)) throw new Error('Некорректное время события')
  const deviceId = await getDeviceId()
  const now = Date.now()

  const createdCards = (input.newCards ?? []).map((card) => buildCard(card, deviceId, now))
  // Желаемый итог по карточкам. Повтор одной карточки считается одной связью, побеждает последний.
  const wanted = new Map<string, { role: LinkRole | null | undefined }>()
  for (const link of input.links) {
    let cardId: string
    if ('cardId' in link) {
      cardId = link.cardId
    } else {
      const created = createdCards[link.newCard]
      if (!created) throw new Error('Новая карточка не найдена')
      cardId = created.id
    }
    wanted.set(cardId, { role: link.role })
  }
  const linkIds = new Map<string, string>()
  for (const cardId of wanted.keys()) {
    linkIds.set(cardId, await idFromKey(`link:note:${noteId}:${cardId}`))
  }

  return db.transaction('rw', db.notes, db.cards, db.links, async () => {
    const note = await db.notes.get(noteId)
    if (!note || note.deletedAt !== null) throw new Error('Запись не найдена')

    const kinds = new Map<string, Card['kind']>(createdCards.map((c) => [c.id, c.kind]))
    const existingIds = [...wanted.keys()].filter((id) => !kinds.has(id))
    const found = await db.cards.bulkGet(existingIds)
    existingIds.forEach((id, i) => {
      const card = found[i]
      if (!card || card.deletedAt !== null) throw new Error('Карточка не найдена')
      kinds.set(id, card.kind)
    })
    for (const [cardId, { role }] of wanted) {
      if (role && kinds.get(cardId) === 'place') {
        throw new Error('Роль бывает только у связи с человеком')
      }
    }

    // Связи
    const current = await db.links
      .where('[ownerType+ownerId]')
      .equals(['note', noteId])
      .filter((l) => l.deletedAt === null)
      .toArray()
    const touched: Link[] = []
    for (const link of current) {
      if (!wanted.has(link.cardId)) {
        touched.push({
          ...link,
          deletedAt: now,
          updatedAt: now,
          rev: link.rev + 1,
          clock: bumpClock(link.clock, deviceId),
          deviceId,
        })
      }
    }
    const stored = await db.links.bulkGet([...linkIds.values()])
    // Новые связи получают время по порядку списка, чтобы метки на карточке шли в том порядке, как их добавили
    let order = 0
    ;[...wanted.entries()].forEach(([cardId, { role }], i) => {
      const id = linkIds.get(cardId)!
      const link = stored[i]
      if (!link) {
        touched.push({
          id,
          ownerType: 'note',
          ownerId: noteId,
          cardId,
          role: role ?? null,
          createdAt: now + order++,
          updatedAt: now,
          rev: 1,
          clock: bumpClock(undefined, deviceId),
          deviceId,
          deletedAt: null,
        })
        return
      }
      const alive = link.deletedAt === null
      const nextRole = role === undefined && alive ? link.role : (role ?? null)
      if (alive && nextRole === link.role) return
      touched.push({
        ...link,
        role: nextRole,
        deletedAt: null,
        updatedAt: now,
        rev: link.rev + 1,
        clock: bumpClock(link.clock, deviceId),
        deviceId,
      })
    })

    // Запись
    const textChanged = text !== undefined && text !== note.text
    const eventChanged = input.event !== undefined && !sameEvent(input.event, note.event)
    const marked = input.markReviewed === true && note.reviewedAt === null
    let result = note
    if (textChanged || eventChanged || marked) {
      result = {
        ...note,
        ...(textChanged && { text }),
        ...(eventChanged && { event: input.event, timeIsAuto: false }),
        ...(marked && { reviewedAt: now }),
        updatedAt: now,
        rev: note.rev + 1,
        clock: bumpClock(note.clock, deviceId),
        deviceId,
      }
      await db.notes.put(result)
    }
    await db.cards.bulkAdd(createdCards)
    await db.links.bulkPut(touched)
    return { note: result, createdCards }
  })
}
