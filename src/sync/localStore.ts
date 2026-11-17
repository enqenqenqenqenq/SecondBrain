import { db, getDeviceId } from '../storage/db'
import type { Syncable } from '../storage/merge'
import { decide } from './apply'
import { emptyMeta } from './types'
import type { ApplyReport, Entity, LocalStore, SyncMeta, SyncObject } from './types'

// Местные данные в базе браузера для движка синхронизации

const ENTITIES: Entity[] = ['note', 'card', 'link']
const META_KEY = 'syncMeta'

// Таблицы разного вида приводим к одному: движку важны только общие поля
const table = (entity: Entity) =>
  ({ note: db.notes, card: db.cards, link: db.links })[entity] as unknown as {
    toArray(): Promise<Syncable[]>
    get(id: string): Promise<Syncable | undefined>
    put(item: Syncable): Promise<unknown>
    add(item: Syncable): Promise<unknown>
  }

const rowKey = (entity: Entity, id: string) => `${entity}:${id}`

const wrap = (entity: Entity, data: Syncable): SyncObject => ({ entity, data }) as SyncObject

async function readAll(entity: Entity): Promise<Syncable[]> {
  return table(entity).toArray()
}

// Пока объект применяется, его могли изменить на этом же устройстве. Тогда решение считаем заново.
const ATTEMPTS = 5

export function dexieLocalStore(): LocalStore {
  return {
    deviceId: getDeviceId,

    async collectDirty() {
      const result: SyncObject[] = []
      for (const entity of ENTITIES) {
        const rows = await readAll(entity)
        const synced = await db.syncState.bulkGet(rows.map((r) => rowKey(entity, r.id)))
        rows.forEach((row, i) => {
          if (row.rev > (synced[i]?.syncedRev ?? 0)) result.push(wrap(entity, row))
        })
      }
      return result
    },

    async markSynced(objects) {
      await db.transaction('rw', db.syncState, async () => {
        const keys = objects.map((o) => rowKey(o.entity, o.data.id))
        const existing = await db.syncState.bulkGet(keys)
        await db.syncState.bulkPut(
          objects.map((o, i) => ({
            key: keys[i],
            syncedRev: Math.max(existing[i]?.syncedRev ?? 0, o.data.rev),
          })),
        )
      })
    },

    async allObjects() {
      const result: SyncObject[] = []
      for (const entity of ENTITIES)
        for (const row of await readAll(entity)) result.push(wrap(entity, row))
      return result
    },

    async applyRemote(objects) {
      const own = await getDeviceId()
      const report: ApplyReport = { applied: 0, skipped: 0, conflicts: 0, invalid: 0 }
      for (const incoming of objects) {
        const t = table(incoming.entity)
        let outcome: 'skip' | 'apply' | 'conflict' | null = null
        for (let attempt = 0; attempt < ATTEMPTS && outcome === null; attempt++) {
          const local = await t.get(incoming.data.id)
          const decision = await decide(incoming.entity, local, incoming.data as Syncable, own)
          if (decision.action === 'skip') {
            outcome = 'skip'
            break
          }
          const written = await db.transaction(
            'rw',
            db.notes,
            db.cards,
            db.links,
            db.syncState,
            async () => {
              const now = await t.get(incoming.data.id)
              // Объект изменился после того, как мы его прочитали: решение устарело
              if (
                now?.rev !== local?.rev ||
                JSON.stringify(now?.clock) !== JSON.stringify(local?.clock)
              ) {
                return false
              }
              await t.put(decision.write!)
              if (decision.synced) {
                await db.syncState.put({
                  key: rowKey(incoming.entity, decision.write!.id),
                  syncedRev: decision.write!.rev,
                })
              }
              // Копия появляется один раз: если такая уже есть (и её могли разобрать), не трогаем
              if (decision.copy && !(await t.get(decision.copy.id))) await t.add(decision.copy)
              return true
            },
          )
          if (written) outcome = decision.action
        }
        if (outcome === null)
          throw new Error('Данные менялись во время синхронизации, повторите позже')
        if (outcome === 'skip') report.skipped++
        else if (outcome === 'conflict') report.conflicts++
        else report.applied++
      }
      return report
    },

    async loadMeta() {
      const row = await db.settings.get(META_KEY)
      return { ...emptyMeta(), ...((row?.value as Partial<SyncMeta> | undefined) ?? {}) }
    },

    async saveMeta(meta) {
      await db.settings.put({ key: META_KEY, value: meta })
    },
  }
}

// Сколько объектов ждёт отправки: для показа на экране
export async function countPending(): Promise<number> {
  return (await dexieLocalStore().collectDirty()).length
}

// Забыть, что согласовано с Диском: всё местное снова считается неотправленным. Нужно при смене хранилища.
export async function forgetSyncState(): Promise<void> {
  await db.transaction('rw', db.syncState, db.settings, async () => {
    await db.syncState.clear()
    await db.settings.delete(META_KEY)
  })
}
