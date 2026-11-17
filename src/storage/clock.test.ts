import { describe, expect, it } from 'vitest'
import { bumpClock, compareClocks, isValidClock, mergeClocks } from './clock'
import type { Clock } from './clock'

describe('правка на устройстве', () => {
  it('своё число растёт на единицу, чужие не трогаются', () => {
    expect(bumpClock(undefined, 'a')).toEqual({ a: 1 })
    expect(bumpClock({ a: 1, b: 4 }, 'a')).toEqual({ a: 2, b: 4 })
    expect(bumpClock({ a: 1 }, 'b')).toEqual({ a: 1, b: 1 })
  })

  it('исходные часы не меняются', () => {
    const clock = { a: 1 }
    bumpClock(clock, 'a')
    expect(clock).toEqual({ a: 1 })
  })
})

describe('объединение', () => {
  it('по каждому устройству большее число', () => {
    expect(mergeClocks({ a: 3, b: 1 }, { a: 1, b: 2, c: 5 })).toEqual({ a: 3, b: 2, c: 5 })
    expect(mergeClocks(undefined, { a: 1 })).toEqual({ a: 1 })
    expect(mergeClocks({ a: 1 }, undefined)).toEqual({ a: 1 })
    expect(mergeClocks(undefined, undefined)).toEqual({})
  })
})

describe('сравнение версий', () => {
  it('одна и та же версия', () => {
    expect(compareClocks({ a: 2, b: 1 }, { a: 2, b: 1 })).toBe('equal')
    expect(compareClocks(undefined, {})).toBe('equal')
    expect(compareClocks({ a: 1 }, { a: 1, b: 0 })).toBe('equal')
  })

  it('одна получилась из другой', () => {
    expect(compareClocks({ a: 1 }, { a: 2 })).toBe('before')
    expect(compareClocks({ a: 2 }, { a: 1 })).toBe('after')
    expect(compareClocks({ a: 1 }, { a: 1, b: 1 })).toBe('before')
    expect(compareClocks(undefined, { a: 1 })).toBe('before')
    expect(compareClocks({ a: 1 }, undefined)).toBe('after')
  })

  it('независимые версии, в том числе с одинаковым числом правок', () => {
    expect(compareClocks({ a: 1 }, { b: 1 })).toBe('concurrent')
    expect(compareClocks({ a: 3, b: 1 }, { a: 2, b: 2 })).toBe('concurrent')
    expect(compareClocks({ a: 2 }, { a: 1, b: 1 })).toBe('concurrent')
  })

  it('отношение обратимо', () => {
    const samples: Clock[] = [{}, { a: 1 }, { a: 2 }, { b: 1 }, { a: 1, b: 1 }, { a: 2, b: 1 }]
    const flip = { equal: 'equal', before: 'after', after: 'before', concurrent: 'concurrent' }
    for (const x of samples) {
      for (const y of samples) {
        expect(compareClocks(x, y)).toBe(flip[compareClocks(y, x)])
      }
    }
  })

  it('объединение никогда не меньше обоих', () => {
    const samples: Clock[] = [{}, { a: 1 }, { b: 2 }, { a: 2, b: 1 }, { c: 1 }]
    for (const x of samples) {
      for (const y of samples) {
        const m = mergeClocks(x, y)
        expect(['after', 'equal']).toContain(compareClocks(m, x))
        expect(['after', 'equal']).toContain(compareClocks(m, y))
      }
    }
  })
})

describe('проверка часов из файла', () => {
  it('допустимые', () => {
    expect(isValidClock({})).toBe(true)
    expect(isValidClock({ a: 1, b: 40 })).toBe(true)
  })

  it('недопустимые', () => {
    for (const bad of [
      null,
      undefined,
      [],
      'a',
      5,
      { a: 0 },
      { a: -1 },
      { a: 1.5 },
      { a: '1' },
      { '': 1 },
    ]) {
      expect(isValidClock(bad)).toBe(false)
    }
    expect(isValidClock({ ['x'.repeat(101)]: 1 })).toBe(false)
    expect(
      isValidClock(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`d${i}`, 1]))),
    ).toBe(false)
  })
})
