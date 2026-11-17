import { describe, expect, it } from 'vitest'
import { hasExactCard, matchCards } from './cardSearch'
import type { Card } from './storage'

const card = (name: string, aliases: string[] = [], kind: Card['kind'] = 'person'): Card => ({
  id: name,
  kind,
  name,
  aliases,
  description: '',
  birthday: null,
  facts: [],
  address: '',
  mergedInto: null,
  createdAt: 1,
  updatedAt: 1,
  rev: 1,
  deviceId: 'd',
  deletedAt: null,
})

const cards = [
  card('Артём', ['Тёма', 'Артемий']),
  card('Мария', ['Маша']),
  card('Библиотека на Невском', [], 'place'),
]
const names = (list: Card[]) => list.map((c) => c.name)

describe('поиск карточек', () => {
  it('пустой запрос возвращает все карточки в том же порядке', () => {
    expect(names(matchCards(cards, ''))).toEqual(['Артём', 'Мария', 'Библиотека на Невском'])
    expect(names(matchCards(cards, '   '))).toEqual(['Артём', 'Мария', 'Библиотека на Невском'])
  })

  it('по имени и по прозвищу, без регистра', () => {
    expect(names(matchCards(cards, 'мар'))).toEqual(['Мария'])
    expect(names(matchCards(cards, 'МАША'))).toEqual(['Мария'])
    expect(names(matchCards(cards, 'тёма'))).toEqual(['Артём'])
  })

  it('«ё» и «е» не различаются', () => {
    expect(names(matchCards(cards, 'артем'))).toEqual(['Артём'])
    expect(names(matchCards(cards, 'тема'))).toEqual(['Артём'])
    expect(names(matchCards(cards, 'артём'))).toEqual(['Артём'])
  })

  it('несколько слов: все должны встретиться', () => {
    expect(names(matchCards(cards, 'библиотека невском'))).toEqual(['Библиотека на Невском'])
    expect(matchCards(cards, 'библиотека мария')).toEqual([])
  })

  it('ничего не нашлось', () => {
    expect(matchCards(cards, 'яяя')).toEqual([])
    expect(matchCards([], 'а')).toEqual([])
  })

  it('точное совпадение имени или прозвища', () => {
    expect(hasExactCard(cards, 'мария')).toBe(true)
    expect(hasExactCard(cards, ' Маша ')).toBe(true)
    expect(hasExactCard(cards, 'артем')).toBe(true)
    expect(hasExactCard(cards, 'Мар')).toBe(false)
    expect(hasExactCard(cards, '')).toBe(false)
    expect(hasExactCard(cards, '   ')).toBe(false)
  })
})
