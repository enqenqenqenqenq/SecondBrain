import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  daysInMonth,
  dayEvent,
  isLeapYear,
  isValidEvent,
  minuteEvent,
  monthEvent,
  rangeEvent,
  seasonEvent,
  yearEvent,
} from './fuzzyTime'
import { createNote, getNote, updateNote } from './index'
import { describeEvent } from './time'

describe('шесть точностей', () => {
  it('минута: один момент', () => {
    expect(minuteEvent(2024, 7, 15, 12, 30)).toEqual({
      precision: 'minute',
      from: '2024-07-15T12:30',
      to: '2024-07-15T12:30',
    })
  })

  it('день: от начала до конца суток', () => {
    expect(dayEvent(2023, 3, 3)).toEqual({
      precision: 'day',
      from: '2023-03-03T00:00',
      to: '2023-03-03T23:59',
    })
  })

  it('месяц: от первого до последнего дня', () => {
    expect(monthEvent(2023, 3)).toEqual({
      precision: 'month',
      from: '2023-03-01T00:00',
      to: '2023-03-31T23:59',
    })
  })

  it('сезоны лета, весны и осени лежат внутри года', () => {
    expect(seasonEvent(2024, 'summer')).toMatchObject({
      from: '2024-06-01T00:00',
      to: '2024-08-31T23:59',
    })
    expect(seasonEvent(2024, 'spring')).toMatchObject({
      from: '2024-03-01T00:00',
      to: '2024-05-31T23:59',
    })
    expect(seasonEvent(2024, 'autumn')).toMatchObject({
      from: '2024-09-01T00:00',
      to: '2024-11-30T23:59',
    })
  })

  it('зима года N начинается в декабре предыдущего года', () => {
    expect(seasonEvent(2023, 'winter')).toEqual({
      precision: 'season',
      from: '2022-12-01T00:00',
      to: '2023-02-28T23:59',
    })
  })

  it('год и диапазон лет', () => {
    expect(yearEvent(2019)).toEqual({
      precision: 'year',
      from: '2019-01-01T00:00',
      to: '2019-12-31T23:59',
    })
    expect(rangeEvent(2020, 2022)).toEqual({
      precision: 'range',
      from: '2020-01-01T00:00',
      to: '2022-12-31T23:59',
    })
  })

  it('диапазон из одного года допустим', () => {
    expect(rangeEvent(2021, 2021).from).toBe('2021-01-01T00:00')
  })
})

describe('високосные годы и границы', () => {
  it('правило високосного года', () => {
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(2023)).toBe(false)
    expect(isLeapYear(1900)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
    expect(isLeapYear(2100)).toBe(false)
  })

  it('число дней в феврале', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2023, 2)).toBe(28)
  })

  it('конец февраля в месяце и в зиме учитывает високосный год', () => {
    expect(monthEvent(2024, 2).to).toBe('2024-02-29T23:59')
    expect(monthEvent(2023, 2).to).toBe('2023-02-28T23:59')
    expect(seasonEvent(2024, 'winter').to).toBe('2024-02-29T23:59')
    expect(seasonEvent(2100, 'winter').to).toBe('2100-02-28T23:59')
  })

  it('29 февраля бывает только в високосный год', () => {
    expect(dayEvent(2024, 2, 29).from).toBe('2024-02-29T00:00')
    expect(() => dayEvent(2023, 2, 29)).toThrow(RangeError)
  })

  it('смена года не ломает порядок строк', () => {
    expect(dayEvent(2023, 12, 31).from < dayEvent(2024, 1, 1).from).toBe(true)
  })
})

describe('некорректный ввод отклоняется', () => {
  it('минута: час, минута, месяц и день вне границ', () => {
    expect(() => minuteEvent(2024, 1, 1, 24, 0)).toThrow(RangeError)
    expect(() => minuteEvent(2024, 1, 1, 0, 60)).toThrow(RangeError)
    expect(() => minuteEvent(2024, 13, 1, 0, 0)).toThrow(RangeError)
    expect(() => minuteEvent(2024, 4, 31, 0, 0)).toThrow(RangeError)
    expect(() => minuteEvent(2024, 1, 0, 0, 0)).toThrow(RangeError)
  })

  it('дробные и нечисловые значения отклоняются', () => {
    expect(() => yearEvent(2024.5)).toThrow(RangeError)
    expect(() => monthEvent(2024, Number.NaN)).toThrow(RangeError)
  })

  it('год вне границ и диапазон наоборот', () => {
    expect(() => yearEvent(0)).toThrow(RangeError)
    expect(() => yearEvent(10_000)).toThrow(RangeError)
    expect(() => rangeEvent(2022, 2020)).toThrow(RangeError)
  })
})

