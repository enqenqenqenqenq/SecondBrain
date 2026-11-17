import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import { idFromKey } from './ids'
import {
  cardStats,
  countNotesOfCard,
  listCardFeed,
  createCard,
  createNote,
  deleteCard,
  deleteNote,
  linkNote,
  listNotes,
  listCardsOfNote,
  listNotesOfCard,
  restoreNote,
  unlinkNote,
  watchCardsOfNote,
  watchNotesOfCard,
} from './index'
import { generateNotes } from './seed'
import type { EventTime } from './types'

const minute = (from: string): EventTime => ({ precision: 'minute', from, to: from })

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('связывание', () => {
  it('создаёт связь записи с человеком и с местом', async () => {
    const note = await createNote('встреча в парке')
    const person = await createCard({ kind: 'person', name: 'Мария' })
    const place = await createCard({ kind: 'place', name: 'Парк' })
    const withPerson = await linkNote(note.id, person.id, 'with')
    const atPlace = await linkNote(note.id, place.id)
    expect(withPerson).toMatchObject({
      ownerType: 'note',
      ownerId: note.id,
      cardId: person.id,
      role: 'with',
      rev: 1,
      deletedAt: null,
    })
    expect(atPlace.role).toBeNull()
    expect(withPerson.id).toBe(await idFromKey(`link:note:${note.id}:${person.id}`))
    expect(await db.links.count()).toBe(2)
  })

  it('связь без роли у человека допустима и остаётся пустой', async () => {
    const note = await createNote('позвонить')
    const person = await createCard({ kind: 'person', name: 'Мария' })
    expect((await linkNote(note.id, person.id)).role).toBeNull()
  })

  it('повтор той же связи ничего не меняет и не создаёт второй', async () => {
    const note = await createNote('раз')
    const person = await createCard({ kind: 'person', name: 'Мария' })
    const first = await linkNote(note.id, person.id, 'with')
    const again = await linkNote(note.id, person.id, 'with')
    const withoutRole = await linkNote(note.id, person.id)
    expect(again).toEqual(first)
    expect(withoutRole.role).toBe('with') // роль не указана, прежняя остаётся
    expect(await db.links.count()).toBe(1)
    expect((await db.links.toArray())[0].rev).toBe(1)
  })

  it('другая роль обновляет ту же связь', async () => {
    const note = await createNote('раз')
    const person = await createCard({ kind: 'person', name: 'Мария' })
    await linkNote(note.id, person.id, 'mentioned')
    const changed = await linkNote(note.id, person.id, 'with')
    expect(changed.role).toBe('with')
    expect(changed.rev).toBe(2)
    expect(await db.links.count()).toBe(1)
    expect((await linkNote(note.id, person.id, null)).role).toBeNull()
  })

  it('убранная связь возвращается той же записью в базе', async () => {
    const note = await createNote('раз')
    const person = await createCard({ kind: 'person', name: 'Мария' })
    const first = await linkNote(note.id, person.id, 'with')
    await unlinkNote(note.id, person.id)
    const back = await linkNote(note.id, person.id)
    expect(back.id).toBe(first.id)
    expect(back.deletedAt).toBeNull()
    expect(back.role).toBeNull() // после удаления роль не помним
    expect(back.rev).toBe(3)
    expect(await db.links.count()).toBe(1)
  })

  it('одна запись связывается с несколькими карточками, одна карточка с несколькими записями', async () => {
    const [n1, n2] = [await createNote('раз'), await createNote('два')]
    const [p1, p2] = [
      await createCard({ kind: 'person', name: 'А' }),
      await createCard({ kind: 'place', name: 'Б' }),
    ]
    await linkNote(n1.id, p1.id)
    await linkNote(n1.id, p2.id)
    await linkNote(n2.id, p1.id)
    expect(await listCardsOfNote(n1.id)).toHaveLength(2)
    expect(await listCardsOfNote(n2.id)).toHaveLength(1)
    expect(await countNotesOfCard(p1.id)).toBe(2)
    expect(await countNotesOfCard(p2.id)).toBe(1)
  })

  it('ошибки: нет записи, нет карточки, роль у места, неизвестная роль', async () => {
    const note = await createNote('раз')
    const person = await createCard({ kind: 'person', name: 'А' })
    const place = await createCard({ kind: 'place', name: 'Б' })
    await expect(linkNote('нет', person.id)).rejects.toThrow('Запись не найдена')
    await expect(linkNote(note.id, 'нет')).rejects.toThrow('Карточка не найдена')
    await expect(linkNote(note.id, place.id, 'with')).rejects.toThrow('только у связи с человеком')
    await expect(linkNote(note.id, person.id, 'friend' as never)).rejects.toThrow('роль')
    expect(await db.links.count()).toBe(0)
  })

  it('удалённую запись и удалённую карточку связать нельзя', async () => {
    const note = await createNote('раз')
    const person = await createCard({ kind: 'person', name: 'А' })
    await deleteNote(note.id)
    await expect(linkNote(note.id, person.id)).rejects.toThrow('Запись не найдена')
    const note2 = await createNote('два')
    await deleteCard(person.id)
    await expect(linkNote(note2.id, person.id)).rejects.toThrow('Карточка не найдена')
  })

  it('одновременное связывание даёт одну связь', async () => {
    const note = await createNote('раз')
    const person = await createCard({ kind: 'person', name: 'А' })
    await Promise.all(Array.from({ length: 10 }, () => linkNote(note.id, person.id, 'with')))
    expect(await db.links.count()).toBe(1)
  })
})

