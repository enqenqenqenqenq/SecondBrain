import { describe, expect, it } from 'vitest'
import {
  applyMention,
  buildCompletion,
  findMention,
  mentionRole,
  pruneMentions,
  splitMentions,
} from './mentions'
import type { Picked } from './mentions'

describe('поиск набираемого упоминания', () => {
  it('знак в начале, после пробела и после переноса', () => {
    expect(findMention('@', 1)).toEqual({ start: 0, query: '' })
    expect(findMention('позвонить @Ма', 13)).toEqual({ start: 10, query: 'Ма' })
    expect(findMention('раз\n@Ан', 7)).toEqual({ start: 4, query: 'Ан' })
  })

  it('знак посреди слова не упоминание', () => {
    expect(findMention('писать a@b', 10)).toBeNull()
    expect(findMention('почта@mail', 10)).toBeNull()
  })

  it('слово до курсора, а не до конца строки', () => {
    expect(findMention('@Мария пришла', 3)).toEqual({ start: 0, query: 'Ма' })
  })

  it('после пробела, переноса или второго знака упоминание закончено', () => {
    expect(findMention('@Мария пришла', 13)).toBeNull()
    expect(findMention('@Ма\nрия', 7)).toBeNull()
    expect(findMention('@Ма@ри', 6)).toBeNull()
    expect(findMention('без собаки', 5)).toBeNull()
    expect(findMention('', 0)).toBeNull()
  })

  it('курсор до знака упоминания не даёт', () => {
    expect(findMention('раз @Мария', 2)).toBeNull()
  })

  it('используется последний знак перед курсором', () => {
    expect(findMention('@Мария и @Ив', 12)).toEqual({ start: 9, query: 'Ив' })
  })
})

describe('вставка имени', () => {
  it('имя вместо набранного, пробел после и курсор за пробелом', () => {
    const text = 'позвонить @Ма'
    const mention = findMention(text, text.length)!
    expect(applyMention(text, mention, text.length, 'Мария')).toEqual({
      text: 'позвонить @Мария ',
      caret: 17,
    })
  })

  it('текст после курсора сохраняется, лишнего пробела нет', () => {
    const text = '@Ма пришла'
    const mention = findMention(text, 3)!
    expect(applyMention(text, mention, 3, 'Мария')).toEqual({ text: '@Мария пришла', caret: 7 })
  })

  it('перед переносом строки пробел не добавляется и курсор остаётся перед ним', () => {
    const text = '@Ма\nдальше'
    const mention = findMention(text, 3)!
    expect(applyMention(text, mention, 3, 'Мария')).toEqual({ text: '@Мария\nдальше', caret: 6 })
  })

  it('имя с пробелом вставляется целиком', () => {
    const text = '@Чел'
    const mention = findMention(text, 4)!
    expect(applyMention(text, mention, 4, 'Человек А').text).toBe('@Человек А ')
  })
})

describe('роль упоминания', () => {
  it('человек упомянут, у места роли нет', () => {
    expect(mentionRole('person')).toBe('mentioned')
    expect(mentionRole('place')).toBeNull()
  })
})

describe('упоминания в тексте записи', () => {
  const cards = [
    { id: 'a', name: 'Человек А' },
    { id: 'b', name: 'Человек' },
    { id: 'p', name: 'Парк' },
  ]

  it('известные карточки выделяются, остальное остаётся текстом', () => {
    expect(splitMentions('Встретились с @Человек А в @парк, потом @Неизвестный', cards)).toEqual([
      { text: 'Встретились с ' },
      { text: '@Человек А', cardId: 'a' },
      { text: ' в ' },
      { text: '@парк', cardId: 'p' },
      { text: ', потом @Неизвестный' },
    ])
  })

  it('длинное имя важнее короткого', () => {
    expect(splitMentions('@Человек А', cards)).toEqual([{ text: '@Человек А', cardId: 'a' }])
    expect(splitMentions('@Человек Б', cards)).toEqual([
      { text: '@Человек', cardId: 'b' },
      { text: ' Б' },
    ])
  })

  it('продолжение имени буквой не считается упоминанием', () => {
    expect(splitMentions('@Парки и @Парк.', cards)).toEqual([
      { text: '@Парки и ' },
      { text: '@Парк', cardId: 'p' },
      { text: '.' },
    ])
  })

  it('знак посреди слова упоминанием не считается', () => {
    expect(splitMentions('a@Парк', cards)).toEqual([{ text: 'a@Парк' }])
  })

  it('ё и е не различаются, регистр не важен', () => {
    expect(splitMentions('@АРТЕМ', [{ id: 'x', name: 'Артём' }])).toEqual([
      { text: '@АРТЕМ', cardId: 'x' },
    ])
  })

  it('без карточек или без знака текст целиком', () => {
    expect(splitMentions('просто текст', cards)).toEqual([{ text: 'просто текст' }])
    expect(splitMentions('@Парк', [])).toEqual([{ text: '@Парк' }])
    expect(splitMentions('', cards)).toEqual([{ text: '' }])
  })

  it('два упоминания подряд', () => {
    expect(splitMentions('@Парк @Парк', cards).filter((p) => p.cardId).length).toBe(2)
  })

  it('все куски вместе дают исходный текст', () => {
    const text = 'Раз @Человек А, два @Парк\n@Человек три @@ @'
    expect(
      splitMentions(text, cards)
        .map((p) => p.text)
        .join(''),
    ).toBe(text)
  })
})

