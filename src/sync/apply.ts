import { conflictCopy, mergeObject } from '../storage/merge'
import type { Syncable } from '../storage/merge'
import type { Entity } from './types'

// Решение по одному пришедшему объекту. Хранилище (в базе или в памяти) только исполняет его.
export interface Outcome<T> {
  action: 'skip' | 'apply' | 'conflict'
  write: T | null // что записать на место объекта
  copy: T | null // копия проигравшей версии, если нужна
  synced: boolean // согласован ли записанный объект с Диском (иначе его надо отправить)
}

// Правила слияния: см. docs/sync-design.txt и решение 13. Копия при конфликте есть только у записей.
export async function decide<T extends Syncable>(
  entity: Entity,
  local: T | undefined,
  remote: T,
  own: string,
): Promise<Outcome<T>> {
  const makeCopy =
    entity === 'note' ? (conflictCopy as unknown as (loser: T) => Promise<T>) : undefined
  const result = await mergeObject(local, remote, own, makeCopy)
  if (result.action === 'skip') return { action: 'skip', write: null, copy: null, synced: true }
  if (result.action === 'apply')
    return { action: 'apply', write: result.object, copy: null, synced: true }
  // Итог конфликта новее известного Диску, его нужно отправить
  return { action: 'conflict', write: result.object, copy: result.copy, synced: false }
}