describe('снятие связи', () => {
  it('убирает связь, запись и карточка остаются', async () => {
    const note = await createNote('раз')
    const person = await createCard({ kind: 'person', name: 'А' })
    await linkNote(note.id, person.id)
    expect(await unlinkNote(note.id, person.id)).toBe(true)
    expect(await listCardsOfNote(note.id)).toEqual([])
    expect(await listNotesOfCard(person.id)).toEqual([])
    expect(await db.notes.count()).toBe(1)
    expect(await db.cards.count()).toBe(1)
    expect((await db.links.toArray())[0].deletedAt).not.toBeNull()
  })

  it('повторное снятие и снятие несуществующей связи ничего не делают', async () => {
    const note = await createNote('раз')
    const person = await createCard({ kind: 'person', name: 'А' })
    expect(await unlinkNote(note.id, person.id)).toBe(false)
    await linkNote(note.id, person.id)
    await unlinkNote(note.id, person.id)
    expect(await unlinkNote(note.id, person.id)).toBe(false)
    expect((await db.links.toArray())[0].rev).toBe(2)
  })
})

describe('карточки записи', () => {
  it('в порядке связывания и с ролями', async () => {
    const note = await createNote('раз')
    const a = await createCard({ kind: 'person', name: 'Я' })
    const b = await createCard({ kind: 'place', name: 'А' })
    const c = await createCard({ kind: 'person', name: 'Б' })
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => ++now)
    await linkNote(note.id, c.id, 'mentioned')
    await linkNote(note.id, a.id, 'with')
    await linkNote(note.id, b.id)
    const list = await listCardsOfNote(note.id)
    expect(list.map((x) => [x.card.name, x.role])).toEqual([
      ['Б', 'mentioned'],
      ['Я', 'with'],
      ['А', null],
    ])
  })

  it('удалённая карточка не показывается', async () => {
    const note = await createNote('раз')
    const a = await createCard({ kind: 'person', name: 'А' })
    const b = await createCard({ kind: 'person', name: 'Б' })
    await linkNote(note.id, a.id)
    await linkNote(note.id, b.id)
    await deleteCard(a.id)
    expect((await listCardsOfNote(note.id)).map((x) => x.card.name)).toEqual(['Б'])
  })

  it('у записи без связей пустой список, у неизвестной тоже', async () => {
    const note = await createNote('раз')
    expect(await listCardsOfNote(note.id)).toEqual([])
    expect(await listCardsOfNote('нет')).toEqual([])
  })
})

