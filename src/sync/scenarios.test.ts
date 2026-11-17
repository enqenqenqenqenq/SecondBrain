import { beforeAll, describe, expect, it } from 'vitest'
import { createVault } from '../crypto/vault'
import { KEEP_DAYS, SEGMENT_SIZE, resendAll, runSync } from './engine'
import { makeCodec } from './format'
import { MemoryLocal, MemoryRemote, advanceTime, currentTime } from './testing'
import type { Codec } from './types'

// Сценарии синхронизации и конфликтов по карточке «Написать проверки синхронизации и конфликтов»:
// два устройства, одновременные правки, потеря связи в середине передачи. Устройства, Диск и шифр настоящие
// (движок, формат, слияние), заменены только база и сеть.

const DAY = 24 * 3600 * 1000
let codec: Codec

beforeAll(async () => {
  codec = makeCodec((await createVault('пароль для сценариев', 1000)).key)
})

const device = (id: string) => new MemoryLocal(id)
const sync = (local: MemoryLocal, remote: MemoryRemote) =>
  runSync({ local, remote, codec, now: currentTime })
// Круг, который может оборваться: ошибка не считается провалом проверки
const tolerant = async (local: MemoryLocal, remote: MemoryRemote) => {
  try {
    await sync(local, remote)
    return true
  } catch {
    return false
  }
}
const texts = (d: MemoryLocal) =>
  d
    .alive()
    .map((n) => n.text)
    .sort()
const segments = (r: MemoryRemote) => r.names().filter((n) => n.startsWith('seg-'))
const snapshots = (r: MemoryRemote) => r.names().filter((n) => n.startsWith('snap-'))
const everyone = async (devices: MemoryLocal[], remote: MemoryRemote, rounds = 4) => {
  for (let i = 0; i < rounds; i++) for (const d of devices) await sync(d, remote)
}
// Состояние, по которому сравниваем устройства: у удалённой записи остаток текста не считается
const view = (d: MemoryLocal) =>
  JSON.stringify(
    [
      ...[...d.notes.values()].map((n) => [
        'note',
        n.id,
        n.deletedAt === null ? n.text : null,
        n.deletedAt === null,
        n.conflictOf ?? null,
      ]),
      ...[...d.cards.values()].map((c) => [
        'card',
        c.id,
        c.deletedAt === null ? c.name : null,
        c.deletedAt === null,
      ]),
      ...[...d.links.values()].map((l) => [
        'link',
        l.id,
        l.deletedAt === null ? l.role : null,
        l.deletedAt === null,
      ]),
    ].sort((a, b) => (String(a.slice(0, 2)) < String(b.slice(0, 2)) ? -1 : 1)),
  )
const converged = (devices: MemoryLocal[]) => devices.every((d) => view(d) === view(devices[0]))

