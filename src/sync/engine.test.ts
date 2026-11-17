import { beforeAll, describe, expect, it } from 'vitest'
import { createVault } from '../crypto/vault'
import { KEEP_DAYS, SEGMENT_SIZE, SNAPSHOT_AFTER, resendAll, runSync } from './engine'
import { makeCodec, parseName } from './format'
import { MemoryLocal, MemoryRemote, advanceTime, currentTime } from './testing'
import type { Codec } from './types'

const DAY = 24 * 3600 * 1000
let codec: Codec
let otherCodec: Codec

beforeAll(async () => {
  codec = makeCodec((await createVault('общий пароль', 1000)).key)
  otherCodec = makeCodec((await createVault('чужой пароль', 1000)).key)
})

const device = (id: string) => new MemoryLocal(id)
const sync = (local: MemoryLocal, remote: MemoryRemote, c: Codec = codec) =>
  runSync({ local, remote, codec: c, now: currentTime })
const texts = (d: MemoryLocal) =>
  d
    .alive()
    .map((n) => n.text)
    .sort()
const segmentsOf = (r: MemoryRemote) => r.names().filter((n) => n.startsWith('seg-'))
const snapshotsOf = (r: MemoryRemote) => r.names().filter((n) => n.startsWith('snap-'))

describe('первое подключение', () => {
  it('Диск пуст: всё местное уходит одним снимком и считается отправленным', async () => {
    const a = device('a')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    a.addNote('n2', 'два')
    a.addCard('c1', 'Человек А')
    const result = await sync(a, remote)
    expect(result.snapshot).toBe(true)
    expect(result.pushed).toBe(3)
    expect(snapshotsOf(remote)).toHaveLength(1)
    expect(segmentsOf(remote)).toHaveLength(0)
    expect(await a.collectDirty()).toEqual([])
  })

  it('пустое устройство получает всё из снимка', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    a.addNote('n2', 'два')
    a.addCard('c1', 'Человек А')
    a.addLink('l1', 'n1', 'c1')
    await sync(a, remote)
    const result = await sync(b, remote)
    expect(result.applied).toBe(4)
    expect(texts(b)).toEqual(['два', 'раз'])
    expect(b.cards.size).toBe(1)
    expect(b.links.size).toBe(1)
    // и ничего не отправляет обратно
    expect(result.pushed).toBe(0)
    expect(remote.names()).toHaveLength(1)
  })

  it('Диск пуст и местных данных нет: ничего не создаётся', async () => {
    const a = device('a')
    const remote = new MemoryRemote()
    const result = await sync(a, remote)
    expect(result.snapshot).toBe(false)
    expect(remote.names()).toEqual([])
  })

  it('на Диске уже есть данные, а у устройства свои: они объединяются без потерь', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('na', 'с телефона')
    await sync(a, remote)
    b.addNote('nb', 'с компьютера')
    await sync(b, remote)
    await sync(a, remote)
    expect(texts(a)).toEqual(['с компьютера', 'с телефона'])
    expect(texts(b)).toEqual(['с компьютера', 'с телефона'])
  })
})