describe('итоговые привязки', () => {
  it('существующие остаются, выбранные добавляются', () => {
    const { newCards, links } = buildCompletion(
      [{ cardId: 'a', role: 'with' }],
      [
        { cardId: 'b', role: 'mentioned' },
        { newCard: { kind: 'place', name: 'Парк' }, role: null },
      ],
    )
    expect(newCards).toEqual([{ kind: 'place', name: 'Парк' }])
    expect(links).toEqual([
      { cardId: 'a', role: 'with' },
      { cardId: 'b', role: 'mentioned' },
      { newCard: 0, role: null },
    ])
  })

  it('уже привязанная карточка сохраняет прежнюю роль', () => {
    const { links } = buildCompletion(
      [{ cardId: 'a', role: 'with' }],
      [{ cardId: 'a', role: 'mentioned' }],
    )
    expect(links).toEqual([{ cardId: 'a', role: 'with' }])
  })

  it('повторный выбор той же карточки и той же новой карточки даёт одну связь', () => {
    const { newCards, links } = buildCompletion(
      [],
      [
        { cardId: 'a', role: 'mentioned' },
        { cardId: 'a', role: 'mentioned' },
        { newCard: { kind: 'person', name: 'Новый' }, role: 'mentioned' },
        { newCard: { kind: 'person', name: 'Новый' }, role: 'mentioned' },
        { newCard: { kind: 'place', name: 'Новый' }, role: null },
      ],
    )
    expect(newCards).toEqual([
      { kind: 'person', name: 'Новый' },
      { kind: 'place', name: 'Новый' },
    ])
    expect(links).toEqual([
      { cardId: 'a', role: 'mentioned' },
      { newCard: 0, role: 'mentioned' },
      { newCard: 1, role: null },
    ])
  })

  it('без выбранных остаются только существующие', () => {
    expect(buildCompletion([{ cardId: 'a', role: null }], [])).toEqual({
      newCards: [],
      links: [{ cardId: 'a', role: null }],
    })
    expect(buildCompletion([], [])).toEqual({ newCards: [], links: [] })
  })
})

describe('какие упоминания остались в тексте', () => {
  const cards = [
    { id: 'a', name: 'Человек А' },
    { id: 'p', name: 'Парк' },
  ]
  const picked: Picked[] = [
    { cardId: 'a', role: 'mentioned' },
    { cardId: 'p', role: null },
    { newCard: { kind: 'person', name: 'Новый' }, role: 'mentioned' },
  ]

  it('все на месте', () => {
    expect(pruneMentions('@Человек А, @Парк и @Новый', picked, cards)).toEqual(picked)
  })

  it('стёртое из текста упоминание отбрасывается', () => {
    expect(pruneMentions('только @Парк', picked, cards)).toEqual([picked[1]])
    expect(pruneMentions('ничего', picked, cards)).toEqual([])
  })

  it('имя без знака упоминанием не считается', () => {
    expect(pruneMentions('Человек А и Парк', picked, cards)).toEqual([])
  })

  it('новая карточка с тем же именем, но другого вида, различается', () => {
    const both: Picked[] = [
      { newCard: { kind: 'person', name: 'Лес' }, role: 'mentioned' },
      { newCard: { kind: 'place', name: 'Лес' }, role: null },
    ]
    expect(pruneMentions('@Лес', both, [])).toHaveLength(2)
    expect(pruneMentions('нет', both, [])).toEqual([])
  })

  it('пустой выбор', () => {
    expect(pruneMentions('@Парк', [], cards)).toEqual([])
  })
})