describe('два устройства: одновременные правки', () => {
  it('разные записи правят одновременно: конфликтов нет, всё сохраняется', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'первая')
    a.addNote('n2', 'вторая')
    await everyone([a, b], remote)
    a.editNote('n1', { text: 'первая, правка A' })
    b.editNote('n2', { text: 'вторая, правка B' })
    await everyone([a, b], remote)
    expect(texts(a)).toEqual(['вторая, правка B', 'первая, правка A'])
    expect(converged([a, b])).toBe(true)
    expect([...a.notes.values()].some((n) => n.conflictOf)).toBe(false)
  })

  it('текст на одном и время события на другом: обе версии остаются', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'встреча')
    await everyone([a, b], remote)
    a.editNote('n1', { text: 'встреча в парке' })
    b.editNote('n1', {
      event: { precision: 'day', from: '2026-03-03T00:00', to: '2026-03-03T23:59' },
    })
    await everyone([a, b], remote)
    expect(converged([a, b])).toBe(true)
    // версия без правки текста сохранена копией: «встреча» со временем и «встреча в парке»
    expect(texts(a).sort()).toEqual(['встреча', 'встреча в парке'])
  })

  for (const [name, deletedLater] of [
    ['удаление позже правки: запись удалена, текст правки в копии', true],
    ['удаление раньше правки: запись жива, копии нет', false],
  ] as const) {
    it(`правка на одном, удаление на другом, ${name}`, async () => {
      const a = device('a')
      const b = device('b')
      const remote = new MemoryRemote()
      a.addNote('n1', 'исходный')
      await everyone([a, b], remote)
      if (deletedLater) {
        a.editNote('n1', { text: 'правка' })
        b.removeNote('n1')
      } else {
        b.removeNote('n1')
        a.editNote('n1', { text: 'правка' })
      }
      await everyone([a, b], remote)
      expect(converged([a, b])).toBe(true)
      expect(texts(a)).toEqual(['правка'])
      expect(a.notes.get('n1')?.deletedAt === null).toBe(!deletedLater)
    })
  }

  it('возвращение удалённой на одном и правка на другом', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'исходный')
    a.removeNote('n1')
    await everyone([a, b], remote)
    a.editNote('n1', { deletedAt: null })
    b.editNote('n1', { text: 'правка на удалённой' })
    await everyone([a, b], remote)
    expect(converged([a, b])).toBe(true)
    expect(texts(a).length).toBeGreaterThan(0)
  })

  it('оба удалили одну запись: ни копий, ни конфликта', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'общая')
    await everyone([a, b], remote)
    a.removeNote('n1')
    b.removeNote('n1')
    await everyone([a, b], remote)
    expect(texts(a)).toEqual([])
    expect(converged([a, b])).toBe(true)
    expect(a.notes.size).toBe(1)
  })

  it('обе стороны правят ту же запись одинаково: не конфликт', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'исходный')
    await everyone([a, b], remote)
    a.editNote('n1', { text: 'исправлено' })
    b.editNote('n1', { text: 'исправлено' })
    await everyone([a, b], remote)
    expect(texts(a)).toEqual(['исправлено'])
    expect(converged([a, b])).toBe(true)
  })

  it('часы одного устройства убежали на год вперёд: его версия побеждает, а версия с верными часами не пропадает', async () => {
    const a = device('a')
    const b = new MemoryLocal('b', () => currentTime() + 365 * DAY)
    const remote = new MemoryRemote()
    a.addNote('n1', 'исходный')
    await everyone([a, b], remote)
    a.editNote('n1', { text: 'правка с верными часами' })
    b.editNote('n1', { text: 'правка с убежавшими часами' })
    await everyone([a, b], remote)
    expect(a.notes.get('n1')?.text).toBe('правка с убежавшими часами')
    expect(texts(a)).toEqual(['правка с верными часами', 'правка с убежавшими часами'])
    expect(converged([a, b])).toBe(true)
  })

  it('часы отстали на год: версия с верными часами побеждает, отставшая сохранена копией', async () => {
    const a = device('a')
    const b = new MemoryLocal('b', () => currentTime() - 365 * DAY)
    const remote = new MemoryRemote()
    a.addNote('n1', 'исходный')
    await everyone([a, b], remote)
    b.editNote('n1', { text: 'правка с отставшими часами' })
    a.editNote('n1', { text: 'правка с верными часами' })
    await everyone([a, b], remote)
    expect(a.notes.get('n1')?.text).toBe('правка с верными часами')
    expect(texts(a)).toEqual(['правка с верными часами', 'правка с отставшими часами'])
    expect(converged([a, b])).toBe(true)
  })

  it('карточку правили на обоих: остаётся одна версия, устройства совпадают', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addCard('c1', 'Человек А')
    await everyone([a, b], remote)
    a.cards.set('c1', {
      ...a.cards.get('c1')!,
      name: 'Человек А (A)',
      rev: 2,
      clock: { a: 2 },
      updatedAt: currentTime() + 10,
    })
    b.cards.set('c1', {
      ...b.cards.get('c1')!,
      name: 'Человек А (B)',
      rev: 2,
      clock: { a: 1, b: 1 },
      deviceId: 'b',
      updatedAt: currentTime() + 20,
    })
    await everyone([a, b], remote)
    expect(a.cards.get('c1')?.name).toBe('Человек А (B)')
    expect(converged([a, b])).toBe(true)
  })

  it('роль связи меняют на обоих: устройства совпадают', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'запись')
    a.addCard('c1', 'Человек А')
    a.addLink('l1', 'n1', 'c1')
    await everyone([a, b], remote)
    a.links.set('l1', {
      ...a.links.get('l1')!,
      role: 'with',
      rev: 2,
      clock: { a: 2 },
      updatedAt: currentTime() + 10,
    })
    b.links.set('l1', {
      ...b.links.get('l1')!,
      role: 'mentioned',
      rev: 2,
      clock: { a: 1, b: 1 },
      deviceId: 'b',
      updatedAt: currentTime() + 20,
    })
    await everyone([a, b], remote)
    expect(a.links.get('l1')?.role).toBe('mentioned')
    expect(converged([a, b])).toBe(true)
  })

  it('одну и ту же копию данных загрузили на оба устройства, потом оба подключились к пустому Диску', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    for (const d of [a, b]) {
      d.notes.set('общая', {
        id: 'общая',
        text: 'из копии данных',
        event: { precision: 'year', from: '2020-01-01T00:00', to: '2020-12-31T23:59' },
        timeIsAuto: false,
        reviewedAt: null,
        tagIds: [],
        createdAt: 1,
        updatedAt: 1,
        rev: 1,
        clock: { импорт: 1 },
        deviceId: 'импорт',
        deletedAt: null,
      })
    }
    a.addNote('своя-a', 'только у A')
    b.addNote('своя-b', 'только у B')
    await everyone([a, b], remote)
    expect(texts(a)).toEqual(['из копии данных', 'только у A', 'только у B'])
    expect(converged([a, b])).toBe(true)
    expect([...a.notes.values()].some((n) => n.conflictOf)).toBe(false)
  })

  it('оба устройства первыми подключаются к пустому Диску одновременно: данные объединяются без потерь', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('na', 'у первого')
    b.addNote('nb', 'у второго')
    // оба увидели пустой Диск и оба загрузили снимок
    const listsEmpty = remote.list.bind(remote)
    let calls = 0
    remote.list = async () => {
      calls++
      return calls <= 2 ? [] : listsEmpty()
    }
    await sync(a, remote)
    await sync(b, remote)
    await everyone([a, b], remote)
    expect(snapshots(remote).length).toBe(2)
    expect(texts(a)).toEqual(['у второго', 'у первого'])
    expect(converged([a, b])).toBe(true)
  })

  it('три устройства с независимыми правками одной записи: все три версии у всех', async () => {
    const [a, b, c] = [device('a'), device('b'), device('c')]
    const remote = new MemoryRemote()
    a.addNote('n1', 'исходный')
    await everyone([a, b, c], remote)
    a.editNote('n1', { text: 'версия A' })
    b.editNote('n1', { text: 'версия B' })
    c.editNote('n1', { text: 'версия C' })
    await everyone([a, b, c], remote, 6)
    expect(texts(a)).toEqual(['версия A', 'версия B', 'версия C'])
    expect(converged([a, b, c])).toBe(true)
  })

  it('A правит, B не получив правит, C получает обе: все сходятся', async () => {
    const [a, b, c] = [device('a'), device('b'), device('c')]
    const remote = new MemoryRemote()
    a.addNote('n1', 'исходный')
    await everyone([a, b, c], remote)
    a.editNote('n1', { text: 'версия A' })
    await sync(a, remote)
    b.editNote('n1', { text: 'версия B' })
    await sync(b, remote)
    await sync(c, remote)
    await everyone([a, b, c], remote, 5)
    expect(converged([a, b, c])).toBe(true)
    expect(texts(a)).toEqual(['версия A', 'версия B'])
  })

  it('копию разобрали на одном устройстве (удалили), второе ещё не успело: копия удалена и там', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'исходный')
    await everyone([a, b], remote)
    a.editNote('n1', { text: 'A' })
    b.editNote('n1', { text: 'B' })
    await everyone([a, b], remote, 4)
    const copy = a.alive().find((n) => n.conflictOf)!
    a.removeNote(copy.id)
    await everyone([a, b], remote, 4)
    expect(a.alive()).toHaveLength(1)
    expect(converged([a, b])).toBe(true)
    // и повторно та же копия не возвращается
    await everyone([a, b], remote, 3)
    expect(a.alive()).toHaveLength(1)
  })

  it('копию оставили вместо оригинала, а на другом устройстве оригинал правят: новая правка не пропадает', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'исходный')
    await everyone([a, b], remote)
    a.editNote('n1', { text: 'A' })
    b.editNote('n1', { text: 'B' })
    await everyone([a, b], remote, 4)
    const copy = a.alive().find((n) => n.conflictOf)!
    // человек на A выбрал «оставить эту»: оригинал убирается, копия становится обычной
    a.removeNote('n1')
    a.editNote(copy.id, { conflictOf: null })
    // а на B в это время правят оригинал ещё раз
    b.editNote('n1', { text: 'B, ещё правка' })
    await everyone([a, b], remote, 5)
    expect(converged([a, b])).toBe(true)
    expect(texts(a)).toContain('B, ещё правка')
    expect(texts(a).length).toBeGreaterThanOrEqual(2)
  })
})