describe('обычный обмен', () => {
  it('правка уходит сегментом и доходит до другого устройства', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    await sync(b, remote)
    a.editNote('n1', { text: 'раз, исправлено' })
    const pushed = await sync(a, remote)
    expect(pushed.pushed).toBe(1)
    expect(segmentsOf(remote)).toEqual(['seg-a-000001.sb'])
    await sync(b, remote)
    expect(b.notes.get('n1')?.text).toBe('раз, исправлено')
  })

  it('второй круг без изменений ничего не делает', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    await sync(b, remote)
    const before = remote.names()
    const result = await sync(a, remote)
    const resultB = await sync(b, remote)
    expect(result).toMatchObject({ pulled: 0, applied: 0, pushed: 0, snapshot: false, removed: 0 })
    expect(resultB).toMatchObject({ pulled: 0, applied: 0, pushed: 0 })
    expect(remote.names()).toEqual(before)
  })

  it('свои сегменты устройство не разбирает заново', async () => {
    const a = device('a')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    a.editNote('n1', { text: 'два' })
    await sync(a, remote)
    const result = await sync(a, remote)
    expect(result.pulled).toBe(0)
  })

  it('номера сегментов растут на единицу, курсор запоминается', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    await sync(b, remote)
    for (let i = 0; i < 3; i++) {
      a.editNote('n1', { text: `правка ${i}` })
      await sync(a, remote)
    }
    expect(segmentsOf(remote)).toEqual(['seg-a-000001.sb', 'seg-a-000002.sb', 'seg-a-000003.sb'])
    await sync(b, remote)
    expect(b.meta.cursor).toEqual({ a: 3 })
    expect(b.notes.get('n1')?.text).toBe('правка 2')
  })

  it('удаление и возвращение записи доходят до другого устройства', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    await sync(b, remote)
    a.removeNote('n1')
    await sync(a, remote)
    await sync(b, remote)
    expect(texts(b)).toEqual([])
    a.editNote('n1', { deletedAt: null })
    await sync(a, remote)
    await sync(b, remote)
    expect(texts(b)).toEqual(['раз'])
  })

  it('большая выгрузка делится на сегменты по 500 объектов', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('first', 'начало')
    await sync(a, remote)
    await sync(b, remote)
    for (let i = 0; i < 1200; i++) a.addNote(`n${i}`, `запись ${i}`)
    const result = await sync(a, remote)
    expect(result.pushed).toBe(1200)
    expect(segmentsOf(remote)).toHaveLength(3)
    await sync(b, remote)
    expect(b.notes.size).toBe(1201)
    expect(SEGMENT_SIZE).toBe(500)
  })

  it('чужие файлы и открытый файл хранилища движок не трогает и не читает', async () => {
    const a = device('a')
    const remote = new MemoryRemote()
    await remote.create('meta.json', '{}')
    await remote.create('что-то-постороннее.txt', 'привет')
    a.addNote('n1', 'раз')
    const result = await sync(a, remote)
    expect(result.errors).toEqual([])
    expect(remote.names()).toContain('meta.json')
    expect(remote.names()).toContain('что-то-постороннее.txt')
  })
})

describe('конфликты через движок', () => {
  it('одну запись правили на обоих: оба получают одну и ту же запись и одну и ту же копию', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'исходный')
    await sync(a, remote)
    await sync(b, remote)
    a.editNote('n1', { text: 'правка с телефона' })
    b.editNote('n1', { text: 'правка с компьютера' })
    await sync(a, remote)
    await sync(b, remote)
    await sync(a, remote)
    await sync(b, remote)
    expect(texts(a)).toEqual(texts(b))
    expect(texts(a)).toEqual(['правка с компьютера', 'правка с телефона'])
    expect([...a.notes.keys()].sort()).toEqual([...b.notes.keys()].sort())
    expect([...a.alive()].filter((n) => n.conflictOf)).toHaveLength(1)
  })

  it('оба отправили, не дождавшись друг друга', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'исходный')
    await sync(a, remote)
    await sync(b, remote)
    a.editNote('n1', { text: 'A' })
    b.editNote('n1', { text: 'B' })
    // у каждого своя правка уже на Диске, чужую оно ещё не получало
    remote.fail('list', 0)
    await runSync({ local: a, remote, codec, now: currentTime })
    // b получает a и тут же отправляет итог, после чего a получает итог
    await sync(b, remote)
    await sync(a, remote)
    await sync(b, remote)
    expect(texts(a)).toEqual(texts(b))
    expect(texts(a)).toEqual(['A', 'B'])
  })
})

