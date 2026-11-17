import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, getDeviceId } from './db'
import {
  countNotes,
  createNote,
  deleteNote,
  getNote,
  listNotes,
  restoreNote,
  updateNote,
  watchNotes,
} from './index'
import type { EventTime } from './types'

const minute = (from: string): EventTime => ({ precision: 'minute', from, to: from })

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('создание', () => {
  it('ставит все обязательные поля', async () => {
    const note = await createNote('Позвонить')
    expect(note.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(note.text).toBe('Позвонить')
    expect(note.rev).toBe(1)
    expect(note.deletedAt).toBeNull()
    expect(note.reviewedAt).toBeNull()
    expect(note.tagIds).toEqual([])
    expect(note.timeIsAuto).toBe(true)
    expect(note.event.precision).toBe('minute')
    expect(note.event.from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(note.event.to).toBe(note.event.from)
    expect(note.createdAt).toBe(note.updatedAt)
  })

  it('время события совпадает с моментом сохранения с точностью до минуты', async () => {
    const moment = new Date(2026, 5, 1, 7, 3, 59).getTime()
    vi.spyOn(Date, 'now').mockReturnValue(moment)
    const note = await createNote('утром')
    expect(note.createdAt).toBe(moment)
    expect(note.event).toEqual({
      precision: 'minute',
      from: '2026-06-01T07:03',
      to: '2026-06-01T07:03',
    })
  })

  it('запись на границе минуты получает следующую минуту', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 5, 1, 7, 4, 0).getTime())
    expect((await createNote('на границе')).event.from).toBe('2026-06-01T07:04')
  })

  it('обрезает пробелы по краям', async () => {
    expect((await createNote('  текст \n')).text).toBe('текст')
  })

  it('не принимает пустой и пробельный текст', async () => {
    await expect(createNote('')).rejects.toThrow()
    await expect(createNote('   \n ')).rejects.toThrow()
    expect(await countNotes()).toBe(0)
  })

  it('время, заданное вручную, помечает запись как уточнённую', async () => {
    const note = await createNote('летом', {
      precision: 'season',
      from: '2024-06-01T00:00',
      to: '2024-08-31T23:59',
    })
    expect(note.timeIsAuto).toBe(false)
    expect(note.event.precision).toBe('season')
  })
})

describe('чтение', () => {
  it('находит запись по номеру, а неизвестный номер даёт пусто', async () => {
    const note = await createNote('одна')
    expect(await getNote(note.id)).toEqual(note)
    expect(await getNote('нет-такой')).toBeUndefined()
  })

  it('десять записей читаются от новых к старым', async () => {
    const times = Array.from(
      { length: 10 },
      (_, i) => `2026-11-${String(10 + i).padStart(2, '0')}T12:00`,
    )
    for (let i = 0; i < 10; i++) await createNote(`запись ${i}`, minute(times[i]))
    const list = await listNotes()
    expect(list).toHaveLength(10)
    expect(list.map((n) => n.text)).toEqual(Array.from({ length: 10 }, (_, i) => `запись ${9 - i}`))
    expect(await countNotes()).toBe(10)
  })

  it('порядок идёт по времени события, а не по времени создания', async () => {
    await createNote('позднее по событию', minute('2026-05-01T10:00'))
    await createNote('раньше по событию', minute('2020-01-01T10:00'))
    const list = await listNotes()
    expect(list.map((n) => n.text)).toEqual(['позднее по событию', 'раньше по событию'])
  })

  it('при одинаковом времени события новее та, что сохранена позже', async () => {
    const same = minute('2026-11-17T09:00')
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1000)
    await createNote('первая', same)
    now.mockReturnValue(2000)
    await createNote('вторая', same)
    expect((await listNotes()).map((n) => n.text)).toEqual(['вторая', 'первая'])
  })

  it('постраничное чтение', async () => {
    for (let i = 0; i < 5; i++) await createNote(`n${i}`, minute(`2026-11-1${i}T08:00`))
    expect((await listNotes({ limit: 2 })).map((n) => n.text)).toEqual(['n4', 'n3'])
    expect((await listNotes({ limit: 2, offset: 2 })).map((n) => n.text)).toEqual(['n2', 'n1'])
    expect((await listNotes({ offset: 4 })).map((n) => n.text)).toEqual(['n0'])
  })

  it('пустое хранилище даёт пустой список', async () => {
    expect(await listNotes()).toEqual([])
    expect(await countNotes()).toBe(0)
  })
})