describe('отметка «дополнено» на двух устройствах', () => {
  const reviewedOf = (d: MemoryLocal, id: string) => d.notes.get(id)?.reviewedAt ?? null

  it('отметка с одного устройства доходит до другого', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'запись')
    await everyone([a, b], remote)
    a.editNote('n1', { reviewedAt: currentTime() })
    await everyone([a, b], remote)
    expect(reviewedOf(b, 'n1')).not.toBeNull()
    expect(reviewedOf(b, 'n1')).toBe(reviewedOf(a, 'n1'))
  })

  it('одну запись отметили на обоих устройствах: копии нет, время у обоих одно и то же', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'запись')
    await everyone([a, b], remote)
    a.editNote('n1', { reviewedAt: 1000 })
    advanceTime(5000)
    b.editNote('n1', { reviewedAt: 6000 })
    await everyone([a, b], remote)
    expect(a.notes.size).toBe(1)
    expect(b.notes.size).toBe(1)
    expect(reviewedOf(a, 'n1')).toBe(1000)
    expect(reviewedOf(b, 'n1')).toBe(1000)
    expect(converged([a, b])).toBe(true)
  })

  it('отметили в одном месте, правили текст в другом: оба текста сохранены', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'запись')
    await everyone([a, b], remote)
    a.editNote('n1', { reviewedAt: currentTime() })
    advanceTime(1000)
    b.editNote('n1', { text: 'запись, правка B' })
    await everyone([a, b], remote)
    expect(texts(a)).toEqual(['запись', 'запись, правка B'])
    expect(converged([a, b])).toBe(true)
  })

  it('отметили на трёх устройствах в разное время: все сходятся к раннему', async () => {
    const [a, b, c] = [device('a'), device('b'), device('c')]
    const remote = new MemoryRemote()
    a.addNote('n1', 'запись')
    await everyone([a, b, c], remote)
    a.editNote('n1', { reviewedAt: 900 })
    b.editNote('n1', { reviewedAt: 400 })
    c.editNote('n1', { reviewedAt: 700 })
    await everyone([a, b, c], remote, 6)
    for (const d of [a, b, c]) {
      expect(reviewedOf(d, 'n1')).toBe(400)
      expect(d.notes.size).toBe(1)
    }
    expect(converged([a, b, c])).toBe(true)
  })
})

