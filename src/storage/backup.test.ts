import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import { idFromKey } from './ids'
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  createCard,
  createNote,
  dayEvent,
  deleteCard,
  deleteNote,
  exportData,
  exportText,
  importData,
  linkNote,
  listNotes,
  minuteEvent,
  parseExport,
  seasonEvent,
  serializeExport,
  unlinkNote,
  updateNote,
  yearEvent,
} from './index'
import type { ParsedExport } from './index'
import { generateNotes } from './seed'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Полный путь копии: выгрузка, файл, чтение
const through = async () => {
  const parsed = parseExport(serializeExport(await exportData()))
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.data
}

const wipe = async () => {
  await db.delete()
  await db.open()
}

const noteRaw = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  text: 'запись',
  event: { precision: 'minute', from: '2026-01-01T10:00', to: '2026-01-01T10:00' },
  timeIsAuto: false,
  reviewedAt: null,
  tagIds: [],
  createdAt: 1,
  updatedAt: 1,
  rev: 1,
  deviceId: 'd',
  deletedAt: null,
  ...over,
})

const cardRaw = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  kind: 'person',
  name: 'Человек А',
  aliases: [],
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
  ...over,
})

const linkRaw = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  ownerType: 'note',
  ownerId: 'n1',
  cardId: 'c1',
  role: null,
  createdAt: 1,
  updatedAt: 1,
  rev: 1,
  deviceId: 'd',
  deletedAt: null,
  ...over,
})

const file = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: '2026-11-17T10:00:00.000Z',
    notes: [],
    cards: [],
    links: [],
    ...over,
  })

const parseOk = (raw: string): ParsedExport => {
  const result = parseExport(raw)
  if (!result.ok) throw new Error(result.error)
  return result.data
}

describe('выгрузка', () => {
  it('пустая база даёт пустые списки и описание файла', async () => {
    const out = await exportData(new Date('2026-11-17T10:00:00Z'))
    expect(out).toEqual({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: '2026-11-17T10:00:00.000Z',
      notes: [],
      cards: [],
      links: [],
    })
  })

  it('удалённые записи, карточки и связи в копию не попадают', async () => {
    const keep = await createNote('оставить')
    const gone = await createNote('удалить')
    const person = await createCard({ kind: 'person', name: 'Остаётся' })
    const lost = await createCard({ kind: 'person', name: 'Удалена' })
    await linkNote(keep.id, person.id)
    await linkNote(keep.id, lost.id)
    await linkNote(gone.id, person.id)
    await deleteNote(gone.id)
    await deleteCard(lost.id)
    const out = await exportData()
    expect(out.notes.map((n) => n.text)).toEqual(['оставить'])
    expect(out.cards.map((c) => c.name)).toEqual(['Остаётся'])
    expect(out.links).toHaveLength(1)
    expect(out.links[0]).toMatchObject({ ownerId: keep.id, cardId: person.id })
  })

  it('убранная связь не выгружается', async () => {
    const note = await createNote('раз')
    const person = await createCard({ kind: 'person', name: 'А' })
    await linkNote(note.id, person.id)
    await unlinkNote(note.id, person.id)
    expect((await exportData()).links).toEqual([])
  })

  it('записи от новых к старым по времени события', async () => {
    await createNote('старая', yearEvent(2019))
    await createNote('новая', minuteEvent(2026, 5, 1, 10, 0))
    await createNote('середина', dayEvent(2023, 3, 3))
    expect((await exportData()).notes.map((n) => n.text)).toEqual(['новая', 'середина', 'старая'])
  })

  it('файл читается человеком: многострочный JSON с отступами', async () => {
    await createNote('раз')
    const text = serializeExport(await exportData())
    expect(text.split('\n').length).toBeGreaterThan(10)
    expect(text).toContain('\n  "notes": [')
    expect(() => JSON.parse(text)).not.toThrow()
  })
})

