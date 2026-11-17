import { describe, expect, it } from 'vitest'
import { bumpClock } from './clock'
import { conflictCopy, mergeNote, mergeObject, pickWinner, sameContent } from './merge'
import type { Note } from './types'

const base = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  text: 'исходный текст',
  event: { precision: 'minute', from: '2026-01-01T10:00', to: '2026-01-01T10:00' },
  timeIsAuto: false,
  reviewedAt: null,
  tagIds: [],
  createdAt: 100,
  updatedAt: 100,
  rev: 1,
  clock: { a: 1 },
  deviceId: 'a',
  deletedAt: null,
  ...over,
})

// Правка на устройстве: новая версия на основе прежней
const edit = (n: Note, device: string, changes: Partial<Note>, at: number): Note => ({
  ...n,
  ...changes,
  updatedAt: at,
  rev: n.rev + 1,
  clock: bumpClock(n.clock, device),
  deviceId: device,
})

describe('правила слияния', () => {
  it('своего объекта нет: принимаем как есть, и удалённый тоже', async () => {
    const remote = base()
    expect(await mergeNote(undefined, remote, 'b')).toEqual({ action: 'apply', object: remote })
    const gone = base({ deletedAt: 5 })
    expect(await mergeNote(undefined, gone, 'b')).toEqual({ action: 'apply', object: gone })
  })

  it('та же версия или более старая: пропускаем', async () => {
    const v1 = base()
    const v2 = edit(v1, 'a', { text: 'второй' }, 200)
    expect(await mergeNote(v2, v2, 'b')).toEqual({ action: 'skip' })
    expect(await mergeNote(v2, v1, 'b')).toEqual({ action: 'skip' })
  })

  it('пришедшая включает нашу: принимаем, даже если у нас есть неотправленные правки', async () => {
    const v1 = base()
    const mine = edit(v1, 'b', { text: 'моя правка' }, 150)
    const theirs = edit(mine, 'a', { text: 'их правка поверх моей' }, 300)
    expect(await mergeNote(mine, theirs, 'b')).toEqual({ action: 'apply', object: theirs })
  })

  it('правили независимо, но получилось одно и то же: не конфликт, версии объединяются', async () => {
    const v1 = base()
    const a = edit(v1, 'a', { text: 'одинаково' }, 200)
    const b = edit(v1, 'b', { text: 'одинаково' }, 250)
    const result = await mergeNote(b, a, 'b')
    expect(result.action).toBe('apply')
    if (result.action !== 'apply') return
    expect(result.object.text).toBe('одинаково')
    expect(result.object.clock).toEqual({ a: 2, b: 1 })
  })

  it('независимые правки с разным содержимым: конфликт, копия проигравшей', async () => {
    const v1 = base()
    const a = edit(v1, 'a', { text: 'вариант A' }, 200)
    const b = edit(v1, 'b', { text: 'вариант B' }, 300)
    const result = await mergeNote(a, b, 'a')
    expect(result.action).toBe('conflict')
    if (result.action !== 'conflict') return
    expect(result.object.text).toBe('вариант B') // позже
    expect(result.copy?.text).toBe('вариант A')
    expect(result.copy?.conflictOf).toBe('n1')
    expect(result.copy?.reviewedAt).toBeNull()
  })

  it('итог конфликта новее обеих версий и принадлежит этому устройству', async () => {
    const v1 = base()
    const a = edit(v1, 'a', { text: 'A' }, 200)
    const b = edit(v1, 'b', { text: 'B' }, 300)
    const result = await mergeNote(a, b, 'a')
    if (result.action !== 'conflict') throw new Error('нужен конфликт')
    expect(result.object.rev).toBe(Math.max(a.rev, b.rev) + 1)
    expect(result.object.deviceId).toBe('a')
    expect(result.object.clock).toEqual({ a: 3, b: 1 })
    // новее каждой из версий: пришедшее потом на другое устройство принимается без конфликта
    expect(await mergeNote(b, result.object, 'b')).toEqual({
      action: 'apply',
      object: result.object,
    })
    expect(await mergeNote(a, result.object, 'a')).toEqual({
      action: 'apply',
      object: result.object,
    })
  })

  it('удаление против правки: побеждает более позднее', async () => {
    const v1 = base()
    const editedLater = edit(v1, 'a', { text: 'правка' }, 400)
    const deleted = edit(v1, 'b', { deletedAt: 300 }, 300)
    const keepEdit = await mergeNote(deleted, editedLater, 'b')
    if (keepEdit.action !== 'conflict') throw new Error('нужен конфликт')
    expect(keepEdit.object.deletedAt).toBeNull()
    expect(keepEdit.object.text).toBe('правка')
    expect(keepEdit.copy).toBeNull() // проигравшее удаление копировать нечего

    const deletedLater = edit(v1, 'b', { deletedAt: 500 }, 500)
    const keepDelete = await mergeNote(editedLater, deletedLater, 'a')
    if (keepDelete.action !== 'conflict') throw new Error('нужен конфликт')
    expect(keepDelete.object.deletedAt).not.toBeNull()
    expect(keepDelete.copy?.text).toBe('правка') // текст не пропадает
    expect(keepDelete.copy?.deletedAt).toBeNull()
  })

  it('два удаления это одно и то же', async () => {
    const v1 = base()
    const a = edit(v1, 'a', { deletedAt: 200 }, 200)
    const b = edit(v1, 'b', { deletedAt: 300 }, 300)
    expect((await mergeNote(a, b, 'a')).action).toBe('apply')
  })

  it('без функции копирования конфликт не создаёт копию', async () => {
    const v1 = base()
    const a = edit(v1, 'a', { text: 'A' }, 200)
    const b = edit(v1, 'b', { text: 'B' }, 300)
    const result = await mergeObject(a, b, 'a')
    expect(result.action).toBe('conflict')
    if (result.action === 'conflict') expect(result.copy).toBeNull()
  })
})

