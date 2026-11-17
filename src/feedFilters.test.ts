import { describe, expect, it } from 'vitest'
import { filterNotes, hasFilters, overlaps } from './feedFilters'
import type { FeedFilters } from './feedFilters'
import { fold, parseQuery } from './search'
import { dayEvent, minuteEvent, monthEvent, rangeEvent, seasonEvent, yearEvent } from './storage'
import type { EventTime, Note } from './storage'

let counter = 0
const note = (text: string, event: EventTime, reviewed = false): Note => ({
  id: `n${++counter}`,
  text,
  event,
  timeIsAuto: false,
  reviewedAt: reviewed ? 1 : null,
  tagIds: [],
  createdAt: counter,
  updatedAt: counter,
  rev: 1,
  deviceId: 'd',
  deletedAt: null,
})

const none: FeedFilters = { words: [], unreviewed: false, period: null, linked: [] }
const run = (notes: Note[], filters: Partial<FeedFilters>) =>
  filterNotes(notes, { ...none, ...filters }, (n) => fold(n.text)).map((n) => n.text)
const words = (query: string) => parseQuery(query)

describe('пересечение периодов', () => {
  const summer = seasonEvent(2024, 'summer')

  it('запись внутри периода и период внутри записи', () => {
    expect(overlaps(minuteEvent(2024, 7, 15, 12, 0), summer)).toBe(true)
    expect(overlaps(yearEvent(2024), summer)).toBe(true)
    expect(overlaps(summer, yearEvent(2024))).toBe(true)
  })

  it('частичное пересечение с любой стороны', () => {
    expect(overlaps(monthEvent(2024, 5), rangeEvent(2024, 2026))).toBe(true)
    expect(overlaps(rangeEvent(2020, 2024), summer)).toBe(true)
    expect(overlaps(seasonEvent(2024, 'spring'), monthEvent(2024, 5))).toBe(true)
  })

  it('границы входят: запись на стыке попадает в период', () => {
    expect(overlaps(minuteEvent(2024, 6, 1, 0, 0), summer)).toBe(true)
    expect(overlaps(minuteEvent(2024, 8, 31, 23, 59), summer)).toBe(true)
  })

  it('минута за границей не пересекается', () => {
    expect(overlaps(minuteEvent(2024, 5, 31, 23, 59), summer)).toBe(false)
    expect(overlaps(minuteEvent(2024, 9, 1, 0, 0), summer)).toBe(false)
  })

  it('соседние сезоны не пересекаются, одинаковые совпадают', () => {
    expect(overlaps(seasonEvent(2024, 'spring'), summer)).toBe(false)
    expect(overlaps(seasonEvent(2024, 'autumn'), summer)).toBe(false)
    expect(overlaps(summer, summer)).toBe(true)
  })

  it('зима относится к двум годам и пересекается с декабрём и с февралём', () => {
    const winter = seasonEvent(2023, 'winter')
    expect(overlaps(dayEvent(2022, 12, 31), winter)).toBe(true)
    expect(overlaps(dayEvent(2023, 2, 28), winter)).toBe(true)
    expect(overlaps(dayEvent(2022, 11, 30), winter)).toBe(false)
    expect(overlaps(dayEvent(2023, 3, 1), winter)).toBe(false)
  })

  it('29 февраля входит в февраль и зиму високосного года', () => {
    expect(overlaps(dayEvent(2024, 2, 29), monthEvent(2024, 2))).toBe(true)
    expect(overlaps(dayEvent(2024, 2, 29), seasonEvent(2024, 'winter'))).toBe(true)
    expect(overlaps(dayEvent(2024, 2, 29), seasonEvent(2024, 'spring'))).toBe(false)
  })

  it('испорченное время не ломает сравнение и ни с чем не пересекается', () => {
    const broken = { precision: 'day', from: undefined, to: undefined } as unknown as EventTime
    expect(overlaps(broken, summer)).toBe(false)
  })
})

describe('каждый фильтр отдельно', () => {
  const notes = [
    note('зимняя поездка', dayEvent(2024, 1, 20), true),
    note('летний отпуск', seasonEvent(2024, 'summer')),
    note('осенний кофе', minuteEvent(2024, 10, 3, 9, 0), true),
    note('кофе летом', minuteEvent(2024, 7, 15, 8, 30)),
    note('старая запись', yearEvent(2019)),
  ]

  it('без фильтров список не меняется и это тот же список', () => {
    expect(filterNotes(notes, none, (n) => fold(n.text))).toBe(notes)
    expect(hasFilters(none)).toBe(false)
  })

  it('только неразобранные', () => {
    expect(run(notes, { unreviewed: true })).toEqual([
      'летний отпуск',
      'кофе летом',
      'старая запись',
    ])
  })

  it('только период: приблизительное время подходит, если пересекается', () => {
    expect(run(notes, { period: seasonEvent(2024, 'summer') })).toEqual([
      'летний отпуск',
      'кофе летом',
    ])
    expect(run(notes, { period: yearEvent(2024) })).toEqual([
      'зимняя поездка',
      'летний отпуск',
      'осенний кофе',
      'кофе летом',
    ])
    expect(run(notes, { period: rangeEvent(2018, 2019) })).toEqual(['старая запись'])
  })

  it('только поиск', () => {
    expect(run(notes, { words: words('кофе') })).toEqual(['осенний кофе', 'кофе летом'])
  })

  it('период, в который ничего не попало, даёт пустой список', () => {
    expect(run(notes, { period: yearEvent(2030) })).toEqual([])
  })
})

