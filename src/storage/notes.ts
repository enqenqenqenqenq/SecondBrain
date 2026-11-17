import { liveQuery } from 'dexie'
import { db, getDeviceId } from './db'
import { eventAt } from './time'
import type { ListOptions, Note, NotePatch } from './types'

function cleanText(text: string): string {
  const value = text.trim()
  if (!value) throw new Error('Текст записи не может быть пустым')
  return value
}

export async function createNote(text: string, event?: Note['event']): Promise<Note> {
  const value = cleanText(text)
  const now = Date.now()
  const note: Note = {
    id: crypto.randomUUID(),
    text: value,
    event: event ?? eventAt(new Date(now)),
    timeIsAuto: event === undefined,
    reviewedAt: null,
    tagIds: [],
    createdAt: now,
    updatedAt: now,
    rev: 1,
    deviceId: await getDeviceId(),
    deletedAt: null,
  }
  await db.notes.add(note)
  return note
}

export async function getNote(id: string): Promise<Note | undefined> {
  const note = await db.notes.get(id)
  return note && note.deletedAt === null ? note : undefined
}

// Записи от новых к старым: по времени события, при равенстве по времени сохранения
export function listNotes({ limit, offset }: ListOptions = {}): Promise<Note[]> {
  let query = db.notes
    .orderBy('[event.from+createdAt]')
    .reverse()
    .filter((n) => n.deletedAt === null)
  if (offset) query = query.offset(offset)
  if (limit !== undefined) query = query.limit(limit)
  return query.toArray()
}

export async function countNotes(): Promise<number> {
  return db.notes.filter((n) => n.deletedAt === null).count()
}

async function touch(id: string, change: (n: Note) => Partial<Note>): Promise<Note | undefined> {
  const deviceId = await getDeviceId()
  return db.transaction('rw', db.notes, async () => {
    const current = await db.notes.get(id)
    if (!current) return undefined
    const next: Note = {
      ...current,
      ...change(current),
      updatedAt: Date.now(),
      rev: current.rev + 1,
      deviceId,
    }
    await db.notes.put(next)
    return next
  })
}

export async function updateNote(id: string, patch: NotePatch): Promise<Note | undefined> {
  const text = patch.text === undefined ? undefined : cleanText(patch.text)
  const existing = await getNote(id)
  if (!existing) return undefined
  // Пустое изменение не считается правкой: лишний номер правки только засорил бы синхронизацию
  if (Object.values(patch).every((value) => value === undefined)) return existing
  return touch(id, () => ({
    ...(text !== undefined && { text }),
    ...(patch.event !== undefined && { event: patch.event, timeIsAuto: false }),
    ...(patch.tagIds !== undefined && { tagIds: patch.tagIds }),
    ...(patch.reviewedAt !== undefined && { reviewedAt: patch.reviewedAt }),
  }))
}

// Мягкое удаление: запись остаётся в базе, чтобы другое устройство узнало об удалении
export async function deleteNote(id: string): Promise<boolean> {
  const existing = await getNote(id)
  if (!existing) return false
  await touch(id, () => ({ deletedAt: Date.now() }))
  return true
}

// Отмена удаления
export async function restoreNote(id: string): Promise<boolean> {
  const current = await db.notes.get(id)
  if (!current || current.deletedAt === null) return false
  await touch(id, () => ({ deletedAt: null }))
  return true
}

// Следит за записями: сообщает полный список сразу и после каждого изменения, в том числе из другой вкладки
export function watchNotes(
  onChange: (notes: Note[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  const subscription = liveQuery(() => listNotes()).subscribe({ next: onChange, error: onError })
  return () => subscription.unsubscribe()
}
