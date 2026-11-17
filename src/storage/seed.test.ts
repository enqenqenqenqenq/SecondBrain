import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { isValidEvent } from './fuzzyTime'
import { countNotes, createNote, listNotes } from './index'
import { SEED_TAG, generateNotes, removeSeededNotes, seedNotes } from './seed'

const now = new Date(2026, 10, 17, 15, 0)

describe('генерация', () => {
  it('создаёт ровно столько записей, сколько попросили', () => {
    expect(generateNotes(0, { now })).toHaveLength(0)
    expect(generateNotes(500, { now })).toHaveLength(500)
    expect(generateNotes(5000, { now })).toHaveLength(5000)
  })

  it('одно и то же начало даёт одни и те же тексты и время', () => {
    const a = generateNotes(300, { seed: 42, now })
    const b = generateNotes(300, { seed: 42, now })
    expect(a.map((n) => [n.text, n.event, n.createdAt])).toEqual(
      b.map((n) => [n.text, n.event, n.createdAt]),
    )
  })

  it('другое начало даёт другие данные', () => {
    const a = generateNotes(100, { seed: 1, now })
    const b = generateNotes(100, { seed: 2, now })
    expect(a.map((n) => n.text)).not.toEqual(b.map((n) => n.text))
  })

  it('все записи целые: время проходит проверку, текст не пустой, номера разные', () => {
    const notes = generateNotes(2000, { now })
    expect(notes.every((n) => isValidEvent(n.event))).toBe(true)
    expect(notes.every((n) => n.text.trim().length > 0)).toBe(true)
    expect(new Set(notes.map((n) => n.id)).size).toBe(2000)
    expect(notes.every((n) => n.rev === 1 && n.deletedAt === null)).toBe(true)
  })

  it('встречаются все шесть точностей, а точных записей больше всего', () => {
    const notes = generateNotes(5000, { now })
    const count = (p: string) => notes.filter((n) => n.event.precision === p).length
    for (const p of ['minute', 'day', 'month', 'season', 'year', 'range']) {
      expect(count(p), p).toBeGreaterThan(50)
    }
    expect(count('minute')).toBeGreaterThan(count('day'))
    expect(count('day')).toBeGreaterThan(count('year'))
  })

  it('записи лежат в пределах заданного числа лет и не начинаются в будущем', () => {
    const notes = generateNotes(3000, { now, years: 4 })
    const earliest = new Date(2026 - 4 - 1, 0, 1)
    const nowStamp = '2026-11-17T15:00'
    for (const n of notes) {
      expect(n.event.from <= nowStamp, n.event.from).toBe(true)
      expect(new Date(n.event.from) >= earliest, n.event.from).toBe(true)
      expect(n.createdAt).toBeLessThanOrEqual(now.getTime())
    }
  })

  it('время сохранения не раньше начала события', () => {
    const notes = generateNotes(2000, { now })
    for (const n of notes) {
      expect(n.createdAt).toBeGreaterThanOrEqual(new Date(n.event.from).getTime() - 60_000)
    }
  })

  it('у части записей есть переносы строк и есть длинные', () => {
    const notes = generateNotes(2000, { now })
    expect(notes.some((n) => n.text.includes('\n'))).toBe(true)
    expect(notes.some((n) => n.text.length > 300)).toBe(true)
    expect(notes.some((n) => n.text.length < 60)).toBe(true)
  })

  it('есть и разобранные, и неразобранные записи, все помечены как тестовые', () => {
    const notes = generateNotes(2000, { now })
    const reviewed = notes.filter((n) => n.reviewedAt !== null).length
    expect(reviewed).toBeGreaterThan(300)
    expect(reviewed).toBeLessThan(1000)
    expect(notes.every((n) => n.tagIds.includes(SEED_TAG))).toBe(true)
  })

  it('5000 записей создаются быстро', () => {
    const started = performance.now()
    generateNotes(5000, { now })
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('запись в базу', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('записывает столько, сколько создано, и они читаются в правильном порядке', async () => {
    expect(await seedNotes(500, { now })).toBe(500)
    expect(await countNotes()).toBe(500)
    const list = await listNotes()
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].event.from >= list[i].event.from).toBe(true)
    }
  })

  it('повторный вызов добавляет ещё записи, ничего не затирая', async () => {
    await seedNotes(100, { now, seed: 1 })
    await seedNotes(100, { now, seed: 2 })
    expect(await countNotes()).toBe(200)
  })

  it('удаление тестовых записей не трогает настоящие', async () => {
    const mine = await createNote('Моя настоящая запись')
    await seedNotes(300, { now })
    expect(await countNotes()).toBe(301)
    expect(await removeSeededNotes()).toBe(300)
    expect(await countNotes()).toBe(1)
    expect((await listNotes())[0].id).toBe(mine.id)
  })

  it('удаление при отсутствии тестовых записей ничего не делает', async () => {
    await createNote('одна')
    expect(await removeSeededNotes()).toBe(0)
    expect(await countNotes()).toBe(1)
  })
})
