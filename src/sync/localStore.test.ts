import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createVault } from '../crypto/vault'
import { db } from '../storage/db'
import {
  createCard,
  createNote,
  deleteNote,
  getNote,
  linkNote,
  listConflictCopies,
  updateNote,
} from '../storage'
import { runSync } from './engine'
import { makeCodec } from './format'
import { countPending, dexieLocalStore, forgetSyncState } from './localStore'
import { MemoryLocal, MemoryRemote, currentTime } from './testing'
import { emptyMeta } from './types'
import type { Codec, SyncObject } from './types'

let codec: Codec
beforeAll(async () => {
  codec = makeCodec((await createVault('пароль для проверки', 1000)).key)
})

beforeEach(async () => {
  await db.delete()
  await db.open()
  await db.settings.put({ key: 'deviceId', value: 'dev-a' })
})

const local = dexieLocalStore()
const keys = (list: SyncObject[]) => list.map((o) => `${o.entity}:${o.data.id}`).sort()

describe('что ждёт отправки', () => {
  it('новые записи, карточки и связи ждут, отправленные нет', async () => {
    const note = await createNote('раз')
    const card = await createCard({ kind: 'person', name: 'А' })
    await linkNote(note.id, card.id)
    const dirty = await local.collectDirty()
    expect(dirty).toHaveLength(3)
    expect(dirty.map((o) => o.entity).sort()).toEqual(['card', 'link', 'note'])
    await local.markSynced(dirty)
    expect(await local.collectDirty()).toEqual([])
    expect(await countPending()).toBe(0)
  })

  it('после новой правки объект снова ждёт, остальные нет', async () => {
    const one = await createNote('раз')
    const two = await createNote('два')
    await local.markSynced(await local.collectDirty())
    await updateNote(one.id, { text: 'раз, исправлено' })
    expect(keys(await local.collectDirty())).toEqual([`note:${one.id}`])
    expect(await getNote(two.id)).toBeDefined()
  })

  it('удаление тоже ждёт отправки', async () => {
    const note = await createNote('раз')
    await local.markSynced(await local.collectDirty())
    await deleteNote(note.id)
    const dirty = await local.collectDirty()
    expect(dirty).toHaveLength(1)
    expect(dirty[0].data.deletedAt).not.toBeNull()
  })

  it('согласованный номер не уменьшается, если пришло меньшее', async () => {
    const note = await createNote('раз')
    await updateNote(note.id, { text: 'два' })
    const current = (await db.notes.get(note.id))!
    await local.markSynced([{ entity: 'note', data: current }])
    await local.markSynced([{ entity: 'note', data: { ...current, rev: 1 } }])
    expect((await db.syncState.get(`note:${note.id}`))?.syncedRev).toBe(2)
  })

  it('все объекты для снимка включают удалённые', async () => {
    const note = await createNote('раз')
    await createNote('два')
    await deleteNote(note.id)
    expect(await local.allObjects()).toHaveLength(2)
  })

  it('забыть согласованное: всё снова ждёт отправки', async () => {
    await createNote('раз')
    await local.markSynced(await local.collectDirty())
    await local.saveMeta({ ...emptyMeta(), counter: 5 })
    await forgetSyncState()
    expect(await local.collectDirty()).toHaveLength(1)
    expect((await local.loadMeta()).counter).toBe(0)
  })
})

describe('состояние движка', () => {
  it('по умолчанию пустое, сохранённое возвращается', async () => {
    expect(await local.loadMeta()).toEqual(emptyMeta())
    const meta = { ...emptyMeta(), counter: 7, cursor: { b: 3 }, lastAt: 123 }
    await local.saveMeta(meta)
    expect(await local.loadMeta()).toEqual(meta)
  })

  it('поля, добавленные позже, получают значения по умолчанию', async () => {
    await db.settings.put({ key: 'syncMeta', value: { counter: 4 } })
    expect(await local.loadMeta()).toEqual({ ...emptyMeta(), counter: 4 })
  })
})

