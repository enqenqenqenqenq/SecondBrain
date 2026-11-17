import { describe, expect, it } from 'vitest'
import { formatBirthday } from './noteFormat'

describe('день рождения словами', () => {
  it('с годом и без года', () => {
    expect(formatBirthday({ month: 3, day: 14, year: 1990 })).toBe('14 марта 1990')
    expect(formatBirthday({ month: 3, day: 14 })).toBe('14 марта')
    expect(formatBirthday({ month: 3, day: 14, year: undefined })).toBe('14 марта')
  })

  it('все месяцы и граничные дни', () => {
    expect(formatBirthday({ month: 1, day: 1 })).toBe('1 января')
    expect(formatBirthday({ month: 2, day: 29 })).toBe('29 февраля')
    expect(formatBirthday({ month: 12, day: 31, year: 2000 })).toBe('31 декабря 2000')
  })
})
