import { bumpClock, compareClocks, mergeClocks } from './clock'
import { idFromKey } from './ids'
import type { Clock } from './clock'
import type { Note } from './types'

// Разбор расхождений между этим устройством и тем, что пришло с другого. Чистые функции без базы:
// движок синхронизации вызывает их для каждого пришедшего объекта и сам записывает результат.

// Всё, что нужно для слияния у любого синхронизируемого объекта
export interface Syncable {
  id: string
  createdAt: number
  updatedAt: number
  rev: number
  clock?: Clock
  deviceId: string
  deletedAt: number | null
}

export type MergeResult<T> =
  // Пришедшее уже учтено или старее: ничего не делаем
  | { action: 'skip' }
  // Записать пришедшее как есть. Номер правки согласован с Диском, отправлять не нужно
  | { action: 'apply'; object: T }
  // Правили независимо. object это итог (его надо записать и отправить), copy проигравшая версия,
  // если её надо сохранить отдельной записью (тоже отправить)
  | { action: 'conflict'; object: T; copy: T | null }

// Что считается содержимым при сравнении: всё, кроме служебных полей правки. Два удалённых объекта
// одинаковы, что бы в них ни осталось.
export function sameContent(a: Syncable, b: Syncable): boolean {
  if (a.deletedAt !== null && b.deletedAt !== null) return true
  if ((a.deletedAt === null) !== (b.deletedAt === null)) return false
  const comparable = (o: Syncable) => {
    const copy: Record<string, unknown> = { ...o }
    for (const key of ['rev', 'clock', 'updatedAt', 'deviceId']) delete copy[key]
    // Копия, которую уже разобрали (null), и обычная запись (нет поля) одно и то же
    if (copy.conflictOf === null) delete copy.conflictOf
    return JSON.stringify(sortKeys(copy))
  }
  return comparable(a) === comparable(b)
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    )
  }
  return value
}

// Победитель при конфликте. Больше updatedAt, при равенстве больше rev, потом больше deviceId.
// Результат один и тот же на любом устройстве, поэтому устройства выбирают одинаково без переговоров.
export function pickWinner<T extends Syncable>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  if (a.rev !== b.rev) return a.rev > b.rev ? a : b
  return a.deviceId >= b.deviceId ? a : b
}

// Копия проигравшей версии записи. Идентификатор считается из содержимого проигравшей версии, а все остальные
// поля у копии постоянные. Поэтому любое устройство, в каком бы порядке оно ни получало чужие версии, строит
// одну и ту же копию, и дублей не бывает. Время создания и правки берутся у проигравшей версии: итоги
// конфликта их не меняют, они остаются от настоящей правки.
export const COPY_DEVICE = 'conflict'

export async function conflictCopy(loser: Note): Promise<Note> {
  const content = JSON.stringify(
    sortKeys({
      text: loser.text,
      event: loser.event,
      timeIsAuto: loser.timeIsAuto,
      tagIds: loser.tagIds,
    }),
  )
  return {
    id: await idFromKey(`conflict:${loser.conflictOf ?? loser.id}:${content}`),
    text: loser.text,
    event: loser.event,
    timeIsAuto: loser.timeIsAuto,
    reviewedAt: null,
    tagIds: loser.tagIds,
    createdAt: loser.createdAt,
    updatedAt: loser.updatedAt,
    rev: 1,
    clock: { [COPY_DEVICE]: 1 },
    deviceId: COPY_DEVICE,
    deletedAt: null,
    conflictOf: loser.conflictOf ?? loser.id,
  }
}

// Применяет пришедший объект к местному. own это идентификатор этого устройства. Для записей на конфликте
// создаётся копия проигравшей, для остальных сущностей проигравшая версия не сохраняется (makeCopy не задан).
export async function mergeObject<T extends Syncable>(
  local: T | undefined,
  remote: T,
  own: string,
  makeCopy?: (loser: T) => Promise<T>,
): Promise<MergeResult<T>> {
  if (!local) return { action: 'apply', object: remote }

  const order = compareClocks(remote.clock, local.clock)
  if (order === 'equal' || order === 'before') return { action: 'skip' }
  // Пришедшее включает в себя всё, что было у нас
  if (order === 'after') return { action: 'apply', object: remote }

  // Правили независимо. Если получилось одно и то же, это не конфликт. Два удалённых объекта тоже считаются
  // одним и тем же: остаток текста у удалённого ни на что не влияет, а при возвращении запись станет новой
  // правкой и пройдёт обычные правила.
  if (sameContent(local, remote)) {
    return {
      action: 'apply',
      object: {
        ...remote,
        clock: mergeClocks(local.clock, remote.clock),
        rev: Math.max(local.rev, remote.rev),
      },
    }
  }

  const winner = pickWinner(local, remote)
  const loser = winner === local ? remote : local
  // Итог получает версии обеих сторон и ещё одну правку этого устройства. Поэтому он новее каждой
  // из них и принимается всеми без повторного конфликта.
  const object: T = {
    ...winner,
    clock: bumpClock(mergeClocks(local.clock, remote.clock), own),
    rev: Math.max(local.rev, remote.rev) + 1,
    deviceId: own,
  }
  // Проигравшая живая версия не должна пропасть. Удаление копировать нечего.
  const copy = makeCopy && loser.deletedAt === null ? await makeCopy(loser) : null
  return { action: 'conflict', object, copy }
}

export const mergeNote = (local: Note | undefined, remote: Note, own: string) =>
  mergeObject(local, remote, own, conflictCopy)