describe('сбои', () => {
  it('сбой при загрузке сегмента: ничего не считается отправленным, повтор отправляет всё', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    await sync(b, remote)
    a.editNote('n1', { text: 'правка' })
    remote.fail('create', 1, (n) => n.startsWith('seg-'))
    await expect(sync(a, remote)).rejects.toThrow('Сбой Диска')
    expect((await a.collectDirty()).length).toBe(1)
    expect(segmentsOf(remote)).toEqual([])
    await sync(a, remote)
    expect((await a.collectDirty()).length).toBe(0)
    await sync(b, remote)
    expect(b.notes.get('n1')?.text).toBe('правка')
  })

  it('сбой после загрузки, до сохранения состояния: повтор не затирает файл и ничего не теряет', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    await sync(b, remote)
    a.editNote('n1', { text: 'правка' })
    a.failSaveMeta = 1
    await expect(sync(a, remote)).rejects.toThrow('сохранении состояния')
    // файл ушёл, номер сохранить не успели
    expect(segmentsOf(remote)).toEqual(['seg-a-000001.sb'])
    a.editNote('n1', { text: 'правка два' })
    await sync(a, remote)
    expect(segmentsOf(remote)).toEqual(['seg-a-000001.sb', 'seg-a-000002.sb'])
    await sync(b, remote)
    expect(b.notes.get('n1')?.text).toBe('правка два')
  })

  it('сбой чтения одного файла: ошибка видна, курсор не перескакивает, после починки всё применяется', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    await sync(b, remote)
    a.editNote('n1', { text: 'вторая' })
    await sync(a, remote)
    a.editNote('n1', { text: 'третья' })
    await sync(a, remote)
    remote.fail('read', 1, (n) => n === 'seg-a-000001.sb')
    const broken = await sync(b, remote)
    expect(broken.errors).toHaveLength(1)
    expect(broken.errors[0].file).toBe('seg-a-000001.sb')
    // дальше первой ошибки у устройства не идём
    expect(b.meta.cursor.a ?? 0).toBe(0)
    expect(b.notes.get('n1')?.text).toBe('раз')
    const fixed = await sync(b, remote)
    expect(fixed.errors).toEqual([])
    expect(b.notes.get('n1')?.text).toBe('третья')
    expect(b.meta.cursor.a).toBe(2)
  })

  it('повреждённый файл сообщается, ничего не удаляется и не пропадает', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    await sync(b, remote)
    a.editNote('n1', { text: 'правка' })
    await sync(a, remote)
    const id = remote.idOf('seg-a-000001.sb')
    remote.files.get(id)!.content = 'это не шифр'
    const result = await sync(b, remote)
    expect(result.errors[0]).toMatchObject({ file: 'seg-a-000001.sb', code: 'bad-file' })
    expect(b.notes.get('n1')?.text).toBe('раз')
    expect(remote.names()).toContain('seg-a-000001.sb')
  })

  it('чужой пароль: все файлы нечитаемы, местные данные целы, ничего не затёрто', async () => {
    const a = device('a')
    const stranger = device('s')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    const before = remote.names()
    stranger.addNote('mine', 'своя запись')
    const result = await runSync({ local: stranger, remote, codec: otherCodec, now: currentTime })
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.every((e) => e.code === 'bad-file')).toBe(true)
    expect(texts(stranger)).toEqual(['своя запись'])
    expect(remote.names().filter((n) => before.includes(n))).toEqual(before)
  })

  it('файл, выданный за другой (содержимое от другого номера), не принимается', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    await sync(b, remote)
    a.editNote('n1', { text: 'один' })
    await sync(a, remote)
    a.editNote('n1', { text: 'два' })
    await sync(a, remote)
    // подмена: в файл номер 1 положили содержимое файла номер 2
    const two = remote.files.get(remote.idOf('seg-a-000002.sb'))!.content
    remote.files.get(remote.idOf('seg-a-000001.sb'))!.content = two
    const result = await sync(b, remote)
    expect(result.errors.map((e) => e.file)).toEqual(['seg-a-000001.sb'])
    expect(b.notes.get('n1')?.text).toBe('раз')
  })

  it('сбой списка файлов: круг заканчивается ошибкой и ничего не меняет', async () => {
    const a = device('a')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    remote.fail('list')
    await expect(sync(a, remote)).rejects.toThrow('Сбой Диска')
    expect((await a.collectDirty()).length).toBe(1)
    expect(remote.names()).toEqual([])
  })
})