describe('изменение', () => {
  it('меняет текст, увеличивает номер правки и время изменения', async () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1000)
    const note = await createNote('до')
    now.mockReturnValue(5000)
    const changed = await updateNote(note.id, { text: ' после ' })
    expect(changed?.text).toBe('после')
    expect(changed?.rev).toBe(2)
    expect(changed?.updatedAt).toBe(5000)
    expect(changed?.createdAt).toBe(1000)
    expect((await getNote(note.id))?.text).toBe('после')
  })

  it('уточнение времени сбрасывает отметку автоматического времени', async () => {
    const note = await createNote('весной')
    const changed = await updateNote(note.id, {
      event: { precision: 'season', from: '2025-03-01T00:00', to: '2025-05-31T23:59' },
    })
    expect(changed?.timeIsAuto).toBe(false)
    expect(changed?.event.precision).toBe('season')
    expect(changed?.text).toBe('весной')
  })

  it('отметка «дополнено» и теги сохраняются', async () => {
    const note = await createNote('что-то')
    const changed = await updateNote(note.id, { reviewedAt: 777, tagIds: ['a', 'b'] })
    expect(changed?.reviewedAt).toBe(777)
    expect(changed?.tagIds).toEqual(['a', 'b'])
  })

  it('пустой текст отклоняется, запись не меняется', async () => {
    const note = await createNote('осталось')
    await expect(updateNote(note.id, { text: '  ' })).rejects.toThrow()
    expect((await getNote(note.id))?.rev).toBe(1)
  })

  it('неизвестная запись даёт пусто', async () => {
    expect(await updateNote('нет-такой', { text: 'x' })).toBeUndefined()
  })
})

describe('удаление', () => {
  it('удалённая запись пропадает из чтения и счёта, но остаётся в базе', async () => {
    const a = await createNote('остаётся', minute('2026-11-10T10:00'))
    const b = await createNote('удаляется', minute('2026-11-11T10:00'))
    expect(await deleteNote(b.id)).toBe(true)
    expect((await listNotes()).map((n) => n.id)).toEqual([a.id])
    expect(await countNotes()).toBe(1)
    expect(await getNote(b.id)).toBeUndefined()
    const raw = await db.notes.get(b.id)
    expect(raw?.deletedAt).not.toBeNull()
    expect(raw?.rev).toBe(2)
  })

  it('повторное удаление и удаление неизвестной записи ничего не делают', async () => {
    const note = await createNote('x')
    expect(await deleteNote(note.id)).toBe(true)
    expect(await deleteNote(note.id)).toBe(false)
    expect(await deleteNote('нет-такой')).toBe(false)
  })

  it('удалённую запись нельзя изменить', async () => {
    const note = await createNote('x')
    await deleteNote(note.id)
    expect(await updateNote(note.id, { text: 'y' })).toBeUndefined()
  })

  it('отмена удаления возвращает запись на место', async () => {
    const note = await createNote('вернуть')
    await deleteNote(note.id)
    expect(await restoreNote(note.id)).toBe(true)
    expect((await getNote(note.id))?.text).toBe('вернуть')
    expect(await countNotes()).toBe(1)
    expect(await restoreNote(note.id)).toBe(false)
  })
})

describe('устройство и сохранность', () => {
  it('номер устройства создаётся один раз и ставится в записи', async () => {
    const id = await getDeviceId()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await getDeviceId()).toBe(id)
    expect((await createNote('a')).deviceId).toBe(id)
  })

  it('после закрытия и повторного открытия базы записи на месте', async () => {
    const note = await createNote('переживёт перезапуск')
    db.close()
    await db.open()
    expect((await getNote(note.id))?.text).toBe('переживёт перезапуск')
    expect(await countNotes()).toBe(1)
  })
})

describe('наблюдение', () => {
  it('сообщает список сразу и после каждого изменения', async () => {
    const seen: string[][] = []
    const stop = watchNotes((notes) => seen.push(notes.map((n) => n.text)))
    await vi.waitFor(() => expect(seen.at(-1)).toEqual([]))
    const note = await createNote('первая')
    await vi.waitFor(() => expect(seen.at(-1)).toEqual(['первая']))
    await deleteNote(note.id)
    await vi.waitFor(() => expect(seen.at(-1)).toEqual([]))
    stop()
  })

  it('после остановки больше не сообщает', async () => {
    let calls = 0
    const stop = watchNotes(() => calls++)
    await vi.waitFor(() => expect(calls).toBeGreaterThan(0))
    stop()
    const before = calls
    await createNote('после остановки')
    await new Promise((r) => setTimeout(r, 50))
    expect(calls).toBe(before)
  })
})