describe('победитель', () => {
  it('сначала позднее время, потом большее число правок, потом устройство', () => {
    const early = base({ updatedAt: 100, rev: 9, deviceId: 'z' })
    const late = base({ updatedAt: 200, rev: 1, deviceId: 'a' })
    expect(pickWinner(early, late)).toBe(late)
    const sameTimeLowRev = base({ updatedAt: 200, rev: 1, deviceId: 'z' })
    const sameTimeHighRev = base({ updatedAt: 200, rev: 2, deviceId: 'a' })
    expect(pickWinner(sameTimeLowRev, sameTimeHighRev)).toBe(sameTimeHighRev)
    const x = base({ updatedAt: 200, rev: 2, deviceId: 'a' })
    const y = base({ updatedAt: 200, rev: 2, deviceId: 'b' })
    expect(pickWinner(x, y)).toBe(y)
  })

  it('результат не зависит от порядка аргументов', () => {
    const samples = [
      base({ updatedAt: 100, rev: 1, deviceId: 'a' }),
      base({ updatedAt: 100, rev: 2, deviceId: 'b' }),
      base({ updatedAt: 200, rev: 1, deviceId: 'c' }),
      base({ updatedAt: 200, rev: 1, deviceId: 'd' }),
    ]
    for (const p of samples)
      for (const q of samples) if (p !== q) expect(pickWinner(p, q)).toBe(pickWinner(q, p))
  })
})

