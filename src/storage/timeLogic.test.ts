import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import {
  dayEvent,
  daysInMonth,
  isValidEvent,
  minuteEvent,
  monthEvent,
  rangeEvent,
  seasonEvent,
  yearEvent,
} from './fuzzyTime'
import { createNote, listNotes } from './index'
import { describeEvent, eventAt, formatMinute } from './time'
import type { EventTime } from './types'

const at = (y: number, m: number, d: number, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm)

describe('границы значений', () => {
  it('самый ранний и самый поздний год', () => {
    expect(yearEvent(1)).toEqual({
      precision: 'year',
      from: '0001-01-01T00:00',
      to: '0001-12-31T23:59',
    })
    expect(yearEvent(9999).to).toBe('9999-12-31T23:59')
    expect(minuteEvent(9999, 12, 31, 23, 59).from).toBe('9999-12-31T23:59')
    expect(rangeEvent(1, 9999)).toMatchObject({ from: '0001-01-01T00:00', to: '9999-12-31T23:59' })
  })

  it('зима самого раннего года невозможна, следующая возможна', () => {
    expect(() => seasonEvent(1, 'winter')).toThrow(RangeError)
    expect(seasonEvent(2, 'winter').from).toBe('0001-12-01T00:00')
  })

  it('все строки времени одной длины, у любого года и сезона', () => {
    const all: EventTime[] = [
      minuteEvent(5, 1, 1, 0, 0),
      dayEvent(999, 12, 31),
      monthEvent(2024, 2),
      seasonEvent(2023, 'winter'),
      seasonEvent(1000, 'autumn'),
      yearEvent(7),
      rangeEvent(10, 2020),
    ]
    for (const e of all) {
      expect(e.from).toHaveLength(16)
      expect(e.to).toHaveLength(16)
    }
  })

  it('порядок строк верен и у годов с разным числом цифр', () => {
    expect(yearEvent(999).from < yearEvent(1000).from).toBe(true)
    expect(yearEvent(5).from < yearEvent(50).from).toBe(true)
  })
})

describe('длины месяцев', () => {
  const regular = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const leap = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

  it('в обычном году последний день каждого месяца верный', () => {
    regular.forEach((days, i) => {
      const to = monthEvent(2023, i + 1).to
      expect(to, `месяц ${i + 1}`).toBe(`2023-${String(i + 1).padStart(2, '0')}-${days}T23:59`)
    })
  })

  it('в високосном году последний день каждого месяца верный', () => {
    leap.forEach((days, i) => {
      const to = monthEvent(2024, i + 1).to
      expect(to, `месяц ${i + 1}`).toBe(`2024-${String(i + 1).padStart(2, '0')}-${days}T23:59`)
    })
  })

  it('дней в году 365 и 366', () => {
    const total = (y: number) =>
      Array.from({ length: 12 }, (_, i) => daysInMonth(y, i + 1)).reduce((a, b) => a + b)
    expect(total(2023)).toBe(365)
    expect(total(2024)).toBe(366)
    expect(total(1900)).toBe(365)
    expect(total(2000)).toBe(366)
  })
})