describe('подписи совпадают с построением', () => {
  const now = new Date(2026, 10, 17, 14, 5)
  it('каждое построенное время читается так, как его построили', () => {
    expect(describeEvent(minuteEvent(2024, 7, 15, 12, 30), now)).toBe('15 июля 2024, 12:30')
    expect(describeEvent(dayEvent(2023, 3, 3), now)).toBe('3 марта 2023')
    expect(describeEvent(monthEvent(2023, 3), now)).toBe('март 2023')
    expect(describeEvent(seasonEvent(2024, 'summer'), now)).toBe('лето 2024')
    expect(describeEvent(seasonEvent(2023, 'winter'), now)).toBe('зима 2023')
    expect(describeEvent(yearEvent(2019), now)).toBe('2019 год')
    expect(describeEvent(rangeEvent(2020, 2022), now)).toBe('с 2020 по 2022 год')
  })
})

describe('проверка целостности', () => {
  it('всё построенное признаётся целым', () => {
    const all = [
      minuteEvent(2024, 7, 15, 12, 30),
      dayEvent(2023, 3, 3),
      monthEvent(2024, 2),
      seasonEvent(2023, 'winter'),
      seasonEvent(2024, 'summer'),
      yearEvent(2019),
      rangeEvent(2020, 2022),
    ]
    expect(all.map(isValidEvent)).toEqual(all.map(() => true))
  })

  it('испорченное время отклоняется', () => {
    const bad = [
      { precision: 'minute', from: '2024-07-15T12:30', to: '2024-07-15T12:31' },
      { precision: 'day', from: '2023-03-03T10:00', to: '2023-03-03T23:59' },
      { precision: 'month', from: '2023-03-01T00:00', to: '2023-03-30T23:59' },
      { precision: 'season', from: '2024-06-01T00:00', to: '2024-09-30T23:59' },
      { precision: 'season', from: '2024-07-01T00:00', to: '2024-09-30T23:59' },
      { precision: 'year', from: '2019-01-01T00:00', to: '2019-12-30T23:59' },
      { precision: 'range', from: '2022-01-01T00:00', to: '2020-12-31T23:59' },
      { precision: 'minute', from: '2024-7-15 12:30', to: '2024-7-15 12:30' },
      { precision: 'day', from: '2023-02-30T00:00', to: '2023-02-30T23:59' },
      { precision: 'неизвестно', from: '2024-01-01T00:00', to: '2024-01-01T00:00' },
    ]
    for (const e of bad) {
      expect(isValidEvent(e as never), `${e.precision} ${e.from} ${e.to}`).toBe(false)
    }
  })
})

describe('порядок в ленте', () => {
  it('сортировка строк совпадает с хронологией', () => {
    const shuffled = [
      minuteEvent(2026, 11, 17, 14, 5),
      yearEvent(2019),
      seasonEvent(2024, 'summer'),
      dayEvent(2023, 3, 3),
      rangeEvent(2020, 2022),
      monthEvent(2023, 3),
    ]
    const ordered = [...shuffled].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    expect(ordered.map((e) => describeEvent(e, new Date(2026, 10, 17)))).toEqual([
      '2019 год',
      'с 2020 по 2022 год',
      'март 2023',
      '3 марта 2023',
      'лето 2024',
      'Сегодня, 14:05',
    ])
  })
})

describe('хранилище принимает только целое время', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('создание записи с испорченным временем отклоняется', async () => {
    await expect(
      createNote('плохое', { precision: 'day', from: '2023-02-30T00:00', to: '2023-02-30T23:59' }),
    ).rejects.toThrow()
  })

  it('правка с испорченным временем отклоняется, с целым принимается', async () => {
    const note = await createNote('время')
    await expect(
      updateNote(note.id, {
        event: { precision: 'year', from: '2020-01-01T00:00', to: '2020-12-30T23:59' },
      }),
    ).rejects.toThrow()
    expect((await getNote(note.id))?.rev).toBe(1)
    const changed = await updateNote(note.id, { event: seasonEvent(2024, 'summer') })
    expect(changed?.event).toEqual(seasonEvent(2024, 'summer'))
    expect(changed?.timeIsAuto).toBe(false)
  })
})
