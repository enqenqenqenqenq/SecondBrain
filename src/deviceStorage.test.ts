import { describe, expect, it } from 'vitest'
import { formatBytes } from './deviceStorage'

describe('размер данных', () => {
  it('байты показываются целыми', () => {
    expect(formatBytes(0)).toBe('0 Б')
    expect(formatBytes(1)).toBe('1 Б')
    expect(formatBytes(1023)).toBe('1023 Б')
  })

  it('до десяти единиц одна цифра после запятой, дальше целые', () => {
    expect(formatBytes(1024)).toBe('1 КБ')
    expect(formatBytes(1536)).toBe('1,5 КБ')
    expect(formatBytes(10 * 1024)).toBe('10 КБ')
    expect(formatBytes(12 * 1024 + 300)).toBe('12 КБ')
    expect(formatBytes(2.34 * 1024 * 1024)).toBe('2,3 МБ')
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 МБ')
  })

  it('гигабайты и больше остаются в гигабайтах', () => {
    expect(formatBytes(3 * 1024 ** 3)).toBe('3 ГБ')
    expect(formatBytes(5000 * 1024 ** 3)).toBe('5000 ГБ')
  })

  it('граница между единицами не даёт «1024 КБ»', () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe('1 МБ')
    expect(formatBytes(1024 * 1024)).toBe('1 МБ')
  })

  it('неверные значения дают прочерк', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(NaN)).toBe('—')
    expect(formatBytes(Infinity)).toBe('—')
  })
})
