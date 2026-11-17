import { matches } from './search'
import { isUnreviewed } from './storage'
import type { EventTime, Note } from './storage'

export interface FeedFilters {
  words: string[] // слова поиска, пусто значит без поиска
  unreviewed: boolean // только неразобранные
  period: EventTime | null // только записи, чьё время пересекается с периодом
  // Записи выбранных людей и мест: по набору номеров на каждую выбранную карточку. Запись должна быть в каждом.
  linked: ReadonlySet<string>[]
}

// Периоды пересекаются, если один начался не позже конца другого и закончился не раньше его начала.
// Границы входят: запись ровно на стыке периода попадает в период. Строки времени одной длины,
// поэтому сравнивать их можно как текст.
export function overlaps(a: EventTime, b: EventTime): boolean {
  return a.from <= b.to && a.to >= b.from
}

export function hasFilters(filters: FeedFilters): boolean {
  return (
    filters.words.length > 0 ||
    filters.unreviewed ||
    filters.period !== null ||
    filters.linked.length > 0
  )
}

// Фильтры работают вместе: запись должна подходить под каждый включённый. Дешёвые проверки идут
// первыми, поиск по тексту последним.
export function filterNotes(
  notes: Note[],
  filters: FeedFilters,
  foldedTextOf: (note: Note) => string,
): Note[] {
  if (!hasFilters(filters)) return notes
  const { words, unreviewed, period, linked } = filters
  return notes.filter(
    (note) =>
      (!unreviewed || isUnreviewed(note)) &&
      (!period || overlaps(note.event, period)) &&
      linked.every((ids) => ids.has(note.id)) &&
      (words.length === 0 || matches(foldedTextOf(note), words)),
  )
}
