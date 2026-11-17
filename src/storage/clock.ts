// Векторные часы объекта: для каждого устройства число правок, сделанных им. Они отвечают на вопрос,
// который не решают ни номер правки rev, ни время: «эта версия получилась из той или они правились
// независимо друг от друга». Время и номера для этого не годятся: часы телефона бывают неверными,
// а номер правки одинаков у двух независимых версий.
export type Clock = Record<string, number>

// Правка на этом устройстве
export function bumpClock(clock: Clock | undefined, deviceId: string): Clock {
  return { ...clock, [deviceId]: (clock?.[deviceId] ?? 0) + 1 }
}

// Объединение: по каждому устройству берётся большее число
export function mergeClocks(a: Clock | undefined, b: Clock | undefined): Clock {
  const result: Clock = { ...a }
  for (const [id, n] of Object.entries(b ?? {})) {
    if (n > (result[id] ?? 0)) result[id] = n
  }
  return result
}

// Как соотносятся две версии. before: a получилась раньше и уже входит в b. after: b входит в a.
// equal: одна и та же версия. concurrent: правились независимо, у каждой есть то, чего нет у другой.
export type ClockOrder = 'equal' | 'before' | 'after' | 'concurrent'

export function compareClocks(a: Clock | undefined, b: Clock | undefined): ClockOrder {
  let aAhead = false
  let bAhead = false
  for (const id of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const x = a?.[id] ?? 0
    const y = b?.[id] ?? 0
    if (x > y) aAhead = true
    if (y > x) bAhead = true
  }
  if (aAhead && bAhead) return 'concurrent'
  if (aAhead) return 'after'
  if (bAhead) return 'before'
  return 'equal'
}

// Проверка часов, пришедших из файла или с другого устройства: объект с положительными целыми
export function isValidClock(value: unknown): value is Clock {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return (
    entries.length <= 50 &&
    entries.every(([id, n]) => id.length > 0 && id.length <= 100 && Number.isInteger(n) && n >= 1)
  )
}