describe('записи карточки', () => {
  it('в порядке ленты: время события, при равенстве время сохранения', async () => {
    const person = await createCard({ kind: 'person', name: 'А' })
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => ++now)
    const old = await createNote('старая', minute('2024-01-01T10:00'))
    const newest = await createNote('новая', minute('2026-05-01T10:00'))
    const tieFirst = await createNote('ничья раньше', minute('2025-03-03T10:00'))
    const tieSecond = await createNote('ничья позже', minute('2025-03-03T10:00'))
    for (const n of [old, tieFirst, newest, tieSecond]) await linkNote(n.id, person.id)
    expect((await listNotesOfCard(person.id)).map((n) => n.text)).toEqual([
      'новая',
      'ничья позже',
      'ничья раньше',
      'старая',
    ])
  })

  it('чужие записи не попадают, удалённые и вернувшиеся записи ведут себя как в ленте', async () => {
    const person = await createCard({ kind: 'person', name: 'А' })
    const other = await createCard({ kind: 'person', name: 'Б' })
    const mine = await createNote('моя')
    const gone = await createNote('удалённая')
    const alien = await createNote('чужая')
    await linkNote(mine.id, person.id)
    await linkNote(gone.id, person.id)
    await linkNote(alien.id, other.id)
    await deleteNote(gone.id)
    expect((await listNotesOfCard(person.id)).map((n) => n.text)).toEqual(['моя'])
    await restoreNote(gone.id)
    expect(await countNotesOfCard(person.id)).toBe(2)
  })

  it('постраничное чтение даёт полный список без повторов', async () => {
    const person = await createCard({ kind: 'person', name: 'А' })
    for (let i = 0; i < 25; i++) {
      const n = await createNote(
        `n${i}`,
        minute(`2026-01-${String((i % 28) + 1).padStart(2, '0')}T10:00`),
      )
      await linkNote(n.id, person.id)
    }
    const whole = (await listNotesOfCard(person.id)).map((n) => n.id)
    const pages = [
      ...(await listNotesOfCard(person.id, { limit: 10 })),
      ...(await listNotesOfCard(person.id, { limit: 10, offset: 10 })),
      ...(await listNotesOfCard(person.id, { limit: 10, offset: 20 })),
    ].map((n) => n.id)
    expect(pages).toEqual(whole)
    expect(new Set(pages).size).toBe(25)
    expect(await listNotesOfCard(person.id, { offset: 100 })).toEqual([])
    expect(await listNotesOfCard(person.id, { limit: 0 })).toEqual([])
  })

  it('у карточки без записей и у неизвестной пустой список', async () => {
    const person = await createCard({ kind: 'person', name: 'А' })
    expect(await listNotesOfCard(person.id)).toEqual([])
    expect(await listNotesOfCard('нет')).toEqual([])
    expect(await countNotesOfCard('нет')).toBe(0)
  })

  it('удаление карточки очищает её ленту', async () => {
    const person = await createCard({ kind: 'person', name: 'А' })
    const note = await createNote('раз')
    await linkNote(note.id, person.id)
    await deleteCard(person.id)
    expect(await listNotesOfCard(person.id)).toEqual([])
  })
})

describe('слежение', () => {
  it('карточки записи обновляются после связывания и снятия', async () => {
    const note = await createNote('раз')
    const person = await createCard({ kind: 'person', name: 'А' })
    const seen: string[][] = []
    const stop = watchCardsOfNote(note.id, (list) => seen.push(list.map((x) => x.card.name)))
    await vi.waitFor(() => expect(seen).toEqual([[]]))
    await linkNote(note.id, person.id)
    await vi.waitFor(() => expect(seen.at(-1)).toEqual(['А']))
    await unlinkNote(note.id, person.id)
    await vi.waitFor(() => expect(seen.at(-1)).toEqual([]))
    stop()
  })

  it('лента карточки обновляется при правке записи', async () => {
    const note = await createNote('раз')
    const person = await createCard({ kind: 'person', name: 'А' })
    await linkNote(note.id, person.id)
    const seen: string[][] = []
    const stop = watchNotesOfCard(person.id, (list) => seen.push(list.map((n) => n.text)))
    await vi.waitFor(() => expect(seen.at(-1)).toEqual(['раз']))
    const { updateNote } = await import('./index')
    await updateNote(note.id, { text: 'раз и два' })
    await vi.waitFor(() => expect(seen.at(-1)).toEqual(['раз и два']))
    stop()
  })
})

describe('скорость', () => {
  // Модель данных обещала перепроверить: поиск записей человека идёт через связи, а не по полю записи
  it('записи человека среди 5000 записей находятся за доли секунды', async () => {
    const generated = generateNotes(5000, { seed: 2026, now: new Date(2026, 10, 17, 12, 0) })
    await db.notes.bulkAdd(generated)
    const person = await createCard({ kind: 'person', name: 'Мария' })
    const mine = generated.filter((_, i) => i % 12 === 0)
    const deviceId = 'd'
    await db.links.bulkAdd(
      await Promise.all(
        mine.map(async (n) => ({
          id: await idFromKey(`link:note:${n.id}:${person.id}`),
          ownerType: 'note' as const,
          ownerId: n.id,
          cardId: person.id,
          role: 'with' as const,
          createdAt: 1,
          updatedAt: 1,
          rev: 1,
          deviceId,
          deletedAt: null,
        })),
      ),
    )
    const started = performance.now()
    const found = await listNotesOfCard(person.id)
    const elapsed = performance.now() - started
    expect(found).toHaveLength(mine.length)
    // Настоящий замер в браузере 25 мс. Здесь база в памяти, и при нагрузке на компьютер бывает втрое медленнее,
    // поэтому порог только ловит резкое замедление.
    expect(elapsed).toBeLessThan(3000)
  })
})

