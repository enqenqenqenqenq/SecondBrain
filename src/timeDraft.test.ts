import { describe, expect, it } from 'vitest'
import { changePrecision, draftFromEvent, eventFromDraft } from './timeDraft'
import { dayEvent, minuteEvent, monthEvent, rangeEvent, seasonEvent, yearEvent } from './storage'

describe('круг: время в ввод и обратно', () => {
  it.each([
    ['минута', minuteEvent(2024, 7, 15, 12, 30)],
    ['день', dayEvent(2023, 3, 3)],
    ['месяц', monthEvent(2024, 2)],
    ['лето', seasonEvent(2024, 'summer')],
    ['зима, начало в декабре прошлого года', seasonEvent(2023, 'winter')],
    ['год', yearEvent(2019)],
    ['диапазон лет', rangeEvent(2020, 2022)],
  ])('%s возвращается без изменений', (_name, event) => {
    expect(eventFromDraft(draftFromEvent(event))).toEqual(event)
  })

  it('у зимы подписью берётся год конца периода', () => {
    const draft = draftFromEvent(seasonEvent(2023, 'winter'))
    expect(draft.season).toBe('winter')
    expect(draft.year).toBe(2023)
  })
})

describe('сколько нажатий нужно', () => {
  const now = minuteEvent(2026, 11, 17, 14, 5)

  it('сезон: выбрать «Сезон», выбрать «Лето», год уже стоит текущий', () => {
    let draft = changePrecision(draftFromEvent(now), 'season')
    draft = { ...draft, season: 'summer' }
    expect(eventFromDraft(draft)).toEqual(seasonEvent(2026, 'summer'))
  })

  it('год: достаточно выбрать «Год», значение уже стоит текущее', () => {
    expect(eventFromDraft(changePrecision(draftFromEvent(now), 'year'))).toEqual(yearEvent(2026))
  })

  it('месяц: выбрать «Месяц» и месяц из списка', () => {
    const draft = { ...changePrecision(draftFromEvent(now), 'month'), month: 3 }
    expect(eventFromDraft(draft)).toEqual(monthEvent(2026, 3))
  })

  it('день: выбрать «День», дата уже стоит сегодняшняя', () => {
    expect(eventFromDraft(changePrecision(draftFromEvent(now), 'day'))).toEqual(
      dayEvent(2026, 11, 17),
    )
  })

  it('диапазон: по умолчанию один текущий год, достаточно поменять начало', () => {
    const base = changePrecision(draftFromEvent(now), 'range')
    expect(eventFromDraft(base)).toEqual(rangeEvent(2026, 2026))
    expect(eventFromDraft({ ...base, fromYear: 2020, toYear: 2022 })).toEqual(
      rangeEvent(2020, 2022),
    )
  })

  it('минута: смена на «Минуту» и обратно сохраняет дату и время', () => {
    const back = changePrecision(changePrecision(draftFromEvent(now), 'year'), 'minute')
    expect(eventFromDraft(back)).toEqual(now)
  })
})

describe('смена точности не теряет введённое', () => {
  it('год из даты переходит в год, месяц в месяц', () => {
    const draft = changePrecision(draftFromEvent(minuteEvent(2024, 7, 15, 12, 30)), 'month')
    expect(draft.year).toBe(2024)
    expect(draft.month).toBe(7)
    expect(eventFromDraft(draft)).toEqual(monthEvent(2024, 7))
  })

  it('год, поправленный вручную, остаётся при смене между сезоном и годом', () => {
    let draft = changePrecision(draftFromEvent(minuteEvent(2026, 11, 17, 14, 5)), 'season')
    draft = { ...draft, year: 2021, season: 'spring' }
    expect(eventFromDraft(draft)).toEqual(seasonEvent(2021, 'spring'))
    draft = changePrecision(draft, 'year')
    expect(eventFromDraft(draft)).toEqual(yearEvent(2021))
  })

  it('по умолчанию выбирается сезон текущего месяца', () => {
    expect(draftFromEvent(minuteEvent(2026, 1, 10, 9, 0)).season).toBe('winter')
    expect(draftFromEvent(minuteEvent(2026, 4, 10, 9, 0)).season).toBe('spring')
    expect(draftFromEvent(minuteEvent(2026, 7, 10, 9, 0)).season).toBe('summer')
    expect(draftFromEvent(minuteEvent(2026, 10, 10, 9, 0)).season).toBe('autumn')
    expect(draftFromEvent(minuteEvent(2026, 12, 10, 9, 0)).season).toBe('winter')
  })
})

describe('неполный и невозможный ввод даёт пусто', () => {
  const base = draftFromEvent(minuteEvent(2026, 11, 17, 14, 5))

  it('несуществующая дата', () => {
    expect(eventFromDraft({ ...base, precision: 'day', date: '2023-02-30' })).toBeNull()
    expect(eventFromDraft({ ...base, precision: 'minute', date: '2026-04-31' })).toBeNull()
  })

  it('пустая или неполная дата и время', () => {
    expect(eventFromDraft({ ...base, precision: 'day', date: '' })).toBeNull()
    expect(eventFromDraft({ ...base, precision: 'day', date: '2026-11-' })).toBeNull()
    expect(eventFromDraft({ ...base, time: '' })).toBeNull()
    expect(eventFromDraft({ ...base, time: '25:00' })).toBeNull()
  })

  it('месяц и год вне границ', () => {
    expect(eventFromDraft({ ...base, precision: 'month', month: 13 })).toBeNull()
    expect(eventFromDraft({ ...base, precision: 'year', year: 0 })).toBeNull()
    expect(eventFromDraft({ ...base, precision: 'year', year: 10000 })).toBeNull()
    expect(eventFromDraft({ ...base, precision: 'year', year: Number.NaN })).toBeNull()
  })

  it('диапазон наоборот', () => {
    expect(eventFromDraft({ ...base, precision: 'range', fromYear: 2022, toYear: 2020 })).toBeNull()
  })
})
