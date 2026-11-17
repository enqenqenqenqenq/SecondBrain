import { isValidEvent } from './fuzzyTime'
import type { EventTime } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

// Местное время с точностью до минуты, например 2026-11-17T13:45
export function formatMinute(date: Date): string {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${d}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Время события для обычной записи: момент сохранения
export function eventAt(date: Date = new Date()): EventTime {
  const s = formatMinute(date)
  return { precision: 'minute', from: s, to: s }
}

export const MONTHS_OF = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]
const MONTHS_NAME = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
]
// Сезон определяется по месяцу начала периода
const SEASONS: Record<number, string> = { 12: 'зима', 3: 'весна', 6: 'лето', 9: 'осень' }

function parts(s: string) {
  const [date, time = '00:00'] = s.split('T')
  const [y, m, d] = date.split('-').map(Number)
  return { y, m, d, time }
}

function spokenDay(p: ReturnType<typeof parts>, now: Date): string {
  const same = (date: Date) =>
    date.getFullYear() === p.y && date.getMonth() + 1 === p.m && date.getDate() === p.d
  if (same(now)) return 'Сегодня'
  if (same(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Вчера'
  const year = p.y === now.getFullYear() ? '' : ` ${p.y}`
  return `${p.d} ${MONTHS_OF[p.m - 1]}${year}`
}

// Время события словами, с учётом точности
export function describeEvent(event: EventTime, now: Date = new Date()): string {
  // Испорченное время не должно ломать ленту и показывать «undefined»
  if (!isValidEvent(event)) return 'Время не указано'
  const from = parts(event.from)
  const to = parts(event.to)
  switch (event.precision) {
    case 'minute':
      return `${spokenDay(from, now)}, ${from.time}`
    case 'day':
      return spokenDay(from, now)
    case 'month':
      return `${MONTHS_NAME[from.m - 1]} ${from.y}`
    case 'season':
      return `${SEASONS[from.m] ?? 'сезон'} ${to.y}`
    case 'year':
      return `${from.y} год`
    case 'range':
      return from.y === to.y ? `${from.y} год` : `с ${from.y} по ${to.y} год`
  }
}
