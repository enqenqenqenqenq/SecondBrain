import { beforeEach, describe, expect, it } from 'vitest'
import type { Card } from './types'
import { db } from './db'
import {
  completeNote,
  createCard,
  createNote,
  dayEvent,
  deleteCard,
  deleteNote,
  getNote,
  linkNote,
  listCardsOfNote,
  listNotesOfCard,
  minuteEvent,
  seasonEvent,
  unlinkNote,
} from './index'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const snapshot = async () => ({
  notes: await db.notes.toArray(),
  cards: await db.cards.toArray(),
  links: await db.links.toArray(),
})

describe('дополнение: текст и время', () => {
  it('меняет текст, поднимает номер правки и не трогает остальное', async () => {
    const note = await createNote('позвонить', minuteEvent(2026, 5, 1, 10, 0))
    const { note: done } = await completeNote(note.id, {
      text: ' позвонить после работы ',
      links: [],
    })
    expect(done.text).toBe('позвонить после работы')
    expect(done.rev).toBe(2)
    expect(done.event).toEqual(note.event)
    expect(done.timeIsAuto).toBe(note.timeIsAuto)
    expect(done.reviewedAt).toBeNull()
    expect(await getNote(note.id)).toEqual(done)
  })

  it('меняет время и снимает признак «поставлено само»', async () => {
    const note = await createNote('раз')
    expect(note.timeIsAuto).toBe(true)
    const { note: done } = await completeNote(note.id, {
      event: seasonEvent(2024, 'summer'),
      links: [],
    })
    expect(done.event.precision).toBe('season')
    expect(done.timeIsAuto).toBe(false)
    expect(done.text).toBe('раз')
    expect(done.rev).toBe(2)
  })

  it('те же текст и время не считаются правкой', async () => {
    const note = await createNote('раз', dayEvent(2023, 3, 3))
    const { note: same } = await completeNote(note.id, {
      text: 'раз',
      event: { ...note.event },
      links: [],
    })
    expect(same.rev).toBe(1)
    expect((await db.notes.get(note.id))?.rev).toBe(1)
    expect(same.timeIsAuto).toBe(note.timeIsAuto)
  })

  it('пустой текст и невозможное время отклоняются, ничего не меняется', async () => {
    const note = await createNote('раз')
    const person = await createCard({ kind: 'person', name: 'А' })
    const before = await snapshot()
    await expect(
      completeNote(note.id, { text: '   ', links: [{ cardId: person.id }] }),
    ).rejects.toThrow('Текст')
    await expect(
      completeNote(note.id, {
        event: { precision: 'day', from: 'вчера', to: 'завтра' },
        links: [{ cardId: person.id }],
      }),
    ).rejects.toThrow('время')
    expect(await snapshot()).toEqual(before)
  })

  it('неизвестная и удалённая запись', async () => {
    await expect(completeNote('нет', { links: [] })).rejects.toThrow('Запись не найдена')
    const note = await createNote('раз')
    await deleteNote(note.id)
    await expect(completeNote(note.id, { text: 'два', links: [] })).rejects.toThrow(
      'Запись не найдена',
    )
  })

  it('без изменений вообще ничего не пишется', async () => {
    const note = await createNote('раз')
    const before = await snapshot()
    const result = await completeNote(note.id, { links: [] })
    expect(result.note).toEqual(note)
    expect(result.createdCards).toEqual([])
    expect(await snapshot()).toEqual(before)
  })
})