describe('текстовая копия', () => {
  it('пустая база', async () => {
    const text = exportText(await exportData(new Date(2026, 10, 17, 14, 20)))
    expect(text).toBe(
      'Копия данных SecondBrain\n17 ноября 2026, 14:20\nЗаписей: 0. Людей: 0. Мест: 0.\n',
    )
  })

  it('записи с датой, текстом, людьми и местами, карточки с подробностями', async () => {
    // Порядок меток записи идёт по времени связывания: чтобы он не зависел от совпадения миллисекунд,
    // время течёт по одной миллисекунде на каждое обращение
    let tick = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => ++tick)
    const note = await createNote('Выставка после зачёта\nвторая строка', dayEvent(2023, 3, 3))
    await createNote('Лето', seasonEvent(2024, 'summer'))
    const person = await createCard({
      kind: 'person',
      name: 'Человек А',
      aliases: ['Прозвище 1'],
      description: 'коллега',
      birthday: { month: 3, day: 14, year: 1990 },
      facts: [{ label: 'Любимый кофе', value: 'капучино' }],
    })
    const place = await createCard({ kind: 'place', name: 'Место 1', address: 'улица 1' })
    await linkNote(note.id, person.id, 'with')
    await linkNote(note.id, place.id)
    const text = exportText(await exportData(new Date(2026, 10, 17, 14, 20)))
    expect(text).toContain('Записей: 2. Людей: 1. Мест: 1.')
    expect(text).toContain('ЗАПИСИ\n\n')
    expect(text).toContain(
      '3 марта 2023\nВыставка после зачёта\nвторая строка\nЛюди и места: Человек А (был со мной), Место 1',
    )
    expect(text).toContain('лето 2024\nЛето\n')
    expect(text).toContain(
      'ЛЮДИ\n\nЧеловек А\nПрозвища: Прозвище 1\nОписание: коллега\nДень рождения: 14 марта 1990\nЛюбимый кофе: капучино',
    )
    expect(text).toContain('МЕСТА\n\nМесто 1\nАдрес: улица 1')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('даты записаны полностью, без «сегодня» и «вчера»', async () => {
    await createNote('сейчас')
    const text = exportText(await exportData())
    expect(text).not.toContain('Сегодня')
    expect(text).not.toContain('Вчера')
    expect(text).toMatch(/\d{1,2} [а-я]+ \d{4}, \d{2}:\d{2}\nсейчас/)
  })

  it('день рождения без года', async () => {
    await createCard({ kind: 'person', name: 'А', birthday: { month: 2, day: 29 } })
    expect(exportText(await exportData())).toContain('День рождения: 29 февраля\n')
  })
})

describe('копия и возврат без потерь', () => {
  it('всё выгруженное после очистки возвращается таким же', async () => {
    const note1 = await createNote('Выставка\nс переносом 🙂 日本語', dayEvent(2023, 3, 3))
    const note2 = await createNote("<script>alert(1)</script> '; DROP TABLE", yearEvent(2019))
    await updateNote(note1.id, { reviewedAt: 12345 })
    const person = await createCard({
      kind: 'person',
      name: 'Человек А',
      aliases: ['Прозвище 1', 'Прозвище 2'],
      description: 'описание',
      birthday: { month: 5, day: 9, year: 1990 },
      facts: [{ label: 'город', value: 'Казань' }],
    })
    const place = await createCard({ kind: 'place', name: 'Место 1', address: 'улица 1' })
    await linkNote(note1.id, person.id, 'with')
    await linkNote(note1.id, place.id)
    await linkNote(note2.id, person.id, 'mentioned')

    const before = await exportData()
    const raw = serializeExport(before)
    await wipe()
    const parsed = parseExport(raw)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const report = await importData(parsed.data, { commit: true })
    expect(report.notes.added).toBe(2)
    expect(report.cards.added).toBe(2)
    expect(report.links.added).toBe(3)

    const after = await exportData(new Date(before.exportedAt))
    expect(after).toEqual(before)
  })

  it('номера правок, устройства и время создания сохраняются как были', async () => {
    const note = await createNote('раз')
    await updateNote(note.id, { text: 'раз и два' })
    const was = (await db.notes.get(note.id))!
    const data = await through()
    await wipe()
    await importData(data, { commit: true })
    expect(await db.notes.get(note.id)).toEqual(was)
    expect(was.rev).toBe(2)
  })

  it('повторная загрузка той же копии ничего не добавляет', async () => {
    await createNote('раз')
    const person = await createCard({ kind: 'person', name: 'А' })
    const note = (await listNotes())[0]
    await linkNote(note.id, person.id)
    const data = await through()
    const again = await importData(data, { commit: true })
    expect(again.notes).toEqual({ added: 0, existing: 1, deleted: 0 })
    expect(again.cards).toEqual({ added: 0, existing: 1, deleted: 0 })
    expect(again.links).toEqual({ added: 0, existing: 1, orphaned: 0 })
    expect(await db.notes.count()).toBe(1)
    expect(await db.links.count()).toBe(1)
  })

  it('двойная загрузка после очистки даёт те же данные, что одинарная', async () => {
    await createNote('раз')
    await createNote('два')
    const data = await through()
    await wipe()
    await importData(data, { commit: true })
    await importData(data, { commit: true })
    expect(await db.notes.count()).toBe(2)
  })

  it('пробная загрузка считает, но ничего не пишет', async () => {
    await createNote('раз')
    const person = await createCard({ kind: 'person', name: 'А' })
    await linkNote((await listNotes())[0].id, person.id)
    const data = await through()
    await wipe()
    const plan = await importData(data, { commit: false })
    expect(await db.notes.count()).toBe(0)
    expect(await db.cards.count()).toBe(0)
    expect(await db.links.count()).toBe(0)
    const real = await importData(data, { commit: true })
    expect(real).toEqual(plan)
  })

  it('пять тысяч записей возвращаются без потерь', async () => {
    const notes = generateNotes(5000, { seed: 2026, now: new Date(2026, 10, 17, 12, 0) })
    await db.notes.bulkAdd(notes)
    const before = await exportData(new Date(2026, 10, 17))
    const raw = serializeExport(before)
    await wipe()
    const parsed = parseExport(raw)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.data.invalid).toBe(0)
    await importData(parsed.data, { commit: true })
    expect(await exportData(new Date(2026, 10, 17))).toEqual(before)
  }, 60_000)
})

