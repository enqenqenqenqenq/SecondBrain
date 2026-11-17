import Dexie, { type EntityTable } from 'dexie'
import type { Card, Link, Note } from './types'

export interface SyncRow {
  key: string // например note:ID
  syncedRev: number // какой номер правки уже согласован с Диском
}

interface Setting {
  key: string
  value: unknown
}

export const db = new Dexie('secondbrain') as Dexie & {
  notes: EntityTable<Note, 'id'>
  cards: EntityTable<Card, 'id'>
  links: EntityTable<Link, 'id'>
  settings: EntityTable<Setting, 'key'>
  syncState: EntityTable<SyncRow, 'key'>
}

db.version(1).stores({
  notes: 'id, createdAt, updatedAt, reviewedAt, [event.from+createdAt], *tagIds',
  settings: 'key',
})

// Версия 2: карточки людей и мест и связи. Старые таблицы не менялись, миграции данных не нужно.
db.version(2).stores({
  cards: 'id, kind, name, updatedAt',
  links: 'id, [ownerType+ownerId], cardId, updatedAt',
})

// Версия 3: индекс по conflictOf, чтобы быстро находить копии записи при конфликте. Данные не меняются.
db.version(3).stores({
  notes: 'id, createdAt, updatedAt, reviewedAt, [event.from+createdAt], *tagIds, conflictOf',
})

// Версия 4: что из местных данных уже согласовано с Диском. Нужна синхронизации, данные не меняются.
db.version(4).stores({
  syncState: 'key',
})

// Идентификатор этого устройства. Создаётся один раз и хранится только здесь.
export function getDeviceId(): Promise<string> {
  return db.transaction('rw', db.settings, async () => {
    const found = await db.settings.get('deviceId')
    if (typeof found?.value === 'string') return found.value
    const id = crypto.randomUUID()
    await db.settings.put({ key: 'deviceId', value: id })
    return id
  })
}