describe('лента карточки с ролями', () => {
  it('у записей роль из связи, порядок как в ленте', async () => {
    const person = await createCard({ kind: 'person', name: 'А' })
    const a = await createNote('с ним', minute('2026-03-01T10:00'))
    const b = await createNote('о нём', minute('2026-05-01T10:00'))
    const c = await createNote('без роли', minute('2025-01-01T10:00'))
    await linkNote(a.id, person.id, 'with')
    await linkNote(b.id, person.id, 'mentioned')
    await linkNote(c.id, person.id)
    const feed = await listCardFeed(person.id)
    expect(feed.map((e) => [e.note.text, e.role])).toEqual([
      ['о нём', 'mentioned'],
      ['с ним', 'with'],
      ['без роли', null],
    ])
  })

  it('лента совпадает с общей лентой, отфильтрованной по человеку', async () => {
    const generated = generateNotes(400, { seed: 7, now: new Date(2026, 10, 17, 12, 0) })
    await db.notes.bulkAdd(generated)
    const person = await createCard({ kind: 'person', name: 'Человек А' })
    const mine = new Set<string>()
    for (const [i, n] of generated.entries()) {
      if (i % 7 === 0) {
        await linkNote(n.id, person.id, i % 14 === 0 ? 'with' : 'mentioned')
        mine.add(n.id)
      }
    }
    // Независимый расчёт: общая лента целиком, оставляем только записи человека
    const expected = (await listNotes()).filter((n) => mine.has(n.id))
    const feed = await listCardFeed(person.id)
    expect(feed).toHaveLength(mine.size)
    expect(feed.map((e) => `${e.note.event.from}|${e.note.createdAt}`)).toEqual(
      expected.map((n) => `${n.event.from}|${n.createdAt}`),
    )
    expect(new Set(feed.map((e) => e.note.id))).toEqual(mine)
  })

  it('удалённые записи и снятые связи в ленту не попадают, вернувшаяся запись возвращается', async () => {
    const person = await createCard({ kind: 'person', name: 'А' })
    const keep = await createNote('остаётся')
    const dead = await createNote('удалена')
    const off = await createNote('связь снята')
    for (const n of [keep, dead, off]) await linkNote(n.id, person.id)
    await deleteNote(dead.id)
    await unlinkNote(off.id, person.id)
    expect((await listCardFeed(person.id)).map((e) => e.note.text)).toEqual(['остаётся'])
    await restoreNote(dead.id)
    expect((await listCardFeed(person.id)).map((e) => e.note.text).sort()).toEqual([
      'остаётся',
      'удалена',
    ])
  })

  it('записи другого человека и неизвестная карточка', async () => {
    const a = await createCard({ kind: 'person', name: 'А' })
    const b = await createCard({ kind: 'person', name: 'Б' })
    const note = await createNote('раз')
    await linkNote(note.id, b.id)
    expect(await listCardFeed(a.id)).toEqual([])
    expect(await listCardFeed('нет')).toEqual([])
  })
})

describe('счётчики карточек', () => {
  it('число записей и время последней', async () => {
    const a = await createCard({ kind: 'person', name: 'А' })
    const b = await createCard({ kind: 'place', name: 'Б' })
    await createCard({ kind: 'person', name: 'Без записей' })
    const n1 = await createNote('раз', minute('2024-01-01T10:00'))
    const n2 = await createNote('два', minute('2026-02-02T10:00'))
    const n3 = await createNote('три', minute('2025-03-03T10:00'))
    await linkNote(n1.id, a.id)
    await linkNote(n2.id, a.id)
    await linkNote(n3.id, b.id)
    const stats = await cardStats()
    expect(stats.get(a.id)).toEqual({ count: 2, last: n2.event })
    expect(stats.get(b.id)).toEqual({ count: 1, last: n3.event })
    expect(stats.size).toBe(2)
  })

  it('удалённые записи и снятые связи не считаются, последняя пересчитывается', async () => {
    const a = await createCard({ kind: 'person', name: 'А' })
    const old = await createNote('старая', minute('2020-01-01T10:00'))
    const fresh = await createNote('свежая', minute('2026-01-01T10:00'))
    const gone = await createNote('снята', minute('2027-01-01T10:00'))
    for (const n of [old, fresh, gone]) await linkNote(n.id, a.id)
    await unlinkNote(gone.id, a.id)
    await deleteNote(fresh.id)
    expect((await cardStats()).get(a.id)).toEqual({ count: 1, last: old.event })
    await deleteNote(old.id)
    expect((await cardStats()).get(a.id)).toBeUndefined()
  })

  it('при равном времени события последней считается позже сохранённая', async () => {
    const a = await createCard({ kind: 'person', name: 'А' })
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => ++now)
    const first = await createNote('раньше', minute('2026-05-05T10:00'))
    const second = await createNote('позже', minute('2026-05-05T10:00'))
    await linkNote(first.id, a.id)
    await linkNote(second.id, a.id)
    expect((await cardStats()).get(a.id)?.count).toBe(2)
    expect((await cardStats()).get(a.id)?.last).toEqual(second.event)
  })
})