describe('потеря связи в середине передачи', () => {
  it('обрыв на шестом из десяти сегментов: повтор отправляет остальное, дублей и потерь нет', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('first', 'начало')
    await everyone([a, b], remote)
    const total = SEGMENT_SIZE * 10
    for (let i = 0; i < total; i++) a.addNote(`n${i}`, `запись ${i}`)
    let created = 0
    remote.fail('create', 1, (n) => n.startsWith('seg-') && ++created === 6)
    await expect(sync(a, remote)).rejects.toThrow('Сбой Диска')
    expect(segments(remote)).toHaveLength(5)
    expect((await a.collectDirty()).length).toBe(total - 5 * SEGMENT_SIZE)
    await sync(a, remote)
    expect(segments(remote)).toHaveLength(10)
    expect(new Set(remote.names()).size).toBe(remote.names().length)
    await sync(b, remote)
    expect(b.notes.size).toBe(total + 1)
  })

  it('обрыв при чтении на третьем файле из пяти: первые два применены, повтор доделывает', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'начало')
    await everyone([a, b], remote)
    for (let i = 1; i <= 5; i++) {
      a.addNote(`extra${i}`, `дополнение ${i}`)
      await sync(a, remote)
    }
    remote.fail('read', 1, (n) => n === 'seg-a-000003.sb')
    const broken = await sync(b, remote)
    expect(broken.errors.map((e) => e.file)).toEqual(['seg-a-000003.sb'])
    expect(b.meta.cursor.a).toBe(2)
    expect(b.notes.size).toBe(3)
    await sync(b, remote)
    expect(b.notes.size).toBe(6)
    expect(b.meta.cursor.a).toBe(5)
  })

  it('ответ потерян после успешной загрузки: повтор не создаёт файл с тем же именем и ничего не теряет', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await everyone([a, b], remote)
    a.editNote('n1', { text: 'два' })
    remote.chaos = { rnd: () => 0, fail: 0, lost: 1 } // каждый ответ о создании теряется
    await expect(sync(a, remote)).rejects.toThrow('Потерян ответ')
    remote.chaos = null
    expect(segments(remote)).toEqual(['seg-a-000001.sb'])
    a.editNote('n1', { text: 'три' })
    await sync(a, remote)
    expect(segments(remote)).toEqual(['seg-a-000001.sb', 'seg-a-000002.sb'])
    expect(new Set(remote.names()).size).toBe(remote.names().length)
    await sync(b, remote)
    expect(b.notes.get('n1')?.text).toBe('три')
  })

  it('ответ потерян при загрузке первого снимка: повтор не теряет данные', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    a.addNote('n2', 'два')
    remote.chaos = { rnd: () => 0, fail: 0, lost: 1 }
    await expect(sync(a, remote)).rejects.toThrow('Потерян ответ')
    remote.chaos = null
    expect(snapshots(remote)).toHaveLength(1)
    await sync(a, remote)
    await sync(b, remote)
    expect(texts(b)).toEqual(['два', 'раз'])
    expect(await a.collectDirty()).toEqual([])
  })

  it('устройство закрыли посреди применения файла: повтор безопасен, курсор не сдвинут', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n0', 'начало')
    await everyone([a, b], remote)
    for (let i = 1; i <= 20; i++) a.addNote(`n${i}`, `запись ${i}`)
    await sync(a, remote)
    let n = 0
    b.chaos = { rnd: () => (++n === 8 ? 0 : 1), p: 0.5 }
    // сбой при применении файла круг не роняет: файл записывается в «не прочитано», дальше первой ошибки не идём
    const crashed = await sync(b, remote)
    expect(crashed.errors).toHaveLength(1)
    expect(crashed.errors[0].message).toContain('Сбой устройства')
    b.chaos = null
    expect(b.meta.cursor.a ?? 0).toBe(0)
    expect(b.notes.size).toBeGreaterThan(1)
    expect(b.notes.size).toBeLessThan(21)
    await sync(b, remote)
    expect(b.notes.size).toBe(21)
    expect(converged([a, b])).toBe(true)
  })

  it('обрыв посреди уборки: повтор доделывает, новое устройство получает всё', async () => {
    const a = device('a')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    for (let i = 0; i < 6; i++) {
      a.editNote('n1', { text: `правка ${i}` })
      await sync(a, remote)
    }
    await resendAll({ local: a, remote, codec, now: currentTime })
    advanceTime((KEEP_DAYS + 1) * DAY)
    remote.fail('delete', 1, (n) => n === 'seg-a-000004.sb')
    await expect(sync(a, remote)).rejects.toThrow('Сбой Диска')
    expect(segments(remote).length).toBeGreaterThan(0)
    await sync(a, remote)
    expect(segments(remote)).toEqual([])
    const fresh = device('fresh')
    await sync(fresh, remote)
    expect(fresh.notes.get('n1')?.text).toBe('правка 5')
  })

  it('приложение закрыли после загрузки снимка, до сохранения состояния: данные целы, повтор не ломает', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    a.failSaveMeta = 1
    await expect(sync(a, remote)).rejects.toThrow('сохранении состояния')
    await sync(a, remote)
    await sync(b, remote)
    expect(texts(b)).toEqual(['раз'])
    expect(converged([a, b])).toBe(true)
  })

  it('файл с меньшим номером ещё не виден: чужие правки не пропускаются, после появления применяются', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'начало')
    await everyone([a, b], remote)
    for (let i = 1; i <= 3; i++) {
      a.addNote(`extra${i}`, `дополнение ${i}`)
      await sync(a, remote)
    }
    // второй файл пока не виден (список ещё не обновился)
    const hiddenId = remote.idOf('seg-a-000002.sb')
    const hidden = remote.files.get(hiddenId)!
    remote.files.delete(hiddenId)
    const early = await sync(b, remote)
    expect(early.errors.map((e) => e.code)).toEqual(['gap'])
    expect(b.meta.cursor.a).toBe(1)
    expect(b.notes.size).toBe(2)
    // файл появился
    remote.files.set(hiddenId, hidden)
    const later = await sync(b, remote)
    expect(later.errors).toEqual([])
    expect(b.notes.size).toBe(4)
    expect(b.meta.cursor.a).toBe(3)
  })

  it('пропущенный номер объясняется снимком: ошибки нет', async () => {
    const a = device('a')
    const sleeper = device('sleeper')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    await sync(sleeper, remote)
    for (let i = 0; i < 4; i++) {
      a.editNote('n1', { text: `до снимка ${i}` })
      await sync(a, remote)
    }
    await resendAll({ local: a, remote, codec, now: currentTime })
    advanceTime((KEEP_DAYS + 1) * DAY)
    await sync(a, remote)
    expect(segments(remote)).toEqual([])
    a.editNote('n1', { text: 'после снимка' })
    await sync(a, remote)
    const result = await sync(sleeper, remote)
    expect(result.errors).toEqual([])
    expect(sleeper.notes.get('n1')?.text).toBe('после снимка')
  })

  it('файл потерян насовсем: получатель ждёт и сообщает, «отправить заново» у автора снимает затор', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'начало')
    await everyone([a, b], remote)
    for (let i = 1; i <= 3; i++) {
      a.editNote('n1', { text: `правка ${i}` })
      await sync(a, remote)
    }
    await remote.delete(remote.idOf('seg-a-000002.sb'))
    const stuck = await sync(b, remote)
    expect(stuck.errors.map((e) => e.code)).toEqual(['gap'])
    expect(b.notes.get('n1')?.text).not.toBe('правка 3')
    await resendAll({ local: a, remote, codec, now: currentTime })
    const freed = await sync(b, remote)
    expect(freed.errors).toEqual([])
    expect(b.notes.get('n1')?.text).toBe('правка 3')
  })

  it('два устройства делают снимок одновременно: оба сходятся и ничего не теряют', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('na', 'у первого')
    b.addNote('nb', 'у второго')
    await sync(a, remote)
    await sync(b, remote)
    await resendAll({ local: a, remote, codec, now: currentTime })
    await resendAll({ local: b, remote, codec, now: currentTime })
    await everyone([a, b], remote)
    expect(texts(a)).toEqual(['у второго', 'у первого'])
    expect(converged([a, b])).toBe(true)
  })

  it('обрыв сети при первом получении: местные данные не затёрты, после восстановления всё на месте', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('na', 'у первого')
    await sync(a, remote)
    b.addNote('nb', 'у второго')
    remote.fail('read', 1)
    const first = await sync(b, remote)
    expect(first.errors.length).toBe(1)
    expect(texts(b)).toEqual(['у второго'])
    await everyone([a, b], remote)
    expect(texts(b)).toEqual(['у второго', 'у первого'])
    expect(converged([a, b])).toBe(true)
  })
})