describe('дополнение: люди и места', () => {
  it('привязывает существующих человека и место, запись видна в их карточках', async () => {
    const note = await createNote('встреча в парке')
    const person = await createCard({ kind: 'person', name: 'Человек А' })
    const place = await createCard({ kind: 'place', name: 'Место 1' })
    await completeNote(note.id, {
      links: [{ cardId: person.id, role: 'with' }, { cardId: place.id }],
    })
    expect((await listNotesOfCard(person.id)).map((n) => n.id)).toEqual([note.id])
    expect((await listNotesOfCard(place.id)).map((n) => n.id)).toEqual([note.id])
    expect((await listCardsOfNote(note.id)).map((x) => [x.card.name, x.role]).sort()).toEqual([
      ['Место 1', null],
      ['Человек А', 'with'],
    ])
  })

  it('создаёт новые карточки и привязывает их одним действием', async () => {
    const note = await createNote('выставка')
    const { createdCards } = await completeNote(note.id, {
      newCards: [
        { kind: 'person', name: ' Человек Б ' },
        { kind: 'place', name: 'Место 2' },
      ],
      links: [{ newCard: 0, role: 'mentioned' }, { newCard: 1 }],
    })
    expect(createdCards.map((c) => c.name)).toEqual(['Человек Б', 'Место 2'])
    expect(await db.cards.count()).toBe(2)
    const list = await listCardsOfNote(note.id)
    expect(list.map((x) => [x.card.name, x.role]).sort()).toEqual([
      ['Место 2', null],
      ['Человек Б', 'mentioned'],
    ])
    expect((await listNotesOfCard(createdCards[0].id))[0].id).toBe(note.id)
  })

  it('текст, время и привязки сохраняются вместе', async () => {
    const note = await createNote('выставка')
    const person = await createCard({ kind: 'person', name: 'А' })
    const { note: done } = await completeNote(note.id, {
      text: 'выставка после зачёта',
      event: dayEvent(2023, 3, 3),
      newCards: [{ kind: 'place', name: 'Галерея' }],
      links: [{ cardId: person.id, role: 'with' }, { newCard: 0 }],
    })
    expect(done).toMatchObject({ text: 'выставка после зачёта', rev: 2, timeIsAuto: false })
    expect(await listCardsOfNote(note.id)).toHaveLength(2)
  })

  it('отвязывает карточки, которых нет в итоговом списке, но сами карточки остаются', async () => {
    const note = await createNote('раз')
    const a = await createCard({ kind: 'person', name: 'А' })
    const b = await createCard({ kind: 'person', name: 'Б' })
    await linkNote(note.id, a.id)
    await linkNote(note.id, b.id)
    await completeNote(note.id, { links: [{ cardId: b.id }] })
    expect((await listCardsOfNote(note.id)).map((x) => x.card.name)).toEqual(['Б'])
    expect(await listNotesOfCard(a.id)).toEqual([])
    expect(await db.cards.count()).toBe(2)
    const gone = await db.links.get((await db.links.toArray()).find((l) => l.cardId === a.id)!.id)
    expect(gone?.deletedAt).not.toBeNull()
    expect(gone?.rev).toBe(2)
  })

  it('пустой итоговый список отвязывает всех', async () => {
    const note = await createNote('раз')
    const a = await createCard({ kind: 'person', name: 'А' })
    await linkNote(note.id, a.id)
    await completeNote(note.id, { links: [] })
    expect(await listCardsOfNote(note.id)).toEqual([])
  })

  it('роль не указана: у существующей связи остаётся прежняя, null сбрасывает, другая меняет', async () => {
    const note = await createNote('раз')
    const a = await createCard({ kind: 'person', name: 'А' })
    await linkNote(note.id, a.id, 'with')
    const role = async () => (await listCardsOfNote(note.id))[0].role
    await completeNote(note.id, { links: [{ cardId: a.id }] })
    expect(await role()).toBe('with')
    expect((await db.links.toArray())[0].rev).toBe(1)
    await completeNote(note.id, { links: [{ cardId: a.id, role: 'mentioned' }] })
    expect(await role()).toBe('mentioned')
    expect((await db.links.toArray())[0].rev).toBe(2)
    await completeNote(note.id, { links: [{ cardId: a.id, role: null }] })
    expect(await role()).toBeNull()
  })

  it('убранная ранее связь возвращается той же записью', async () => {
    const note = await createNote('раз')
    const a = await createCard({ kind: 'person', name: 'А' })
    const first = await linkNote(note.id, a.id, 'with')
    await unlinkNote(note.id, a.id)
    await completeNote(note.id, { links: [{ cardId: a.id }] })
    const all = await db.links.toArray()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id: first.id, deletedAt: null, role: null, rev: 3 })
  })

  it('повтор карточки в списке даёт одну связь, побеждает последний', async () => {
    const note = await createNote('раз')
    const a = await createCard({ kind: 'person', name: 'А' })
    await completeNote(note.id, {
      links: [
        { cardId: a.id, role: 'with' },
        { cardId: a.id, role: 'mentioned' },
      ],
    })
    expect(await db.links.count()).toBe(1)
    expect((await listCardsOfNote(note.id))[0].role).toBe('mentioned')
  })

  it('метки записи идут в том порядке, в каком их добавили', async () => {
    const note = await createNote('раз')
    // Восемь карточек: случайно совпасть с порядком базы почти невозможно
    const names = ['Яна', 'Борис', 'Аптека', 'Парк', 'Ольга', 'Дом', 'Кафе', 'Игорь']
    const cards: Card[] = []
    for (const [i, name] of names.entries()) {
      cards.push(await createCard({ kind: i % 2 === 0 ? 'person' : 'place', name: `${name}` }))
    }
    const order = [5, 2, 7, 0, 3, 6, 1, 4]
    await completeNote(note.id, { links: order.map((i) => ({ cardId: cards[i].id })) })
    expect((await listCardsOfNote(note.id)).map((x) => x.card.name)).toEqual(
      order.map((i) => names[i]),
    )
  })

  it('связь, не менявшаяся, не получает новую правку', async () => {
    const note = await createNote('раз')
    const a = await createCard({ kind: 'person', name: 'А' })
    await linkNote(note.id, a.id, 'with')
    await completeNote(note.id, { text: 'раз и два', links: [{ cardId: a.id, role: 'with' }] })
    expect((await db.links.toArray())[0].rev).toBe(1)
  })
})

