import { dayEvent, minuteEvent, monthEvent, rangeEvent, seasonEvent, yearEvent } from './storage'
import type { EventTime, Precision, Season } from './storage'

// Всё, что человек вводит в окне «Время и точность». Поля общие для разных точностей,
// поэтому при смене точности введённое значение (например год) не теряется.
export interface TimeDraft {
  precision: Precision
  date: string // 2026-11-17
  time: string // 14:05
  month: number
  year: number
  season: Season
  fromYear: number
  toYear: number
}

export const PRECISIONS: { value: Precision; label: string }[] = [
  { value: 'minute', label: 'Минута' },
  { value: 'day', label: 'День' },
  { value: 'month', label: 'Месяц' },
  { value: 'season', label: 'Сезон' },
  { value: 'year', label: 'Год' },
  { value: 'range', label: 'Годы' },
]

export const SEASONS: { value: Season; label: string }[] = [
  { value: 'winter', label: 'Зима' },
  { value: 'spring', label: 'Весна' },
  { value: 'summer', label: 'Лето' },
  { value: 'autumn', label: 'Осень' },
]

export const MONTH_NAMES = [
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

const SEASON_BY_START_MONTH: Record<number, Season> = {
  12: 'winter',
  3: 'spring',
  6: 'summer',
  9: 'autumn',
}

function seasonOfMonth(month: number): Season {
  if (month === 12 || month <= 2) return 'winter'
  if (month <= 5) return 'spring'
  if (month <= 8) return 'summer'
  return 'autumn'
}

export function draftFromEvent(event: EventTime): TimeDraft {
  const [date, time = '00:00'] = event.from.split('T')
  const [fromYear, month] = date.split('-').map(Number)
  const toYear = Number(event.to.slice(0, 4))
  const isSeason = event.precision === 'season'
  const season = isSeason ? (SEASON_BY_START_MONTH[month] ?? 'summer') : seasonOfMonth(month)
  // Зима года N начинается в декабре N-1, поэтому подписью берём год конца периода
  const year = isSeason && season === 'winter' ? fromYear + 1 : fromYear
  return {
    precision: event.precision,
    date,
    time,
    month,
    year,
    season,
    fromYear,
    toYear: event.precision === 'range' ? toYear : fromYear,
  }
}

// Собирает время события из введённого. Если ввод неполный или невозможный, возвращает пусто.
export function eventFromDraft(draft: TimeDraft): EventTime | null {
  try {
    switch (draft.precision) {
      case 'minute': {
        const [y, m, d] = draft.date.split('-').map(Number)
        const [hh, mm] = draft.time.split(':').map(Number)
        return minuteEvent(y, m, d, hh, mm)
      }
      case 'day': {
        const [y, m, d] = draft.date.split('-').map(Number)
        return dayEvent(y, m, d)
      }
      case 'month':
        return monthEvent(draft.year, draft.month)
      case 'season':
        return seasonEvent(draft.year, draft.season)
      case 'year':
        return yearEvent(draft.year)
      case 'range':
        return rangeEvent(draft.fromYear, draft.toYear)
    }
  } catch {
    return null
  }
}

// При смене точности общий год берём из уже введённого, чтобы не вводить его заново
export function changePrecision(draft: TimeDraft, precision: Precision): TimeDraft {
  const year = Number(draft.date.slice(0, 4)) || draft.year
  if (precision === 'minute' || precision === 'day') return { ...draft, precision }
  if (draft.precision === 'minute' || draft.precision === 'day') {
    return { ...draft, precision, year, month: Number(draft.date.slice(5, 7)) || draft.month }
  }
  return { ...draft, precision }
}