// Случайные сбои сети и устройства на всём пути. Когда связь налажена, устройства обязаны прийти к одному
// и тому же, а Диск должен быть целым: новое устройство получает то же самое.
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Mode {
  name: string
  network: { fail: number; lost: number } | null
  device: number
  seeds: number
}

const MODES: Mode[] = [
  {
    name: 'сеть обрывается и теряет ответы',
    network: { fail: 0.15, lost: 0.08 },
    device: 0,
    seeds: 50,
  },
  { name: 'устройство падает посреди круга', network: null, device: 0.06, seeds: 50 },
  { name: 'и сеть, и устройство', network: { fail: 0.1, lost: 0.06 }, device: 0.04, seeds: 50 },
]

describe('случайные сбои', () => {
  for (const mode of MODES) {
    it(`${mode.name}: после починки все устройства совпадают, Диск цел, новое устройство получает то же`, async () => {
      for (let seed = 1; seed <= mode.seeds; seed++) {
        const rnd = random(seed * 31)
        const remote = new MemoryRemote()
        const devices = [device('a'), device('b'), device('c')]
        const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)]
        if (mode.network) remote.chaos = { rnd, ...mode.network }
        if (mode.device > 0) for (const d of devices) d.chaos = { rnd, p: mode.device }
        let counter = 0
        try {
          for (let step = 0; step < 36; step++) {
            const dev = pick(devices)
            const roll = rnd()
            if (roll < 0.2 || counter === 0) {
              dev.addNote(`n${++counter}`, `текст ${counter}`)
            } else if (roll < 0.5) {
              const known = [...dev.notes.keys()]
              if (known.length) dev.editNote(pick(known), { text: `правка ${step} от ${dev.id}` })
            } else if (roll < 0.58) {
              const known = dev.alive().map((n) => n.id)
              if (known.length) dev.removeNote(pick(known))
            } else {
              await tolerant(dev, remote)
            }
          }
          // связь налажена
          remote.chaos = null
          for (const d of devices) d.chaos = null
          let rounds = 0
          while (
            rounds < 12 &&
            !(
              converged(devices) &&
              (await Promise.all(devices.map((d) => d.collectDirty()))).every((x) => x.length === 0)
            )
          ) {
            for (const d of devices) await sync(d, remote)
            rounds++
          }
          expect(rounds, 'круги после починки').toBeLessThan(12)
          expect(converged(devices)).toBe(true)
          for (const d of devices) expect(await d.collectDirty()).toEqual([])
          // на Диске нет двух файлов с одним именем
          expect(new Set(remote.names()).size).toBe(remote.names().length)
          // новое устройство получает то же самое: файлы на Диске целы
          const fresh = device('fresh')
          await sync(fresh, remote)
          expect(view(fresh)).toBe(view(devices[0]))
        } catch (error) {
          throw new Error(`${mode.name}, начальное число ${seed * 31}: ${String(error)}`, {
            cause: error,
          })
        }
      }
    }, 180_000)
  }

  it('независимые правки не пропадают даже при сбоях: текст каждой остаётся у всех', async () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = random(seed * 17)
      const remote = new MemoryRemote()
      const devices = [device('a'), device('b'), device('c')]
      devices[0].addNote('n1', 'исходный')
      await everyone(devices, remote)
      remote.chaos = { rnd, fail: 0.12, lost: 0.06 }
      for (const d of devices) d.chaos = { rnd, p: 0.04 }
      const written: string[] = []
      for (const dev of devices) {
        dev.editNote('n1', { text: `${dev.id}-правка` })
        written.push(`${dev.id}-правка`)
        await tolerant(dev, remote)
      }
      for (let i = 0; i < 6; i++) for (const d of devices) await tolerant(d, remote)
      remote.chaos = null
      for (const d of devices) d.chaos = null
      for (let i = 0; i < 6; i++) for (const d of devices) await sync(d, remote)
      const present = texts(devices[0])
      for (const text of written) expect(present, `начальное число ${seed * 17}`).toContain(text)
      expect(converged(devices)).toBe(true)
    }
  }, 120_000)
})