describe('снимки и уборка', () => {
  it(`после ${SNAPSHOT_AFTER} сегментов, не охваченных снимком, делается снимок`, async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    await sync(b, remote)
    let made = 0
    for (let i = 0; i < SNAPSHOT_AFTER + 2 && made === 0; i++) {
      a.editNote('n1', { text: `правка ${i}` })
      const r = await sync(a, remote)
      if (r.snapshot) made++
    }
    expect(made).toBe(1)
    expect(snapshotsOf(remote).length).toBe(2) // первый и новый
    expect(a.meta.covers.a).toBeGreaterThan(SNAPSHOT_AFTER - 1)
  })

  it('старые файлы остаются неделю после снимка, потом убираются, новое устройство всё равно получает всё', async () => {
    const a = device('a')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    for (let i = 0; i < 5; i++) {
      a.editNote('n1', { text: `правка ${i}` })
      await sync(a, remote)
    }
    await resendAll({ local: a, remote, codec, now: currentTime })
    const segmentsBefore = segmentsOf(remote)
    expect(segmentsBefore).toHaveLength(5)
    // неделя ещё не прошла: уборки нет
    advanceTime((KEEP_DAYS - 1) * DAY)
    expect((await sync(a, remote)).removed).toBe(0)
    expect(segmentsOf(remote)).toEqual(segmentsBefore)
    // неделя прошла
    advanceTime(2 * DAY)
    const cleaned = await sync(a, remote)
    expect(cleaned.removed).toBeGreaterThan(0)
    expect(segmentsOf(remote)).toEqual([])
    expect(snapshotsOf(remote)).toHaveLength(1)
    // новое устройство берёт всё из снимка
    const fresh = device('fresh')
    await sync(fresh, remote)
    expect(fresh.notes.get('n1')?.text).toBe('правка 4')
  })

  it('уборка идёт один раз на один снимок', async () => {
    const a = device('a')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    a.editNote('n1', { text: 'два' })
    await sync(a, remote)
    await resendAll({ local: a, remote, codec, now: currentTime })
    advanceTime((KEEP_DAYS + 1) * DAY)
    await sync(a, remote)
    const reads = remote.calls.read
    await sync(a, remote)
    expect(remote.calls.read).toBe(reads)
  })

  it('устройство, которого долго не было, получает снимок и потом сегменты после него', async () => {
    const a = device('a')
    const sleeper = device('sleeper')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    await sync(a, remote)
    await sync(sleeper, remote)
    for (let i = 0; i < 3; i++) {
      a.editNote('n1', { text: `до снимка ${i}` })
      await sync(a, remote)
    }
    await resendAll({ local: a, remote, codec, now: currentTime })
    advanceTime((KEEP_DAYS + 1) * DAY)
    await sync(a, remote)
    a.editNote('n1', { text: 'после снимка' })
    await sync(a, remote)
    await sync(sleeper, remote)
    expect(sleeper.notes.get('n1')?.text).toBe('после снимка')
  })

  it('«отправить всё заново» создаёт снимок и не ломает остальных', async () => {
    const a = device('a')
    const b = device('b')
    const remote = new MemoryRemote()
    a.addNote('n1', 'раз')
    a.addNote('n2', 'два')
    await sync(a, remote)
    // файлы на Диске пропали (удалили вручную)
    for (const id of [...remote.files.keys()]) await remote.delete(id)
    await resendAll({ local: a, remote, codec, now: currentTime })
    expect(snapshotsOf(remote)).toHaveLength(1)
    await sync(b, remote)
    expect(texts(b)).toEqual(['два', 'раз'])
  })

  it('имена файлов разбираются и собираются обратно', () => {
    expect(parseName('seg-a1b2-c3d4-000042.sb')).toEqual({
      kind: 'segment',
      deviceId: 'a1b2-c3d4',
      seq: 42,
    })
    expect(parseName('snap-1700000000000-dev-1.sb')).toEqual({
      kind: 'snapshot',
      deviceId: 'dev-1',
      seq: 1_700_000_000_000,
    })
    expect(parseName('meta.json')).toBeNull()
    expect(parseName('seg-a-12.sb')).toBeNull()
    expect(parseName('мусор')).toBeNull()
  })
})

// Случайные правки на трёх устройствах и обмены через общий Диск: движок целиком, вместе с шифром
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

describe('случайные истории через движок', () => {
  it('шестьдесят историй на трёх устройствах сходятся', async () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rnd = random(seed)
      const remote = new MemoryRemote()
      const devices = [device('a'), device('b'), device('c')]
      const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)]
      let counter = 0
      try {
        for (let step = 0; step < 30; step++) {
          const dev = pick(devices)
          const roll = rnd()
          if (roll < 0.2 || counter === 0) {
            dev.addNote(`n${++counter}`, `текст ${counter}`)
          } else if (roll < 0.55) {
            const known = [...dev.notes.keys()]
            if (known.length) dev.editNote(pick(known), { text: `правка ${step} от ${dev.id}` })
          } else if (roll < 0.62) {
            const known = dev.alive().map((n) => n.id)
            if (known.length) dev.removeNote(pick(known))
          } else {
            await sync(dev, remote)
          }
        }
        for (let round = 0; round < 6; round++) for (const d of devices) await sync(d, remote)
        const view = (d: MemoryLocal) =>
          JSON.stringify(
            [...d.notes.values()]
              .map((n) => [
                n.id,
                n.deletedAt === null ? n.text : null,
                n.deletedAt === null,
                n.conflictOf ?? null,
              ])
              .sort((x, y) => (String(x[0]) < String(y[0]) ? -1 : 1)),
          )
        expect(view(devices[0])).toBe(view(devices[1]))
        expect(view(devices[1])).toBe(view(devices[2]))
        for (const d of devices) expect(await d.collectDirty()).toEqual([])
      } catch (error) {
        throw new Error(`история с начальным числом ${seed}: ${String(error)}`, { cause: error })
      }
    }
  }, 120_000)
})
