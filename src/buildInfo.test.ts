import { describe, expect, it } from 'vitest'
import { describeBuild, formatBuildDate } from './buildInfo'

describe('дата сборки', () => {
  it('обычная дата словами', () => {
    expect(formatBuildDate('2026-11-17')).toBe('17 ноября 2026')
    expect(formatBuildDate('2026-03-01')).toBe('1 марта 2026')
    expect(formatBuildDate('2024-02-29')).toBe('29 февраля 2024')
  })

  it('все двенадцать месяцев', () => {
    const names = Array.from(
      { length: 12 },
      (_, i) => formatBuildDate(`2026-${String(i + 1).padStart(2, '0')}-15`).split(' ')[1],
    )
    expect(names).toEqual([
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
    ])
  })

  it('не похожее на дату возвращается как есть', () => {
    expect(formatBuildDate('вчера')).toBe('вчера')
    expect(formatBuildDate('2026-13-01')).toBe('2026-13-01')
    expect(formatBuildDate('')).toBe('')
  })
})

describe('описание сборки', () => {
  it('без номера это разработка', () => {
    expect(describeBuild(undefined, undefined)).toBe('разработка')
    expect(describeBuild('', '2026-11-17')).toBe('разработка')
  })

  it('номер с датой и без даты', () => {
    expect(describeBuild('0da5503', '2026-11-17')).toBe('0da5503, 17 ноября 2026')
    expect(describeBuild('0da5503', undefined)).toBe('0da5503')
  })
})