describe('дополнение: всё или ничего', () => {
  it('роль у места отклоняет весь набор: ни текст, ни карточки, ни связи не меняются', async () => {
    const note = await createNote('раз')
    const place = await createCard({ kind: 'place', name: 'Место' })
    const before = await snapshot()
    await expect(
      completeNote(note.id, {
        text: 'новый текст',
        newCards: [{ kind: 'person', name: 'Новый' }],
        links: [{ newCard: 0 }, { cardId: place.id, role: 'with' }],
      }),
    ).rejects.toThrow('только у связи с человеком')
    expect(await snapshot()).toEqual(before)
  })

  it('роль у нового места тоже отклоняется целиком', async () => {
    const note = await createNote('раз')
    const before = await snapshot()
    await expect(
      completeNote(note.id, {
        text: 'другой',
        newCards: [{ kind: 'place', name: 'Новое место' }],
        links: [{ newCard: 0, role: 'mentioned' }],
      }),
    ).rejects.toThrow('Роль')
    expect(await snapshot()).toEqual(before)
  })

  it('неизвестная и удалённая карточка отклоняют весь набор', async () => {
    const note = await createNote('раз')
    const a = await createCard({ kind: 'person', name: 'А' })
    const dead = await createCard({ kind: 'person', name: 'Удалена' })
    await deleteCard(dead.id)
    const before = await snapshot()
    await expect(
      completeNote(note.id, { text: 'два', links: [{ cardId: a.id }, { cardId: 'нет' }] }),
    ).rejects.toThrow('Карточка не найдена')
    await expect(
      completeNote(note.id, { text: 'два', links: [{ cardId: a.id }, { cardId: dead.id }] }),
    ).rejects.toThrow('Карточка не найдена')
    expect(await snapshot()).toEqual(before)
  })

  it('неверная новая карточка (пустое имя, неизвестный вид, неверный номер) отклоняет набор', async () => {
    const note = await createNote('раз')
    const before = await snapshot()
    await expect(
      completeNote(note.id, {
        text: 'два',
        newCards: [{ kind: 'person', name: ' ' }],
        links: [{ newCard: 0 }],
      }),
    ).rejects.toThrow('Имя')
    await expect(
      completeNote(note.id, {
        text: 'два',
        newCards: [{ kind: 'вещь' as never, name: 'Х' }],
        links: [{ newCard: 0 }],
      }),
    ).rejects.toThrow('вид')
    await expect(completeNote(note.id, { text: 'два', links: [{ newCard: 3 }] })).rejects.toThrow(
      'Новая карточка',
    )
    expect(await snapshot()).toEqual(before)
  })

  it('повторное дополнение тем же набором ничего не меняет', async () => {
    const note = await createNote('раз')
    const a = await createCard({ kind: 'person', name: 'А' })
    const input = {
      text: 'раз и два',
      event: dayEvent(2023, 3, 3),
      links: [{ cardId: a.id, role: 'with' as const }],
    }
    await completeNote(note.id, input)
    const after = await snapshot()
    await completeNote(note.id, input)
    expect(await snapshot()).toEqual(after)
  })
})

