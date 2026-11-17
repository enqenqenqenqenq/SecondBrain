import { liveQuery } from 'dexie'
import { bumpClock } from './clock'
import { db, getDeviceId } from './db'
import type { Note } from './types'

// Копии записей, появившиеся при конфликте синхронизации, и их разбор человеком. Разбор это обычные
// правка и удаление: другие устройства получают их как любые другие изменения, особых правил нет.

export type ConflictChoice =
  | 'both' // оставить обе записи: копия становится обычной записью
  | 'copy' // оставить эту копию, а запись, из которой она получилась, убрать
  | 'original' // оставить запись, а эту копию убрать

// Живые копии при конфликте для записи, в порядке создания
export async function listConflictCopies(noteId: string): Promise<Note[]> {
  const copies = await db.notes.where('conflictOf').equals(noteId).toArray()
  return copies.filter((n) => n.deletedAt === null).sort((a, b) => a.createdAt - b.createdAt)
}

export function watchConflictCopies(
  noteId: string,
  onChange: (copies: Note[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  const subscription = liveQuery(() => listConflictCopies(noteId)).subscribe({
    next: onChange,
    error: onError,
  })
  return () => subscription.unsubscribe()
}

// Разбирает копию. Возвращает номер записи, которая осталась, чтобы экран мог на неё перейти.
export async function resolveConflict(
  copyId: string,
  choice: ConflictChoice,
): Promise<{ keptId: string }> {
  const deviceId = await getDeviceId()
  return db.transaction('rw', db.notes, async () => {
    const copy = await db.notes.get(copyId)
    if (!copy || copy.deletedAt !== null || !copy.conflictOf) {
      throw new Error('Это не копия при конфликте')
    }
    const original = await db.notes.get(copy.conflictOf)
    const originalAlive = original !== undefined && original.deletedAt === null
    const now = Date.now()
    const touch = (n: Note, changes: Partial<Note>): Note => ({
      ...n,
      ...changes,
      updatedAt: now,
      rev: n.rev + 1,
      clock: bumpClock(n.clock, deviceId),
      deviceId,
    })

    if (choice === 'original') {
      if (!original || !originalAlive)
        throw new Error('Записи, из которой получилась копия, уже нет')
      await db.notes.put(touch(copy, { deletedAt: now }))
      return { keptId: original.id }
    }
    if (choice === 'copy' && original && originalAlive) {
      await db.notes.put(touch(original, { deletedAt: now }))
    }
    await db.notes.put(touch(copy, { conflictOf: null }))
    return { keptId: copy.id }
  })
}
