import Dexie, { type EntityTable } from 'dexie'
import type { Note } from './types'

interface Setting {
  key: string
  value: unknown
}

export const db = new Dexie('secondbrain') as Dexie & {
  notes: EntityTable<Note, 'id'>
  settings: EntityTable<Setting, 'key'>
}

db.version(1).stores({
  notes: 'id, createdAt, updatedAt, reviewedAt, [event.from+createdAt], *tagIds',
  settings: 'key',
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