describe('фильтры вместе', () => {
  const notes = [
    note('кофе утром', minuteEvent(2024, 7, 15, 8, 30)), // неразобрана, лето
    note('кофе вечером', minuteEvent(2024, 7, 15, 20, 0), true), // разобрана, лето
    note('кофе зимой', minuteEvent(2024, 1, 10, 9, 0)), // неразобрана, зима
    note('чай летом', minuteEvent(2024, 7, 16, 9, 0)), // неразобрана, лето, без кофе
    note('кофе давно', yearEvent(2019)), // неразобрана, другой год
  ]
  const summer = seasonEvent(2024, 'summer')

  it('неразобранные и период', () => {
    expect(run(notes, { unreviewed: true, period: summer })).toEqual(['кофе утром', 'чай летом'])
  })

  it('неразобранные и поиск', () => {
    expect(run(notes, { unreviewed: true, words: words('кофе') })).toEqual([
      'кофе утром',
      'кофе зимой',
      'кофе давно',
    ])
  })

  it('период и поиск', () => {
    expect(run(notes, { period: summer, words: words('кофе') })).toEqual([
      'кофе утром',
      'кофе вечером',
    ])
  })

  it('все три сразу', () => {
    expect(run(notes, { unreviewed: true, period: summer, words: words('кофе') })).toEqual([
      'кофе утром',
    ])
  })

  it('результат вместе равен пересечению результатов по отдельности', () => {
    const a = new Set(run(notes, { unreviewed: true }))
    const b = new Set(run(notes, { period: summer }))
    const c = new Set(run(notes, { words: words('кофе') }))
    const expected = notes.map((n) => n.text).filter((t) => a.has(t) && b.has(t) && c.has(t))
    expect(run(notes, { unreviewed: true, period: summer, words: words('кофе') })).toEqual(expected)
  })

  it('порядок записей сохраняется', () => {
    const result = run(notes, { words: words('кофе') })
    expect(result).toEqual(notes.map((n) => n.text).filter((t) => t.startsWith('кофе')))
  })

  it('несовместимые фильтры дают пустой список', () => {
    expect(run(notes, { period: summer, words: words('давно') })).toEqual([])
  })

  it('каждый включённый фильтр делает список короче или равным', () => {
    const base = run(notes, {}).length
    const withOne = run(notes, { unreviewed: true }).length
    const withTwo = run(notes, { unreviewed: true, period: summer }).length
    const withThree = run(notes, { unreviewed: true, period: summer, words: words('кофе') }).length
    expect(base >= withOne && withOne >= withTwo && withTwo >= withThree).toBe(true)
  })
})

describe('скорость', () => {
  it('все три фильтра на 5000 записях укладываются в доли секунды', () => {
    const big = Array.from({ length: 5000 }, (_, i) =>
      note(
        i % 7 === 0 ? `кофе ${i}` : `запись ${i}`,
        minuteEvent(2020 + (i % 6), (i % 12) + 1, (i % 28) + 1, i % 24, i % 60),
        i % 3 === 0,
      ),
    )
    const filters: FeedFilters = {
      words: words('кофе'),
      unreviewed: true,
      period: yearEvent(2022),
      linked: [],
    }
    const started = performance.now()
    const result = filterNotes(big, filters, (n) => fold(n.text))
    expect(performance.now() - started).toBeLessThan(300)
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThan(big.length)
  })
})

describe('люди и места', () => {
  const notes = [
    note('кофе с первым', minuteEvent(2024, 7, 15, 8, 30)),
    note('кофе со вторым', minuteEvent(2024, 7, 16, 8, 30), true),
    note('чай с обоими', minuteEvent(2024, 1, 10, 9, 0)),
    note('просто запись', yearEvent(2019)),
  ]
  const idOf = (text: string) => notes.find((n) => n.text === text)!.id
  const first = new Set([idOf('кофе с первым'), idOf('чай с обоими')])
  const second = new Set([idOf('кофе со вторым'), idOf('чай с обоими')])

  it('одна карточка оставляет только её записи в прежнем порядке', () => {
    expect(run(notes, { linked: [first] })).toEqual(['кофе с первым', 'чай с обоими'])
    expect(hasFilters({ ...none, linked: [first] })).toBe(true)
  })

  it('две карточки: запись должна быть связана с обеими', () => {
    expect(run(notes, { linked: [first, second] })).toEqual(['чай с обоими'])
  })

  it('карточка без записей даёт пустой список', () => {
    expect(run(notes, { linked: [new Set()] })).toEqual([])
    expect(run(notes, { linked: [first, new Set()] })).toEqual([])
  })

  it('вместе с другими фильтрами', () => {
    expect(run(notes, { linked: [first], words: words('кофе') })).toEqual(['кофе с первым'])
    expect(run(notes, { linked: [second], unreviewed: true })).toEqual(['чай с обоими'])
    expect(run(notes, { linked: [first], period: yearEvent(2024) })).toEqual([
      'кофе с первым',
      'чай с обоими',
    ])
    expect(run(notes, { linked: [first], period: yearEvent(2019) })).toEqual([])
  })
})
