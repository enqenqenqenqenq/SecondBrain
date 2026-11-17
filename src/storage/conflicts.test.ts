import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import {
  createNote,
  deleteNote,
  getNote,
  listConflictCopies,
  listNotes,
  resolveConflict,
  watchConflictCopies,
} from './index'
import { conflictCopy } from './merge'
import type { Note } from './types'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

// Запись и её копия при конфликте, как их создаёт слияние
async function withCopy(): Promise<{ original: Note; copy: Note }> {
  const original = await createNote('вариант с компьютера')
  const copy = await conflictCopy({ ...original, text: 'вариант с телефона' })
  await db.notes.add(copy)
  return { original, copy }
}

describe('копии при конфликте', () => {
  it('находятся по записи, из которой получились, в порядке создания', async () => {
    const original = await createNote('основная')
    const other = await createNote('чужая')
    const first = await conflictCopy({ ...original, text: 'первая', createdAt: 100 })
    const second = await conflictCopy({ ...original, text: 'вторая', createdAt: 200 })
    const alien = await conflictCopy({ ...other, text: 'чужая копия' })
    await db.notes.bulkAdd([second, first, alien])
    expect((await listConflictCopies(original.id)).map((n) => n.text)).toEqual(['первая', 'вторая'])
    expect((await listConflictCopies(other.id)).map((n) => n.text)).toEqual(['чужая копия'])
    expect(await listConflictCopies('нет')).toEqual([])
  })

  it('удалённая копия не показывается, обычные записи копиями не считаются', async () => {
    const { original, copy } = await withCopy()
    await createNote('обычная')
    expect(await listConflictCopies(original.id)).toHaveLength(1)
    await deleteNote(copy.id)
    expect(await listConflictCopies(original.id)).toEqual([])
  })

  it('копия видна в общей ленте как обычная запись', async () => {
    const { copy } = await withCopy()
    expect((await listNotes()).map((n) => n.id)).toContain(copy.id)
  })

  it('слежение сообщает о появлении и исчезновении копии', async () => {
    const original = await createNote('основная')
    const seen: number[] = []
    const stop = watchConflictCopies(original.id, (list) => seen.push(list.length))
    await vi.waitFor(() => expect(seen).toEqual([0]))
    const copy = await conflictCopy({ ...original, text: 'копия' })
    await db.notes.add(copy)
    await vi.waitFor(() => expect(seen.at(-1)).toBe(1))
    await deleteNote(copy.id)
    await vi.waitFor(() => expect(seen.at(-1)).toBe(0))
    stop()
    expect(seen).toEqual([0, 1, 0])
  })
})

describe('разбор копии человеком', () => {
  it('«оставить обе»: копия становится обычной записью, оригинал не меняется', async () => {
    const { original, copy } = await withCopy()
    const { keptId } = await resolveConflict(copy.id, 'both')
    expect(keptId).toBe(copy.id)
    const resolved = (await getNote(copy.id))!
    expect(resolved.conflictOf).toBeNull()
    expect(resolved.text).toBe('вариант с телефона')
    expect(resolved.rev).toBe(copy.rev + 1)
    expect(await getNote(original.id)).toEqual(original)
    expect(await listConflictCopies(original.id)).toEqual([])
  })

  it('«оставить эту»: оригинал убирается, копия становится обычной записью', async () => {
    const { original, copy } = await withCopy()
    const { keptId } = await resolveConflict(copy.id, 'copy')
    expect(keptId).toBe(copy.id)
    expect(await getNote(original.id)).toBeUndefined()
    expect((await db.notes.get(original.id))?.deletedAt).not.toBeNull()
    expect((await getNote(copy.id))?.conflictOf).toBeNull()
    expect((await listNotes()).map((n) => n.text)).toEqual(['вариант с телефона'])
  })

  it('«оставить оригинал»: копия убирается', async () => {
    const { original, copy } = await withCopy()
    const { keptId } = await resolveConflict(copy.id, 'original')
    expect(keptId).toBe(original.id)
    expect(await getNote(copy.id)).toBeUndefined()
    expect(await getNote(original.id)).toEqual(original)
    expect((await listNotes()).map((n) => n.text)).toEqual(['вариант с компьютера'])
  })

  it('разбор поднимает номер и версии у изменённого и записывает это устройство', async () => {
    await db.settings.put({ key: 'deviceId', value: 'dev-b' })
    const { original, copy } = await withCopy()
    await resolveConflict(copy.id, 'copy')
    const gone = (await db.notes.get(original.id))!
    expect(gone.rev).toBe(original.rev + 1)
    expect(gone.deviceId).toBe('dev-b')
    expect(gone.clock?.['dev-b']).toBe((original.clock?.['dev-b'] ?? 0) + 1)
    const kept = (await db.notes.get(copy.id))!
    expect(kept.rev).toBe(copy.rev + 1)
    expect(kept.clock).toEqual({ conflict: 1, 'dev-b': 1 })
  })

  it('если оригинала уже нет, «оставить эту» просто делает копию обычной', async () => {
    const { original, copy } = await withCopy()
    await deleteNote(original.id)
    const { keptId } = await resolveConflict(copy.id, 'copy')
    expect(keptId).toBe(copy.id)
    expect((await getNote(copy.id))?.conflictOf).toBeNull()
  })

  it('если оригинала уже нет, «оставить оригинал» невозможно и ничего не меняет', async () => {
    const { original, copy } = await withCopy()
    await deleteNote(original.id)
    await expect(resolveConflict(copy.id, 'original')).rejects.toThrow('уже нет')
    expect((await getNote(copy.id))?.conflictOf).toBe(original.id)
  })

  it('обычная, удалённая и несуществующая запись копией не является', async () => {
    const plain = await createNote('обычная')
    await expect(resolveConflict(plain.id, 'both')).rejects.toThrow('не копия')
    await expect(resolveConflict('нет', 'both')).rejects.toThrow('не копия')
    const { copy } = await withCopy()
    await deleteNote(copy.id)
    await expect(resolveConflict(copy.id, 'both')).rejects.toThrow('не копия')
  })

  it('повторный разбор уже разобранной копии отклоняется', async () => {
    const { copy } = await withCopy()
    await resolveConflict(copy.id, 'both')
    await expect(resolveConflict(copy.id, 'both')).rejects.toThrow('не копия')
  })

  it('из нескольких копий разбирается только выбранная', async () => {
    const original = await createNote('основная')
    const one = await conflictCopy({ ...original, text: 'раз' })
    const two = await conflictCopy({ ...original, text: 'два' })
    await db.notes.bulkAdd([one, two])
    await resolveConflict(one.id, 'both')
    expect((await listConflictCopies(original.id)).map((n) => n.text)).toEqual(['два'])
  })
})