describe('загрузка в непустую базу', () => {
  it('добавляет чужое и не трогает своё', async () => {
    await createNote('моя запись')
    const mine = await createCard({ kind: 'person', name: 'Мой человек' })
    const data = parseOk(
      file({
        notes: [noteRaw({ id: 'other', text: 'чужая запись' })],
        cards: [cardRaw({ id: 'other-c' })],
      }),
    )
    const report = await importData(data, { commit: true })
    expect(report.notes.added).toBe(1)
    expect((await listNotes()).map((n) => n.text).sort()).toEqual(['моя запись', 'чужая запись'])
    expect(await db.cards.count()).toBe(2)
    expect((await db.cards.get(mine.id))?.name).toBe('Мой человек')
  })

  it('запись, которая уже есть, не заменяется даже если в файле другой текст', async () => {
    const note = await createNote('мой текст')
    const data = parseOk(
      file({ notes: [noteRaw({ id: note.id, text: 'текст из файла', rev: 99, updatedAt: 9e12 })] }),
    )
    const report = await importData(data, { commit: true })
    expect(report.notes).toEqual({ added: 0, existing: 1, deleted: 0 })
    expect((await db.notes.get(note.id))?.text).toBe('мой текст')
  })

  it('удалённое человеком не возвращается и связи с ним не создаются', async () => {
    const note = await createNote('раз')
    const person = await createCard({ kind: 'person', name: 'А' })
    await linkNote(note.id, person.id)
    const data = await through()
    await deleteNote(note.id)
    const report = await importData(data, { commit: true })
    expect(report.notes).toEqual({ added: 0, existing: 0, deleted: 1 })
    expect(report.links).toEqual({ added: 0, existing: 0, orphaned: 1 })
    expect(await listNotes()).toEqual([])
    expect((await db.notes.get(note.id))?.deletedAt).not.toBeNull()
  })

  it('удалённая карточка не возвращается', async () => {
    const person = await createCard({ kind: 'person', name: 'А' })
    const data = await through()
    await deleteCard(person.id)
    const report = await importData(data, { commit: true })
    expect(report.cards).toEqual({ added: 0, existing: 0, deleted: 1 })
    expect((await db.cards.get(person.id))?.deletedAt).not.toBeNull()
  })

  it('связь к записи, которая уже есть, добавляется', async () => {
    const note = await createNote('раз')
    const data = parseOk(
      file({
        cards: [cardRaw()],
        links: [linkRaw({ ownerId: note.id })],
      }),
    )
    const report = await importData(data, { commit: true })
    expect(report.links.added).toBe(1)
    expect(await db.links.get(await idFromKey(`link:note:${note.id}:c1`))).toBeDefined()
  })
})