describe('применение пришедшего', () => {
  const remoteNote = (over: Record<string, unknown> = {}): SyncObject => ({
    entity: 'note',
    data: {
      id: 'r1',
      text: 'с другого устройства',
      event: { precision: 'minute', from: '2026-01-01T10:00', to: '2026-01-01T10:00' },
      timeIsAuto: false,
      reviewedAt: null,
      tagIds: [],
      createdAt: 100,
      updatedAt: 100,
      rev: 1,
      clock: { 'dev-b': 1 },
      deviceId: 'dev-b',
      deletedAt: null,
      ...over,
    },
  })

  it('новый объект записывается и считается согласованным', async () => {
    const report = await local.applyRemote([remoteNote()])
    expect(report).toMatchObject({ applied: 1, skipped: 0, conflicts: 0 })
    expect((await getNote('r1'))?.text).toBe('с другого устройства')
    expect(await local.collectDirty()).toEqual([])
  })

  it('повтор того же объекта пропускается', async () => {
    await local.applyRemote([remoteNote()])
    const report = await local.applyRemote([remoteNote()])
    expect(report).toMatchObject({ applied: 0, skipped: 1 })
  })

  it('пришедшая правка поверх нашей принимается, даже если у нас были неотправленные правки', async () => {
    await local.applyRemote([remoteNote()])
    await updateNote('r1', { text: 'моя правка' })
    const mine = (await db.notes.get('r1'))!
    const report = await local.applyRemote([
      remoteNote({
        text: 'их правка поверх моей',
        rev: mine.rev + 1,
        clock: { ...mine.clock, 'dev-b': 2 },
        updatedAt: 500,
      }),
    ])
    expect(report.applied).toBe(1)
    expect((await getNote('r1'))?.text).toBe('их правка поверх моей')
  })

  it('независимая правка: конфликт, итог ждёт отправки, проигравшая версия лежит копией', async () => {
    await local.applyRemote([remoteNote()])
    await updateNote('r1', { text: 'моя правка' }) // на этом устройстве, потом
    const report = await local.applyRemote([
      remoteNote({ text: 'их правка', rev: 2, clock: { 'dev-b': 2 }, updatedAt: 1 }),
    ])
    expect(report.conflicts).toBe(1)
    const dirty = keys(await local.collectDirty())
    expect(dirty).toContain('note:r1')
    const copies = await listConflictCopies('r1')
    expect(copies).toHaveLength(1)
    expect(dirty).toContain(`note:${copies[0].id}`)
    // моя правка позже (updatedAt настоящий), значит она победила, а их версия в копии
    expect((await getNote('r1'))?.text).toBe('моя правка')
    expect(copies[0].text).toBe('их правка')
  })

  it('копия, которую уже разобрали, при повторном конфликте не возвращается', async () => {
    await local.applyRemote([remoteNote()])
    await updateNote('r1', { text: 'моя правка' })
    const incoming = remoteNote({ text: 'их правка', rev: 2, clock: { 'dev-b': 2 }, updatedAt: 1 })
    await local.applyRemote([incoming])
    const [copy] = await listConflictCopies('r1')
    await deleteNote(copy.id)
    // то же самое пришло ещё раз (например, из снимка)
    await local.applyRemote([incoming])
    expect(await listConflictCopies('r1')).toEqual([])
    expect((await db.notes.get(copy.id))?.deletedAt).not.toBeNull()
  })

  it('удаление, пришедшее с другого устройства, применяется', async () => {
    await local.applyRemote([remoteNote()])
    await local.applyRemote([
      remoteNote({ rev: 2, clock: { 'dev-b': 2 }, deletedAt: 200, updatedAt: 200 }),
    ])
    expect(await getNote('r1')).toBeUndefined()
    expect((await db.notes.get('r1'))?.deletedAt).toBe(200)
  })

  it('карточки и связи применяются так же', async () => {
    const card: SyncObject = {
      entity: 'card',
      data: {
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
        clock: { 'dev-b': 1 },
        deviceId: 'dev-b',
        deletedAt: null,
      },
    }
    const link: SyncObject = {
      entity: 'link',
      data: {
        id: 'l1',
        ownerType: 'note',
        ownerId: 'r1',
        cardId: 'c1',
        role: 'with',
        createdAt: 1,
        updatedAt: 1,
        rev: 1,
        clock: { 'dev-b': 1 },
        deviceId: 'dev-b',
        deletedAt: null,
      },
    }
    const report = await local.applyRemote([remoteNote(), card, link])
    expect(report.applied).toBe(3)
    expect(await db.cards.get('c1')).toBeDefined()
    expect((await db.links.get('l1'))?.role).toBe('with')
    expect(await local.collectDirty()).toEqual([])
  })
})

describe('база вместе с движком и другим устройством', () => {
  const sync = (l: typeof local | MemoryLocal, remote: MemoryRemote) =>
    runSync({ local: l, remote, codec, now: currentTime })

  it('запись из базы доходит до другого устройства и обратно', async () => {
    const remote = new MemoryRemote()
    const other = new MemoryLocal('dev-b')
    const note = await createNote('с телефона')
    const card = await createCard({ kind: 'person', name: 'Человек А' })
    await linkNote(note.id, card.id, 'with')
    await sync(local, remote)
    await sync(other, remote)
    expect(other.notes.get(note.id)?.text).toBe('с телефона')
    expect(other.cards.size).toBe(1)
    expect(other.links.size).toBe(1)
    other.editNote(note.id, { text: 'с компьютера, поправлено' })
    await sync(other, remote)
    await sync(local, remote)
    expect((await getNote(note.id))?.text).toBe('с компьютера, поправлено')
    expect(await local.collectDirty()).toEqual([])
  })

  it('конфликт между базой и другим устройством сходится', async () => {
    const remote = new MemoryRemote()
    const other = new MemoryLocal('dev-b')
    const note = await createNote('исходный')
    await sync(local, remote)
    await sync(other, remote)
    await updateNote(note.id, { text: 'правка в базе' })
    other.editNote(note.id, { text: 'правка на другом' })
    await sync(local, remote)
    await sync(other, remote)
    await sync(local, remote)
    await sync(other, remote)
    const texts = [
      (await getNote(note.id))!.text,
      ...(await listConflictCopies(note.id)).map((n) => n.text),
    ].sort()
    expect(texts).toEqual(['правка в базе', 'правка на другом'])
    expect(
      other
        .alive()
        .map((n) => n.text)
        .sort(),
    ).toEqual(texts)
    expect(await local.collectDirty()).toEqual([])
    expect(await other.collectDirty()).toEqual([])
  })

  it('данные из копии данных (импорт) считаются неотправленными и уходят на Диск', async () => {
    const note = await createNote('раз')
    await local.markSynced(await local.collectDirty())
    await db.syncState.clear() // как будто импортировали в чистое приложение
    expect(await local.collectDirty()).toHaveLength(1)
    const remote = new MemoryRemote()
    await sync(local, remote)
    expect(remote.names().some((n) => n.startsWith('snap-'))).toBe(true)
    expect(note.id).toBeDefined()
  })
})
