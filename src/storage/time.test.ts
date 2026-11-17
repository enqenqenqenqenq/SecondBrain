import { describe, expect, it } from 'vitest'
import { describeEvent, eventAt, formatMinute } from './time'
import type { EventTime } from './types'

const now = new Date(2026, 10, 17, 14, 5) // 17 ноября 2026, 14:05
const make = (precision: EventTime['precision'], from: string, to: string = from): EventTime => ({
  precision,
  from,
  to,
})

describe('formatMinute и eventAt', () => {
  it('пишет местное время с точностью до минуты', () => {
    expect(formatMinute(new Date(2026, 0, 5, 9, 7))).toBe('2026-01-05T09:07')
  })

  it('время обычной записи это один момент', () => {
    const e = eventAt(new Date(2026, 10, 17, 14, 5))
    expect(e).toEqual({ precision: 'minute', from: '2026-11-17T14:05', to: '2026-11-17T14:05' })
  })
})

describe('describeEvent', () => {
  it('минута: сегодня, вчера и более раннее', () => {
    expect(describeEvent(make('minute', '2026-11-17T09:30'), now)).toBe('Сегодня, 09:30')
    expect(describeEvent(make('minute', '2026-11-16T23:59'), now)).toBe('Вчера, 23:59')
    expect(describeEvent(make('minute', '2026-07-15T12:30'), now)).toBe('15 июля, 12:30')
  })

  it('минута в другом году показывает год', () => {
    expect(describeEvent(make('minute', '2024-07-15T12:30'), now)).toBe('15 июля 2024, 12:30')
  })

  it('вчера работает на границе месяца', () => {
    const first = new Date(2026, 11, 1, 10, 0)
    expect(describeEvent(make('minute', '2026-11-30T08:00'), first)).toBe('Вчера, 08:00')
  })

  it('день, месяц и год', () => {
    expect(describeEvent(make('day', '2023-03-03T00:00', '2023-03-03T23:59'), now)).toBe(
      '3 марта 2023',
    )
    expect(describeEvent(make('month', '2023-03-01T00:00', '2023-03-31T23:59'), now)).toBe(
      'март 2023',
    )
    expect(describeEvent(make('year', '2019-01-01T00:00', '2019-12-31T23:59'), now)).toBe(
      '2019 год',
    )
  })

  it('сезон: зима относится к году, на который приходится её конец', () => {
    expect(describeEvent(make('season', '2024-06-01T00:00', '2024-08-31T23:59'), now)).toBe(
      'лето 2024',
    )
    expect(describeEvent(make('season', '2022-12-01T00:00', '2023-02-28T23:59'), now)).toBe(
      'зима 2023',
    )
  })

  it('диапазон лет', () => {
    expect(describeEvent(make('range', '2020-01-01T00:00', '2022-12-31T23:59'), now)).toBe(
      'с 2020 по 2022 год',
    )
    expect(describeEvent(make('range', '2021-01-01T00:00', '2021-12-31T23:59'), now)).toBe(
      '2021 год',
    )
  })
})