describe('проверка файла', () => {
  it('не JSON, пустой и не наш файл отклоняются', () => {
    expect(parseExport('')).toEqual({ ok: false, error: 'Файл пустой' })
    expect(parseExport('   \n ')).toEqual({ ok: false, error: 'Файл пустой' })
    expect(parseExport('привет')).toMatchObject({ ok: false })
    expect(parseExport('{"notes": [')).toMatchObject({
      ok: false,
      error: expect.stringContaining('повреждён'),
    })
    expect(parseExport('[]')).toMatchObject({
      ok: false,
      error: expect.stringContaining('не копия'),
    })
    expect(parseExport('null')).toMatchObject({ ok: false })
    expect(parseExport('42')).toMatchObject({ ok: false })
    expect(parseExport(JSON.stringify({ format: 'другой', version: 1 }))).toMatchObject({
      ok: false,
    })
  })

  it('версия: нет, ноль, дробная, строка и более новая', () => {
    const base = { format: EXPORT_FORMAT, notes: [], cards: [], links: [] }
    for (const version of [undefined, 0, 1.5, '1', null, -1]) {
      expect(parseExport(JSON.stringify({ ...base, version }))).toMatchObject({
        ok: false,
        error: 'Неизвестная версия файла',
      })
    }
    expect(parseExport(JSON.stringify({ ...base, version: EXPORT_VERSION + 1 }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('более новой версией'),
    })
  })

  it('без одного из списков файл отклоняется', () => {
    for (const missing of ['notes', 'cards', 'links']) {
      const value = JSON.parse(file()) as Record<string, unknown>
      delete value[missing]
      expect(parseExport(JSON.stringify(value))).toMatchObject({ ok: false })
    }
    expect(parseExport(file({ notes: {} }))).toMatchObject({ ok: false })
  })

  it('метка порядка байтов в начале файла не мешает', () => {
    expect(parseExport(`﻿${file({ notes: [noteRaw()] })}`)).toMatchObject({ ok: true })
  })

  it('повреждённые записи пропускаются и считаются, остальные читаются', () => {
    const bad = [
      noteRaw({ id: 'a', text: '' }),
      noteRaw({ id: 'b', text: '   ' }),
      noteRaw({ id: 'c', text: 5 }),
      noteRaw({ id: 'd', event: { precision: 'day', from: 'вчера', to: 'сегодня' } }),
      noteRaw({ id: 'e', event: null }),
      noteRaw({ id: 'f', rev: 0 }),
      noteRaw({ id: 'g', rev: 1.5 }),
      noteRaw({ id: 'h', deletedAt: 5 }),
      noteRaw({ id: 'i', createdAt: -1 }),
      noteRaw({ id: 'j', createdAt: 'вчера' }),
      noteRaw({ id: 'k', timeIsAuto: 'да' }),
      noteRaw({ id: 'l', reviewedAt: 'потом' }),
      noteRaw({ id: 'm', tagIds: 'тег' }),
      noteRaw({ id: 'n', tagIds: [1] }),
      noteRaw({ id: '', text: 'без id' }),
      noteRaw({ id: 'x'.repeat(101) }),
      noteRaw({ id: 'o', deviceId: '' }),
      'просто строка',
      null,
      42,
      [],
    ]
    const data = parseOk(file({ notes: [...bad, noteRaw({ id: 'good', text: 'хорошая' })] }))
    expect(data.notes.map((n) => n.id)).toEqual(['good'])
    expect(data.invalid).toBe(bad.length)
  })

  it('слишком длинный текст считается повреждением', () => {
    const data = parseOk(file({ notes: [noteRaw({ text: 'а'.repeat(1_000_001) })] }))
    expect(data.notes).toEqual([])
    expect(data.invalid).toBe(1)
    expect(parseOk(file({ notes: [noteRaw({ text: 'а'.repeat(1_000_000) })] })).notes).toHaveLength(
      1,
    )
  })

  it('повтор id внутри файла: берётся первый, повторы считаются', () => {
    const data = parseOk(
      file({
        notes: [
          noteRaw({ text: 'первая' }),
          noteRaw({ text: 'вторая' }),
          noteRaw({ text: 'третья' }),
        ],
      }),
    )
    expect(data.notes.map((n) => n.text)).toEqual(['первая'])
    expect(data.duplicates).toBe(2)
  })

  it('лишние поля отбрасываются и не портят объекты', () => {
    const data = parseOk(
      file({ notes: [{ ...noteRaw(), evil: '<b>x</b>', constructor: 1, extra: { a: 1 } }] }),
    )
    expect(Object.keys(data.notes[0]).sort()).toEqual(
      [
        'id',
        'text',
        'event',
        'timeIsAuto',
        'reviewedAt',
        'tagIds',
        'createdAt',
        'updatedAt',
        'rev',
        'deviceId',
        'deletedAt',
      ].sort(),
    )
  })

  it('ключ __proto__ в файле не меняет общие объекты', () => {
    const raw = `{"format":"${EXPORT_FORMAT}","version":1,"exportedAt":"x","notes":[{"__proto__":{"polluted":true},"id":"p","text":"т","event":{"precision":"year","from":"2026-01-01T00:00","to":"2026-12-31T23:59"},"timeIsAuto":false,"reviewedAt":null,"tagIds":[],"createdAt":1,"updatedAt":1,"rev":1,"deviceId":"d","deletedAt":null}],"cards":[],"links":[]}`
    const data = parseOk(raw)
    expect(data.notes).toHaveLength(1)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect((data.notes[0] as unknown as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('текст записи остаётся таким, каким был, с пробелами по краям', () => {
    const data = parseOk(file({ notes: [noteRaw({ text: '  <b>да</b>\n  ' })] }))
    expect(data.notes[0].text).toBe('  <b>да</b>\n  ')
  })

  it('карточки: поля человека у места и поля места у человека недопустимы', () => {
    const data = parseOk(
      file({
        cards: [
          cardRaw({ id: 'ok1' }),
          cardRaw({ id: 'ok2', kind: 'place', address: 'улица 1' }),
          cardRaw({ id: 'bad1', kind: 'place', birthday: { month: 1, day: 1 } }),
          cardRaw({ id: 'bad2', kind: 'place', facts: [{ label: 'а', value: 'б' }] }),
          cardRaw({ id: 'bad3', address: 'улица' }),
          cardRaw({ id: 'bad4', kind: 'вещь' }),
          cardRaw({ id: 'bad5', name: ' ' }),
          cardRaw({ id: 'bad6', birthday: { month: 2, day: 30 } }),
          cardRaw({ id: 'bad7', facts: [{ label: ' ', value: 'б' }] }),
          cardRaw({ id: 'bad8', facts: 'нет' }),
          cardRaw({ id: 'bad9', aliases: [5] }),
          cardRaw({ id: 'bad10', mergedInto: 7 }),
        ],
      }),
    )
    expect(data.cards.map((c) => c.id)).toEqual(['ok1', 'ok2'])
    expect(data.invalid).toBe(10)
  })

  it('карточка с днём рождения и анкетой читается целиком', () => {
    const data = parseOk(
      file({
        cards: [
          cardRaw({
            birthday: { month: 2, day: 29, extra: 1 },
            facts: [{ label: 'город', value: 'Казань', extra: 1 }],
            aliases: ['А'],
          }),
        ],
      }),
    )
    expect(data.cards[0].birthday).toEqual({ month: 2, day: 29 })
    expect(data.cards[0].facts).toEqual([{ label: 'город', value: 'Казань' }])
  })

  it('связи: неизвестная роль и задачи недопустимы', () => {
    const data = parseOk(
      file({
        links: [
          linkRaw({ id: 'l1' }),
          linkRaw({ id: 'l2', role: 'with' }),
          linkRaw({ id: 'l3', role: 'friend' }),
          linkRaw({ id: 'l4', ownerType: 'task' }),
          linkRaw({ id: 'l5', cardId: '' }),
        ],
      }),
    )
    expect(data.links.map((l) => l.id)).toEqual(['l1', 'l2'])
    expect(data.invalid).toBe(3)
  })
})

describe('загрузка связей', () => {
  it('связь получает идентификатор из пары, а не из файла', async () => {
    const data = parseOk(
      file({
        notes: [noteRaw()],
        cards: [cardRaw()],
        links: [linkRaw({ id: 'произвольный', role: 'with' })],
      }),
    )
    await importData(data, { commit: true })
    const id = await idFromKey('link:note:n1:c1')
    expect(await db.links.get(id)).toMatchObject({ ownerId: 'n1', cardId: 'c1', role: 'with' })
    expect(await db.links.get('произвольный')).toBeUndefined()
  })

  it('две связи одной пары в файле дают одну', async () => {
    const data = parseOk(
      file({
        notes: [noteRaw()],
        cards: [cardRaw()],
        links: [linkRaw({ id: 'a' }), linkRaw({ id: 'b' })],
      }),
    )
    const report = await importData(data, { commit: true })
    expect(report.links.added).toBe(1)
    expect(report.duplicates).toBe(1)
    expect(await db.links.count()).toBe(1)
  })

  it('связь без записи или без карточки не добавляется', async () => {
    const data = parseOk(
      file({
        notes: [noteRaw()],
        cards: [cardRaw()],
        links: [
          linkRaw({ id: 'a', ownerId: 'нет-записи' }),
          linkRaw({ id: 'b', cardId: 'нет-карточки' }),
        ],
      }),
    )
    const report = await importData(data, { commit: true })
    expect(report.links).toEqual({ added: 0, existing: 0, orphaned: 2 })
    expect(await db.links.count()).toBe(0)
  })

  it('роль у связи с местом считается повреждением и не добавляется', async () => {
    const data = parseOk(
      file({
        notes: [noteRaw()],
        cards: [cardRaw({ kind: 'place', address: 'улица' })],
        links: [linkRaw({ role: 'with' })],
      }),
    )
    const report = await importData(data, { commit: true })
    expect(report.links.added).toBe(0)
    expect(report.invalid).toBe(1)
    expect(await db.links.count()).toBe(0)
  })
})

describe('версии и копии при конфликте в файле', () => {
  it('версии и ссылка на оригинал читаются и возвращаются', () => {
    const data = parseOk(
      file({
        notes: [noteRaw({ clock: { a: 2, b: 1 }, conflictOf: 'orig' })],
        cards: [cardRaw({ clock: { a: 1 } })],
        links: [linkRaw({ clock: { a: 1 } })],
      }),
    )
    expect(data.notes[0].clock).toEqual({ a: 2, b: 1 })
    expect(data.notes[0].conflictOf).toBe('orig')
    expect(data.cards[0].clock).toEqual({ a: 1 })
    expect(data.links[0].clock).toEqual({ a: 1 })
  })

  it('у старой копии без версий они не появляются', () => {
    const data = parseOk(file({ notes: [noteRaw()] }))
    expect('clock' in data.notes[0]).toBe(false)
    expect('conflictOf' in data.notes[0]).toBe(false)
  })

  it('испорченные версии и ссылка делают объект повреждённым', () => {
    const data = parseOk(
      file({
        notes: [
          noteRaw({ id: 'a', clock: { a: 0 } }),
          noteRaw({ id: 'b', clock: [1] }),
          noteRaw({ id: 'c', clock: 'x' }),
          noteRaw({ id: 'd', conflictOf: 5 }),
          noteRaw({ id: 'e', conflictOf: '' }),
          noteRaw({ id: 'ok', clock: { a: 1 }, conflictOf: null }),
        ],
        cards: [cardRaw({ clock: { a: -1 } })],
        links: [linkRaw({ clock: { a: 1.5 } })],
      }),
    )
    expect(data.notes.map((n) => n.id)).toEqual(['ok'])
    expect(data.cards).toEqual([])
    expect(data.links).toEqual([])
    expect(data.invalid).toBe(7)
  })

  it('копия при конфликте проходит копию данных и загрузку без потерь', async () => {
    const note = await createNote('основная')
    await db.notes.put({
      ...(await db.notes.get(note.id))!,
      conflictOf: 'другая-запись',
      clock: { conflict: 1, dev: 2 },
    })
    const before = await exportData(new Date(2026, 0, 1))
    const raw = serializeExport(before)
    await wipe()
    await importData(parseOk(raw), { commit: true })
    expect(await exportData(new Date(2026, 0, 1))).toEqual(before)
    expect((await db.notes.get(note.id))?.conflictOf).toBe('другая-запись')
  })
})
