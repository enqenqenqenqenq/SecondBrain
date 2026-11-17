import { liveQuery } from 'dexie'
import { db, getDeviceId } from './db'
import { idFromKey } from './ids'
import type { Card, Link, LinkRole, ListOptions, Note } from './types'

export interface CardOfNote {
  card: Card
  role: LinkRole | null
}

const isRole = (value: unknown): value is LinkRole => value === 'with' || value === 'mentioned'

// Связь записи с карточкой. Для пары запись и карточка живая связь одна: у неё id из хеша пары,
// поэтому повторное связывание обновляет её, а связь, созданная на двух устройствах, не дублируется.
// Роль не указана: у новой связи пусто, у существующей остаётся прежняя. Роль null сбрасывает её.
export async function linkNote(
  noteId: string,
  cardId: string,
  role?: LinkRole | null,
): Promise<Link> {
  if (role !== undefined && role !== null && !isRole(role))
    throw new Error('Неизвестная роль связи')
  const id = await idFromKey(`link:note:${noteId}:${cardId}`)
  const deviceId = await getDeviceId()
  return db.transaction('rw', db.notes, db.cards, db.links, async () => {
    const note = await db.notes.get(noteId)
    if (!note || note.deletedAt !== null) throw new Error('Запись не найдена')
    const card = await db.cards.get(cardId)
    if (!card || card.deletedAt !== null) throw new Error('Карточка не найдена')
    if (card.kind === 'place' && role) throw new Error('Роль бывает только у связи с человеком')

    const now = Date.now()
    const existing = await db.links.get(id)
    if (!existing) {
      const link: Link = {
        id,
        ownerType: 'note',
        ownerId: noteId,
        cardId,
        role: role ?? null,
        createdAt: now,
        updatedAt: now,
        rev: 1,
        deviceId,
        deletedAt: null,
      }
      await db.links.add(link)
      return link
    }
    const nextRole =
      role === undefined && existing.deletedAt === null ? existing.role : (role ?? null)
    if (existing.deletedAt === null && nextRole === existing.role) return existing
    const link: Link = {
      ...existing,
      role: nextRole,
      deletedAt: null,
      updatedAt: now,
      rev: existing.rev + 1,
      deviceId,
    }
    await db.links.put(link)
    return link
  })
}

// Убирает связь. Запись и карточка остаются
export async function unlinkNote(noteId: string, cardId: string): Promise<boolean> {
  const id = await idFromKey(`link:note:${noteId}:${cardId}`)
  const deviceId = await getDeviceId()
  return db.transaction('rw', db.links, async () => {
    const existing = await db.links.get(id)
    if (!existing || existing.deletedAt !== null) return false
    const at = Date.now()
    await db.links.put({
      ...existing,
      deletedAt: at,
      updatedAt: at,
      rev: existing.rev + 1,
      deviceId,
    })
    return true
  })
}

// Карточки записи в порядке связывания. Удалённые карточки не показываются
export async function listCardsOfNote(noteId: string): Promise<CardOfNote[]> {
  const links = (await db.links.where('[ownerType+ownerId]').equals(['note', noteId]).toArray())
    .filter((l) => l.deletedAt === null)
    .sort((a, b) => a.createdAt - b.createdAt)
  const cards = await db.cards.bulkGet(links.map((l) => l.cardId))
  const result: CardOfNote[] = []
  links.forEach((link, i) => {
    const card = cards[i]
    if (card && card.deletedAt === null) result.push({ card, role: link.role })
  })
  return result
}

// Записи карточки в порядке ленты: от новых к старым по времени события, при равенстве по времени сохранения
export async function listNotesOfCard(
  cardId: string,
  { limit, offset }: ListOptions = {},
): Promise<Note[]> {
  const links = await db.links
    .where('cardId')
    .equals(cardId)
    .filter((l) => l.deletedAt === null && l.ownerType === 'note')
    .toArray()
  const found = await db.notes.bulkGet(links.map((l) => l.ownerId))
  const notes = found
    .filter((n): n is Note => n !== undefined && n.deletedAt === null)
    .sort((a, b) =>
      a.event.from === b.event.from
        ? b.createdAt - a.createdAt
        : a.event.from < b.event.from
          ? 1
          : -1,
    )
  const start = offset ?? 0
  return notes.slice(start, limit === undefined ? undefined : start + limit)
}

export async function countNotesOfCard(cardId: string): Promise<number> {
  return (await listNotesOfCard(cardId)).length
}

export function watchCardsOfNote(
  noteId: string,
  onChange: (cards: CardOfNote[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  const subscription = liveQuery(() => listCardsOfNote(noteId)).subscribe({
    next: onChange,
    error: onError,
  })
  return () => subscription.unsubscribe()
}

export function watchNotesOfCard(
  cardId: string,
  onChange: (notes: Note[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  const subscription = liveQuery(() => listNotesOfCard(cardId)).subscribe({
    next: onChange,
    error: onError,
  })
  return () => subscription.unsubscribe()
}