describe('подписи на стыках', () => {
  it('«Вчера» через границу года', () => {
    expect(describeEvent(minuteEvent(2025, 12, 31, 23, 59), at(2026, 1, 1))).toBe('Вчера, 23:59')
  })

  it('«Вчера» после 29 февраля високосного года и после 28 февраля обычного', () => {
    expect(describeEvent(minuteEvent(2024, 2, 29, 10, 0), at(2024, 3, 1))).toBe('Вчера, 10:00')
    expect(describeEvent(minuteEvent(2023, 2, 28, 10, 0), at(2023, 3, 1))).toBe('Вчера, 10:00')
  })

  it('«Сегодня» в первую и в последнюю минуту суток', () => {
    expect(describeEvent(minuteEvent(2026, 11, 17, 0, 0), at(2026, 11, 17, 23, 59))).toBe(
      'Сегодня, 00:00',
    )
    expect(describeEvent(minuteEvent(2026, 11, 17, 23, 59), at(2026, 11, 17, 0, 0))).toBe(
      'Сегодня, 23:59',
    )
  })

  it('позавчера уже называется датой', () => {
    expect(describeEvent(minuteEvent(2026, 11, 15, 8, 0), at(2026, 11, 17))).toBe(
      '15 ноября, 08:00',
    )
  })

  it('год показывается у минуты и дня из другого года, и не показывается из этого', () => {
    const now = at(2026, 11, 17)
    expect(describeEvent(minuteEvent(2025, 3, 5, 9, 5), now)).toBe('5 марта 2025, 09:05')
    expect(describeEvent(dayEvent(2025, 3, 5), now)).toBe('5 марта 2025')
    expect(describeEvent(dayEvent(2026, 3, 5), now)).toBe('5 марта')
  })

  it('все двенадцать названий месяцев', () => {
    const names = [
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
    names.forEach((name, i) => {
      expect(describeEvent(monthEvent(2020, i + 1), at(2026, 11, 17))).toBe(`${name} 2020`)
    })
  })

  it('все двенадцать названий месяцев в дате', () => {
    const names = [
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
    names.forEach((name, i) => {
      expect(describeEvent(dayEvent(2020, i + 1, 10), at(2026, 11, 17))).toBe(`10 ${name} 2020`)
    })
  })

  it('четыре сезона: зима подписана годом конца', () => {
    const now = at(2026, 11, 17)
    expect(describeEvent(seasonEvent(2020, 'winter'), now)).toBe('зима 2020')
    expect(describeEvent(seasonEvent(2020, 'spring'), now)).toBe('весна 2020')
    expect(describeEvent(seasonEvent(2020, 'summer'), now)).toBe('лето 2020')
    expect(describeEvent(seasonEvent(2020, 'autumn'), now)).toBe('осень 2020')
  })

  it('год из одной цифры и диапазон из одного года', () => {
    const now = at(2026, 11, 17)
    expect(describeEvent(yearEvent(5), now)).toBe('5 год')
    expect(describeEvent(rangeEvent(2021, 2021), now)).toBe('2021 год')
    expect(describeEvent(rangeEvent(1999, 2001), now)).toBe('с 1999 по 2001 год')
  })
})

describe('порядок', () => {
  it('29 февраля встаёт между 28 февраля и 1 марта', () => {
    const order = [dayEvent(2024, 3, 1), dayEvent(2024, 2, 28), dayEvent(2024, 2, 29)]
      .map((e) => e.from)
      .sort()
    expect(order).toEqual(['2024-02-28T00:00', '2024-02-29T00:00', '2024-03-01T00:00'])
  })

  it('время с одинаковым началом сравнивается как равное', () => {
    const same = [
      yearEvent(2024),
      rangeEvent(2024, 2026),
      monthEvent(2024, 1),
      dayEvent(2024, 1, 1),
    ]
    expect(new Set(same.map((e) => e.from)).size).toBe(1)
  })

  describe('в хранилище', () => {
    beforeEach(async () => {
      await db.delete()
      await db.open()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('ничья по началу решается временем сохранения: позже сохранённая выше', async () => {
      const now = vi.spyOn(Date, 'now')
      for (const [i, event] of [
        yearEvent(2024),
        monthEvent(2024, 1),
        dayEvent(2024, 1, 1),
        rangeEvent(2024, 2026),
      ].entries()) {
        now.mockReturnValue(1000 + i)
        await createNote(`n${i}`, event)
      }
      expect((await listNotes()).map((n) => n.text)).toEqual(['n3', 'n2', 'n1', 'n0'])
    })

    it('граница года и високосный день стоят в ленте по порядку', async () => {
      const events = [
        minuteEvent(2023, 12, 31, 23, 59),
        minuteEvent(2024, 1, 1, 0, 0),
        minuteEvent(2024, 2, 28, 12, 0),
        minuteEvent(2024, 2, 29, 12, 0),
        minuteEvent(2024, 3, 1, 12, 0),
      ]
      for (const [i, e] of events.entries()) await createNote(`e${i}`, e)
      expect((await listNotes()).map((n) => n.text)).toEqual(['e4', 'e3', 'e2', 'e1', 'e0'])
    })

    it('приблизительное время стоит там, где начинается его период', async () => {
      await createNote('до лета', minuteEvent(2024, 5, 31, 23, 59))
      await createNote('июнь', monthEvent(2024, 6))
      await createNote('середина июня', minuteEvent(2024, 6, 15, 12, 0))
      expect((await listNotes()).map((n) => n.text)).toEqual(['середина июня', 'июнь', 'до лета'])
    })

    it('зима встаёт по декабрю прошлого года, раньше января', async () => {
      await createNote('январь 2023', dayEvent(2023, 1, 15))
      await createNote('зима 2023', seasonEvent(2023, 'winter'))
      await createNote('ноябрь 2022', dayEvent(2022, 11, 20))
      expect((await listNotes()).map((n) => n.text)).toEqual([
        'январь 2023',
        'зима 2023',
        'ноябрь 2022',
      ])
    })
  })
})

describe('местное время', () => {
  it('минута в записи совпадает с местными часами на стыках суток и лет', () => {
    for (const d of [
      at(2026, 12, 31, 23, 59),
      at(2027, 1, 1, 0, 0),
      at(2024, 2, 29, 0, 1),
      at(2026, 6, 1, 0, 30),
    ]) {
      const s = formatMinute(d)
      expect(s).toBe(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      )
      expect(isValidEvent(eventAt(d))).toBe(true)
    }
  })

  it('время записи берётся местное, а не по Гринвичу', () => {
    expect(eventAt(new Date(2026, 5, 1, 0, 30)).from).toBe('2026-06-01T00:30')
    expect(eventAt(new Date(2026, 11, 31, 23, 59)).from).toBe('2026-12-31T23:59')
  })
})

describe('испорченные данные не ломают приложение', () => {
  const garbage = [
    { precision: 'month', from: 'мусор', to: 'мусор' },
    { precision: 'season', from: '2024-07-01T00:00', to: '2024-09-30T23:59' },
    { precision: 'неизвестно', from: '2024-01-01T00:00', to: '2024-01-01T00:00' },
    { precision: 'day', from: '2023-02-30T00:00', to: '2023-02-30T23:59' },
    { precision: 'year', from: '', to: '' },
  ] as unknown as EventTime[]

  it('подпись для испорченного времени не падает и честно говорит об этом', () => {
    for (const e of garbage) {
      expect(describeEvent(e, at(2026, 11, 17))).toBe('Время не указано')
    }
  })

  it('проверка целостности отвечает «нет» на что угодно, но не падает', () => {
    const odd = [
      null,
      undefined,
      {},
      42,
      'строка',
      { precision: 'day' },
      { from: 1, to: 2 },
      { precision: 'day', from: 5, to: 6 },
    ]
    for (const e of odd) {
      expect(isValidEvent(e as never), JSON.stringify(e)).toBe(false)
    }
    for (const e of garbage) expect(isValidEvent(e)).toBe(false)
  })

  it('пробелы и лишние знаки в строках времени отклоняются', () => {
    expect(
      isValidEvent({ precision: 'minute', from: ' 2024-07-15T12:30', to: '2024-07-15T12:30' }),
    ).toBe(false)
    expect(
      isValidEvent({ precision: 'minute', from: '2024-07-15T12:30:00', to: '2024-07-15T12:30:00' }),
    ).toBe(false)
    expect(
      isValidEvent({ precision: 'minute', from: '2024-07-15 12:30', to: '2024-07-15 12:30' }),
    ).toBe(false)
  })
})
