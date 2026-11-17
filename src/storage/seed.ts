import { db, getDeviceId } from './db'
import {
  dayEvent,
  minuteEvent,
  monthEvent,
  rangeEvent,
  seasonEvent,
  yearEvent,
  type Season,
} from './fuzzyTime'
import type { EventTime, Note, Precision } from './types'

// Тестовые записи помечаются, чтобы их можно было убрать, не задев настоящие
export const SEED_TAG = 'test-data'

const WORDS = (
  'встреча идея купить позвонить работа проект кофе вечер парк книга фильм врач документ билет ' +
  'поездка лето зима весна осень подарок магазин адрес план задача срок вопрос ответ письмо ссылка ' +
  'статья музыка маршрут дорога ремонт ёлка всё ещё учёба зачёт выставка прогулка завтрак дела ' +
  'договорились напомнить обсудить записаться забрать отправить проверить решить'
).split(' ')

// Доли точностей: чаще всего минуты и дни, реже приблизительное время
const PRECISION_WEIGHTS: [Precision, number][] = [
  ['minute', 50],
  ['day', 20],
  ['month', 10],
  ['season', 8],
  ['year', 8],
  ['range', 4],
]

// Небольшой генератор случайных чисел с началом: одно и то же начало даёт одни и те же данные
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seasonOf(date: Date): { year: number; season: Season } {
  const month = date.getMonth() + 1
  const year = date.getFullYear()
  if (month === 12) return { year: year + 1, season: 'winter' }
  if (month <= 2) return { year, season: 'winter' }
  if (month <= 5) return { year, season: 'spring' }
  if (month <= 8) return { year, season: 'summer' }
  return { year, season: 'autumn' }
}

export interface SeedOptions {
  seed?: number
  now?: Date
  years?: number
  deviceId?: string
}

// Записи за несколько лет с разной точностью времени. Ничего не пишет в базу.
export function generateNotes(count: number, options: SeedOptions = {}): Note[] {
  const { seed = 1, now = new Date(), years = 6, deviceId = 'seed-device' } = options
  const rnd = mulberry32(seed)
  const pick = <T>(items: T[]) => items[Math.floor(rnd() * items.length)]
  const total = PRECISION_WEIGHTS.reduce((sum, [, w]) => sum + w, 0)
  const spanMs = years * 365 * 24 * 3600 * 1000
  const notes: Note[] = []

  for (let i = 0; i < count; i++) {
    let roll = rnd() * total
    const precision = PRECISION_WEIGHTS.find(([, w]) => (roll -= w) < 0)![0]
    const when = new Date(now.getTime() - rnd() * spanMs)
    const y = when.getFullYear()
    const m = when.getMonth() + 1

    let event: EventTime
    switch (precision) {
      case 'minute':
        event = minuteEvent(y, m, when.getDate(), when.getHours(), when.getMinutes())
        break
      case 'day':
        event = dayEvent(y, m, when.getDate())
        break
      case 'month':
        event = monthEvent(y, m)
        break
      case 'season': {
        const s = seasonOf(when)
        event = seasonEvent(s.year, s.season)
        break
      }
      case 'year':
        event = yearEvent(y)
        break
      default:
        // Начало диапазона не уходит глубже заданного окна лет
        event = rangeEvent(
          Math.max(y - 1 - Math.floor(rnd() * 3), Math.min(now.getFullYear() - years, y)),
          y,
        )
    }

    // Записи длиной от нескольких слов до абзаца, у некоторых есть переносы строк
    const long = rnd() < 0.1
    const length = 3 + Math.floor(rnd() * (long ? 80 : 14))
    let text = Array.from({ length }, () => pick(WORDS)).join(' ')
    if (length > 12 && rnd() < 0.3) {
      const cut = text.indexOf(' ', Math.floor(text.length / 2))
      if (cut > 0) text = `${text.slice(0, cut)}\n${text.slice(cut + 1)}`
    }
    text = text[0].toUpperCase() + text.slice(1)

    // Точная запись сохранена тогда же, а приблизительное время вспомнили позже
    const createdAt =
      precision === 'minute'
        ? when.getTime()
        : when.getTime() + rnd() * (now.getTime() - when.getTime())

    notes.push({
      id: crypto.randomUUID(),
      text,
      event,
      timeIsAuto: precision === 'minute' && rnd() < 0.5,
      reviewedAt: rnd() < 0.3 ? Math.round(createdAt) : null,
      tagIds: [SEED_TAG],
      createdAt: Math.round(createdAt),
      updatedAt: Math.round(createdAt),
      rev: 1,
      deviceId,
      deletedAt: null,
    })
  }
  return notes
}

// Создаёт тестовые записи в базе. Возвращает, сколько добавлено.
export async function seedNotes(count: number, options: Omit<SeedOptions, 'deviceId'> = {}) {
  const notes = generateNotes(count, { ...options, deviceId: await getDeviceId() })
  await db.notes.bulkAdd(notes)
  return notes.length
}

// Стирает только тестовые записи, настоящие остаются. Возвращает, сколько стёрто.
export function removeSeededNotes(): Promise<number> {
  return db.notes.where('tagIds').equals(SEED_TAG).delete()
}