describe('дополнение с отметкой «дополнено»', () => {
  it('текст, время, привязки и отметка записываются одним действием', async () => {
    const note = await createNote('позвонить')
    const { note: done } = await completeNote(note.id, {
      text: 'позвонить после работы',
      newCards: [{ kind: 'place', name: 'Офис' }],
      links: [{ newCard: 0 }],
      markReviewed: true,
    })
    expect(done.reviewedAt).toBeGreaterThan(0)
    expect(done.rev).toBe(2)
    expect(await getNote(note.id)).toEqual(done)
    expect(await listCardsOfNote(note.id)).toHaveLength(1)
  })

  it('отметка ставится и тогда, когда текст, время и привязки не менялись', async () => {
    const note = await createNote('как есть')
    const { note: done } = await completeNote(note.id, { links: [], markReviewed: true })
    expect(done.reviewedAt).toBeGreaterThan(0)
    expect(done.text).toBe('как есть')
    expect(done.rev).toBe(2)
  })

  it('без просьбы запись неразобранной и остаётся', async () => {
    const note = await createNote('раз')
    const { note: done } = await completeNote(note.id, { text: 'два', links: [] })
    expect(done.reviewedAt).toBeNull()
    const again = await completeNote(note.id, { links: [], markReviewed: false })
    expect(again.note.reviewedAt).toBeNull()
  })

  it('уже отмеченная запись сохраняет прежнее время отметки и не получает лишней правки', async () => {
    const note = await createNote('раз')
    await completeNote(note.id, { links: [], markReviewed: true })
    const marked = (await getNote(note.id))!
    const { note: again } = await completeNote(note.id, { links: [], markReviewed: true })
    expect(again.reviewedAt).toBe(marked.reviewedAt)
    expect(again.rev).toBe(marked.rev)
  })

  it('ошибка в любом месте отменяет и отметку', async () => {
    const note = await createNote('раз')
    const before = await snapshot()
    await expect(
      completeNote(note.id, { text: '  ', links: [], markReviewed: true }),
    ).rejects.toThrow()
    await expect(
      completeNote(note.id, { links: [{ cardId: 'нет такой' }], markReviewed: true }),
    ).rejects.toThrow()
    expect(await snapshot()).toEqual(before)
  })

  it('удалённая запись не отмечается', async () => {
    const note = await createNote('раз')
    await deleteNote(note.id)
    await expect(completeNote(note.id, { links: [], markReviewed: true })).rejects.toThrow()
  })
})
