import type { EventTime } from './types'

export type Season = 'winter' | 'spring' | 'summer' | 'autumn'

const pad2 = (n: number) => String(n).padStart(2, '0')
const pad4 = (n: number) => String(n).padStart(4, '0')

export const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new RangeError(message)
}

function checkYear(year: number) {
  check(Number.isInteger(year) && year >= 1 && year <= 9999, `Год вне границ: ${year}`)
}

function checkMonth(year: number, month: number) {
  checkYear(year)
  check(Number.isInteger(month) && month >= 1 && month <= 12, `Месяц вне границ: ${month}`)
}

function checkDay(year: number, month: number, day: number) {
  checkMonth(year, month)
  check(
    Number.isInteger(day) && day >= 1 && day <= daysInMonth(year, month),
    `В этом месяце нет дня ${day}`,
  )
}

// Строка вида 2024-06-01T00:00, одной длины для любого времени
const stamp = (y: number, m: number, d: number, hh = 0, mm = 0) =>
  `${pad4(y)}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}`

export function minuteEvent(y: number, m: number, d: number, hh: number, mm: number): EventTime {
  checkDay(y, m, d)
  check(Number.isInteger(hh) && hh >= 0 && hh <= 23, `Час вне границ: ${hh}`)
  check(Number.isInteger(mm) && mm >= 0 && mm <= 59, `Минута вне границ: ${mm}`)
  const at = stamp(y, m, d, hh, mm)
  return { precision: 'minute', from: at, to: at }
}

export function dayEvent(y: number, m: number, d: number): EventTime {
  checkDay(y, m, d)
  return { precision: 'day', from: stamp(y, m, d), to: stamp(y, m, d, 23, 59) }
}

export function monthEvent(y: number, m: number): EventTime {
  checkMonth(y, m)
  return { precision: 'month', from: stamp(y, m, 1), to: stamp(y, m, daysInMonth(y, m), 23, 59) }
}

// Зима года N это декабрь N-1, январь и февраль N. Остальные сезоны лежат внутри года.
export function seasonEvent(year: number, season: Season): EventTime {
  checkYear(year)
  if (season === 'winter') {
    check(year >= 2, `Год вне границ: ${year}`)
    return {
      precision: 'season',
      from: stamp(year - 1, 12, 1),
      to: stamp(year, 2, daysInMonth(year, 2), 23, 59),
    }
  }
  const [first, last] = { spring: [3, 5], summer: [6, 8], autumn: [9, 11] }[season]
  return {
    precision: 'season',
    from: stamp(year, first, 1),
    to: stamp(year, last, daysInMonth(year, last), 23, 59),
  }
}

export function yearEvent(year: number): EventTime {
  checkYear(year)
  return { precision: 'year', from: stamp(year, 1, 1), to: stamp(year, 12, 31, 23, 59) }
}

export function rangeEvent(fromYear: number, toYear: number): EventTime {
  checkYear(fromYear)
  checkYear(toYear)
  check(fromYear <= toYear, 'Начало диапазона позже конца')
  return { precision: 'range', from: stamp(fromYear, 1, 1), to: stamp(toYear, 12, 31, 23, 59) }
}

const FORMAT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

function parse(s: string): [number, number, number, number, number] | null {
  const match = FORMAT.exec(s)
  if (!match) return null
  return match.slice(1).map(Number) as [number, number, number, number, number]
}

const SEASON_BY_START_MONTH: Record<number, Season> = {
  12: 'winter',
  3: 'spring',
  6: 'summer',
  9: 'autumn',
}

// Время события целое и согласованное: строки нужного вида, точность совпадает с границами периода.
// Проверяется собранием ожидаемого значения тем же способом, которым оно создаётся.
export function isValidEvent(event: EventTime): boolean {
  const from = parse(event.from)
  const to = parse(event.to)
  if (!from || !to || event.from > event.to) return false
  try {
    let expected: EventTime
    switch (event.precision) {
      case 'minute':
        expected = minuteEvent(from[0], from[1], from[2], from[3], from[4])
        break
      case 'day':
        expected = dayEvent(from[0], from[1], from[2])
        break
      case 'month':
        expected = monthEvent(from[0], from[1])
        break
      case 'season': {
        const season = SEASON_BY_START_MONTH[from[1]]
        if (!season) return false
        expected = seasonEvent(season === 'winter' ? from[0] + 1 : from[0], season)
        break
      }
      case 'year':
        expected = yearEvent(from[0])
        break
      case 'range':
        expected = rangeEvent(from[0], to[0])
        break
      default:
        return false
    }
    return expected.from === event.from && expected.to === event.to
  } catch {
    return false
  }
}