describe('копия при конфликте', () => {
  it('другое содержимое даёт другую копию, id похож на UUID', async () => {
    const one = await conflictCopy(base({ text: 'раз' }))
    const other = await conflictCopy(base({ text: 'два' }))
    const otherNote = await conflictCopy(base({ id: 'n2', text: 'раз' }))
    expect(new Set([one.id, other.id, otherNote.id]).size).toBe(3)
    expect(one.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('кто и когда правил, на копию не влияет: важно только содержимое', async () => {
    const one = await conflictCopy(base({ text: 'раз', deviceId: 'b', rev: 3 }))
    const same = await conflictCopy(base({ text: 'раз', deviceId: 'c', rev: 9, clock: { c: 9 } }))
    expect(one).toEqual(same)
  })

  it('сохраняет текст, время и время создания, не считается дополненной', async () => {
    const loser = base({
      text: 'текст',
      reviewedAt: 123,
      tagIds: ['t'],
      createdAt: 77,
      updatedAt: 88,
    })
    const copy = await conflictCopy(loser)
    expect(copy).toMatchObject({
      text: 'текст',
      event: loser.event,
      tagIds: ['t'],
      createdAt: 77,
      updatedAt: 88,
      reviewedAt: null,
      rev: 1,
      conflictOf: 'n1',
      deletedAt: null,
    })
  })
})

describe('отметка «дополнено» при слиянии', () => {
  it('отметили на двух устройствах в разное время: это не конфликт, оба берут раннее время', async () => {
    const start = base()
    const onA = edit(start, 'a', { reviewedAt: 500 }, 500)
    const onB = edit(start, 'b', { reviewedAt: 300 }, 300)
    expect(sameContent(onA, onB)).toBe(true)
    // Устройство с поздним временем получает раннее: итог совпадает с пришедшим, отправлять нечего
    const atA = await mergeNote(onA, onB, 'a')
    expect(atA.action).toBe('apply')
    if (atA.action === 'apply') expect(atA.object.reviewedAt).toBe(300)
    // Устройство с ранним временем получает позднее: другие устройства его раннего времени не знают,
    // поэтому итог это новая правка, которую надо отправить
    const atB = await mergeNote(onB, onA, 'b')
    expect(atB.action).toBe('conflict')
    if (atB.action !== 'conflict') return
    expect(atB.copy).toBeNull()
    expect(atB.object.reviewedAt).toBe(300)
    expect(atB.object.clock).toEqual({ a: 2, b: 2 })
    expect(atB.object.rev).toBe(3)
    // Устройство с поздним временем принимает этот итог без нового конфликта
    expect((await mergeNote(onA, atB.object, 'a')).action).toBe('apply')
  })

  it('отметили на одном, а на другом правили текст: это конфликт, текст не теряется', async () => {
    const start = base()
    const marked = edit(start, 'a', { reviewedAt: 500 }, 500)
    const edited = edit(start, 'b', { text: 'новый текст' }, 400)
    const result = await mergeNote(edited, marked, 'b')
    expect(result.action).toBe('conflict')
    if (result.action !== 'conflict') return
    const texts = [result.object.text, result.copy?.text]
    expect(texts).toContain('новый текст')
    expect(texts).toContain('исходный текст')
  })

  it('отметили на одном, на другом ничего не менялось: отметка принимается', async () => {
    const start = base()
    const marked = edit(start, 'a', { reviewedAt: 500 }, 500)
    expect(await mergeNote(start, marked, 'b')).toEqual({ action: 'apply', object: marked })
  })

  it('на одном сняли отметку, на другом поставили заново и правили текст: побеждает позднее', async () => {
    const start = base({ reviewedAt: 100 })
    const unmarked = edit(start, 'a', { reviewedAt: null }, 600)
    const remarked = edit(start, 'b', { reviewedAt: 200, text: 'иначе' }, 300)
    const result = await mergeNote(remarked, unmarked, 'b')
    expect(result.action).toBe('conflict')
    if (result.action !== 'conflict') return
    expect(result.object.reviewedAt).toBeNull()
  })
})

describe('сравнение содержимого', () => {
  it('служебные поля правки не считаются', () => {
    const a = base()
    const b = { ...a, rev: 9, updatedAt: 999, deviceId: 'z', clock: { z: 9 } }
    expect(sameContent(a, b)).toBe(true)
  })

  it('любое другое поле считается', () => {
    const a = base()
    expect(sameContent(a, base({ text: 'другой' }))).toBe(false)
    expect(sameContent(a, base({ tagIds: ['x'] }))).toBe(false)
    expect(sameContent(a, base({ reviewedAt: 1 }))).toBe(false)
    expect(sameContent(base({ reviewedAt: 1 }), base({ reviewedAt: 2 }))).toBe(true)
    expect(sameContent(a, base({ conflictOf: 'x' }))).toBe(false)
    expect(sameContent(a, base({ event: { ...a.event, to: '2026-01-02T10:00' } }))).toBe(false)
  })

  it('порядок полей не важен, пустое поле и отсутствующее одно и то же', () => {
    const a = base()
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as unknown as Note
    expect(sameContent(a, reordered)).toBe(true)
    expect(sameContent(a, { ...a, conflictOf: undefined } as Note)).toBe(true)
  })

  it('живой и удалённый различаются, два удалённых одинаковы', () => {
    expect(sameContent(base(), base({ deletedAt: 5 }))).toBe(false)
    expect(
      sameContent(base({ deletedAt: 5, text: 'раз' }), base({ deletedAt: 9, text: 'два' })),
    ).toBe(true)
  })
})
