import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, getDeviceId } from './db'
import { createNote, deleteNote, getNote, listNotes, restoreNote, updateNote } from './index'
import type { EventTime } from './types'

const minute = (from: string): EventTime => ({ precision: 'minute', from, to: from })

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('необычный текст', () => {
  it('сохраняет переносы строк, эмодзи и смесь алфавитов без изменений', async () => {
    const text = 'Первая строка\nвторая строка\n\nthird line 🙂 日本語 ñ'
    const note = await createNote(text)
    expect((await getNote(note.id))?.text).toBe(text)
  })

  it('сохраняет очень длинный текст целиком', async () => {
    const text = 'слово '.repeat(20_000).trim()
    const note = await createNote(text)
    expect((await getNote(note.id))?.text).toHaveLength(text.length)
  })

  it('сохраняет текст, похожий на код и разметку, как есть', async () => {
    const text = '<script>alert(1)</script> \'; DROP TABLE notes; -- {"a": [1]}'
    const note = await createNote(text)
    expect((await getNote(note.id))?.text).toBe(text)
  })
})

describe('параллельные записи', () => {
  it('пятьдесят одновременных записей не теряются и имеют разные номера', async () => {
    const created = await Promise.all(
      Array.from({ length: 50 }, (_, i) => createNote(`запись ${i}`)),
    )
    expect(new Set(created.map((n) => n.id)).size).toBe(50)
    expect(await listNotes()).toHaveLength(50)
  })

  it('номер устройства при одновременных запросах один и тот же', async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, () => getDeviceId()))
    expect(new Set(ids).size).toBe(1)
  })
})

describe('постраничное чтение', () => {
  it('страницы вместе дают полный список без повторов и пропусков', async () => {
    for (let i = 0; i < 250; i++) {
      const day = String((i % 28) + 1).padStart(2, '0')
      await createNote(`n${i}`, minute(`2026-0${(i % 9) + 1}-${day}T10:00`))
    }
    const whole = await listNotes()
    const pages: string[] = []
    for (let offset = 0; offset < 300; offset += 100) {
      pages.push(...(await listNotes({ limit: 100, offset })).map((n) => n.id))
    }
    expect(pages).toEqual(whole.map((n) => n.id))
    expect(new Set(pages).size).toBe(250)
  })

  it('смещение за пределами списка и нулевой предел дают пустой список', async () => {
    await createNote('одна')
    expect(await listNotes({ offset: 10 })).toEqual([])
    expect(await listNotes({ limit: 0 })).toEqual([])
  })
})

describe('жизнь записи от создания до возвращения', () => {
  it('номер правки растёт на единицу при каждом изменении', async () => {
    const note = await createNote('жизнь')
    expect(note.rev).toBe(1)
    expect((await updateNote(note.id, { text: 'жизнь 2' }))?.rev).toBe(2)
    await deleteNote(note.id)
    expect((await db.notes.get(note.id))?.rev).toBe(3)
    await restoreNote(note.id)
    expect((await getNote(note.id))?.rev).toBe(4)
  })

  it('изменение не трогает номер, создание и время события, если их не просили', async () => {
    const note = await createNote('как было', minute('2024-05-05T05:05'))
    const changed = await updateNote(note.id, { text: 'стало иначе' })
    expect(changed?.id).toBe(note.id)
    expect(changed?.createdAt).toBe(note.createdAt)
    expect(changed?.event).toEqual(note.event)
    expect(changed?.timeIsAuto).toBe(note.timeIsAuto)
  })

  it('пустое изменение не создаёт новую правку', async () => {
    const note = await createNote('без изменений')
    const same = await updateNote(note.id, {})
    expect(same?.rev).toBe(1)
    expect(same?.updatedAt).toBe(note.updatedAt)
    expect((await db.notes.get(note.id))?.rev).toBe(1)
  })

  it('отмена удаления неизвестной записи ничего не делает', async () => {
    expect(await restoreNote('нет-такой')).toBe(false)
  })

  it('вернувшаяся запись встаёт на прежнее место в ленте', async () => {
    const a = await createNote('верхняя', minute('2026-11-02T10:00'))
    const b = await createNote('средняя', minute('2026-11-01T10:00'))
    const c = await createNote('нижняя', minute('2026-10-01T10:00'))
    await deleteNote(b.id)
    expect((await listNotes()).map((n) => n.id)).toEqual([a.id, c.id])
    await restoreNote(b.id)
    expect((await listNotes()).map((n) => n.id)).toEqual([a.id, b.id, c.id])
  })
})

describe('схема базы и миграции', () => {
  it('схема версии 3 не менялась без миграции', () => {
    const schema = Object.fromEntries(
      db.tables.map((t) => [
        t.name,
        { primKey: t.schema.primKey.src, indexes: t.schema.indexes.map((i) => i.src).sort() },
      ]),
    )
    expect(
      { version: db.verno, schema },
      'Схема базы изменилась. Подними версию в db.ts, добавь миграцию и обнови этот тест',
    ).toEqual({
      version: 3,
      schema: {
        cards: { primKey: 'id', indexes: ['kind', 'name', 'updatedAt'] },
        links: { primKey: 'id', indexes: ['[ownerType+ownerId]', 'cardId', 'updatedAt'] },
        notes: {
          primKey: 'id',
          indexes: [
            '*tagIds',
            '[event.from+createdAt]',
            'conflictOf',
            'createdAt',
            'reviewedAt',
            'updatedAt',
          ],
        },
        settings: { primKey: 'key', indexes: [] },
      },
    })
  })

  it('повышение версии базы сохраняет записи и добавляет новое поле', async () => {
    // Так будет выглядеть настоящая миграция: старые записи получают значение по умолчанию
    const name = 'проверка-миграции'
    await Dexie.delete(name)
    const v1 = new Dexie(name)
    v1.version(1).stores({ notes: 'id' })
    await v1.table('notes').bulkAdd([
      { id: 'a', text: 'старая 1' },
      { id: 'b', text: 'старая 2' },
    ])
    v1.close()

    const v2 = new Dexie(name)
    v2.version(1).stores({ notes: 'id' })
    v2.version(2)
      .stores({ notes: 'id' })
      .upgrade((tx) =>
        tx
          .table('notes')
          .toCollection()
          .modify((n) => {
            n.pinned = false
          }),
      )
    const rows = await v2.table('notes').orderBy('id').toArray()
    expect(rows).toEqual([
      { id: 'a', text: 'старая 1', pinned: false },
      { id: 'b', text: 'старая 2', pinned: false },
    ])
    v2.close()
    await Dexie.delete(name)
  })
})
