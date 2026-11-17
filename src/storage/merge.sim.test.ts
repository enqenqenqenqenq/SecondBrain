import { beforeEach, describe, expect, it } from 'vitest'
import { bumpClock } from './clock'
import { mergeNote } from './merge'
import type { Note } from './types'

// Устройства целиком в памяти: у каждого свои записи и число правок, уже отправленных другим.
// Так проверяется главное свойство разбора конфликтов: после обмена все устройства приходят к одному
// и тому же, и ничего не пропадает молча.

interface Device {
  id: string
  notes: Map<string, Note>
  synced: Map<string, number>
  cursor: number // сколько записей общего журнала на Диске это устройство уже разобрало
}

// Диск общий для всех: устройства дописывают в него свои изменения и читают чужие
interface Entry {
  from: string
  note: Note
}
const drive: Entry[] = []

beforeEach(() => {
  drive.length = 0
})

const newDevice = (id: string): Device => ({ id, notes: new Map(), synced: new Map(), cursor: 0 })

let clockTime = 1000
const tick = () => ++clockTime

function create(dev: Device, id: string, text: string, at = tick()): Note {
  const note: Note = {
    id,
    text,
    event: { precision: 'minute', from: '2026-01-01T10:00', to: '2026-01-01T10:00' },
    timeIsAuto: false,
    reviewedAt: null,
    tagIds: [],
    createdAt: at,
    updatedAt: at,
    rev: 1,
    clock: bumpClock(undefined, dev.id),
    deviceId: dev.id,
    deletedAt: null,
  }
  dev.notes.set(id, note)
  return note
}

function change(dev: Device, id: string, changes: Partial<Note>, at = tick()): Note | undefined {
  const n = dev.notes.get(id)
  if (!n) return undefined
  const next: Note = {
    ...n,
    ...changes,
    updatedAt: at,
    rev: n.rev + 1,
    clock: bumpClock(n.clock, dev.id),
    deviceId: dev.id,
  }
  dev.notes.set(id, next)
  return next
}

const edit = (dev: Device, id: string, text: string, at?: number) => change(dev, id, { text }, at)
const remove = (dev: Device, id: string, at?: number) =>
  change(dev, id, { deletedAt: at ?? tick() }, at)
const restore = (dev: Device, id: string, at?: number) => change(dev, id, { deletedAt: null }, at)

const dirty = (dev: Device) =>
  [...dev.notes.values()].filter((n) => n.rev > (dev.synced.get(n.id) ?? 0))

async function receive(dev: Device, remote: Note) {
  const result = await mergeNote(dev.notes.get(remote.id), remote, dev.id)
  if (result.action === 'apply') {
    dev.notes.set(remote.id, result.object)
    dev.synced.set(remote.id, result.object.rev)
  } else if (result.action === 'conflict') {
    // Итог надо отправить: он новее известного Диску, поэтому synced не трогаем
    dev.notes.set(remote.id, result.object)
    if (result.copy && !dev.notes.has(result.copy.id)) dev.notes.set(result.copy.id, result.copy)
  }
}

// Отправка: всё, что ждёт отправки, уходит на Диск, и устройство считает это согласованным
function push(dev: Device) {
  for (const n of dirty(dev)) {
    drive.push({ from: dev.id, note: n })
    dev.synced.set(n.id, n.rev)
  }
}

// Получение: устройство разбирает всё новое на Диске, кроме своих же изменений
async function pull(dev: Device) {
  while (dev.cursor < drive.length) {
    const entry = drive[dev.cursor++]
    if (entry.from !== dev.id) await receive(dev, entry.note)
  }
}

// Круг одного устройства: сначала получить, потом отправить
async function round(dev: Device) {
  await pull(dev)
  push(dev)
}

// Обмен между всеми, пока есть что отправлять или получать. Возвращает число кругов.
async function settle(devices: Device[], limit = 30) {
  for (let n = 1; n <= limit; n++) {
    if (devices.every((d) => dirty(d).length === 0 && d.cursor === drive.length)) return n - 1
    for (const dev of devices) await round(dev)
  }
  throw new Error('обмен не закончился')
}

const view = (dev: Device) =>
  [...dev.notes.values()]
    // у удалённой записи остаток текста не считается: он ни на что не влияет
    .map(
      (n) =>
        [
          n.id,
          n.deletedAt === null ? n.text : null,
          n.deletedAt === null,
          n.conflictOf ?? null,
        ] as const,
    )
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))

const alive = (dev: Device) => [...dev.notes.values()].filter((n) => n.deletedAt === null)

describe('сценарии конфликта на двух устройствах', () => {
  it('одну запись изменили на обоих: остаётся последняя, другая версия сохранена копией на обоих', async () => {
    const a = newDevice('a')
    const b = newDevice('b')
    create(a, 'n1', 'исходный')
    await settle([a, b])
    edit(a, 'n1', 'правка с телефона', 2000)
    edit(b, 'n1', 'правка с компьютера', 3000)
    await settle([a, b])
    expect(view(a)).toEqual(view(b))
    const texts = alive(a)
      .map((n) => n.text)
      .sort()
    expect(texts).toEqual(['правка с компьютера', 'правка с телефона'])
    expect(a.notes.get('n1')?.text).toBe('правка с компьютера')
    const copy = alive(a).find((n) => n.conflictOf)
    expect(copy?.text).toBe('правка с телефона')
    expect(copy?.conflictOf).toBe('n1')
    expect(alive(a)).toHaveLength(2)
    expect(alive(b)).toHaveLength(2)
  })

  it('обе стороны отправили одновременно, не дожидаясь друг друга', async () => {
    const a = newDevice('a')
    const b = newDevice('b')
    create(a, 'n1', 'исходный')
    await settle([a, b])
    edit(a, 'n1', 'A', 2000)
    edit(b, 'n1', 'B', 2500)
    // оба успели отправить свою версию до того, как получили чужую
    push(a)
    push(b)
    await settle([a, b])
    expect(view(a)).toEqual(view(b))
    expect(
      alive(a)
        .map((n) => n.text)
        .sort(),
    ).toEqual(['A', 'B'])
  })

  it('одно устройство правило дважды, другое один раз: правка второго не пропадает молча', async () => {
    const a = newDevice('a')
    const b = newDevice('b')
    create(a, 'n1', 'исходный')
    await settle([a, b])
    edit(a, 'n1', 'A1', 2000)
    edit(a, 'n1', 'A2', 2100)
    edit(b, 'n1', 'B1', 2050)
    // каждое отправило свои правки, ни одно ещё не получило чужие
    push(a)
    push(b)
    await settle([a, b])
    expect(view(a)).toEqual(view(b))
    const texts = alive(a)
      .map((n) => n.text)
      .sort()
    // победила A2 (позже), версия B1 сохранена копией
    expect(texts).toEqual(['A2', 'B1'])
  })

  it('правка и удаление: побеждает позднее, текст правки не пропадает', async () => {
    const a = newDevice('a')
    const b = newDevice('b')
    create(a, 'n1', 'исходный')
    await settle([a, b])
    edit(a, 'n1', 'правка', 2000)
    remove(b, 'n1', 3000)
    await settle([a, b])
    expect(view(a)).toEqual(view(b))
    expect(a.notes.get('n1')?.deletedAt).not.toBeNull()
    expect(alive(a).map((n) => n.text)).toEqual(['правка'])
  })

  it('удаление раньше правки: запись остаётся, копии нет', async () => {
    const a = newDevice('a')
    const b = newDevice('b')
    create(a, 'n1', 'исходный')
    await settle([a, b])
    remove(a, 'n1', 2000)
    edit(b, 'n1', 'правка', 3000)
    await settle([a, b])
    expect(view(a)).toEqual(view(b))
    expect(alive(a).map((n) => n.text)).toEqual(['правка'])
  })

  it('одинаковая правка на обоих не создаёт копий', async () => {
    const a = newDevice('a')
    const b = newDevice('b')
    create(a, 'n1', 'исходный')
    await settle([a, b])
    edit(a, 'n1', 'то же самое', 2000)
    edit(b, 'n1', 'то же самое', 2500)
    await settle([a, b])
    expect(view(a)).toEqual(view(b))
    expect(alive(a)).toHaveLength(1)
  })

  it('обычная правка одного устройства доходит до другого без конфликта', async () => {
    const a = newDevice('a')
    const b = newDevice('b')
    create(a, 'n1', 'исходный')
    await settle([a, b])
    edit(a, 'n1', 'новая версия')
    await settle([a, b])
    expect(b.notes.get('n1')?.text).toBe('новая версия')
    expect(alive(b)).toHaveLength(1)
  })

  it('правки по очереди (второе устройство сначала получило первую) конфликта не дают', async () => {
    const a = newDevice('a')
    const b = newDevice('b')
    create(a, 'n1', 'исходный')
    await settle([a, b])
    edit(a, 'n1', 'от A')
    await settle([a, b])
    edit(b, 'n1', 'от B поверх A')
    await settle([a, b])
    expect(a.notes.get('n1')?.text).toBe('от B поверх A')
    expect(alive(a)).toHaveLength(1)
    expect(alive(b)).toHaveLength(1)
  })

  it('новая запись на одном устройстве появляется на другом', async () => {
    const a = newDevice('a')
    const b = newDevice('b')
    create(a, 'n9', 'новая')
    await settle([a, b])
    expect(b.notes.get('n9')?.text).toBe('новая')
  })

  it('повторный обмен после схождения ничего не меняет', async () => {
    const a = newDevice('a')
    const b = newDevice('b')
    create(a, 'n1', 'исходный')
    await settle([a, b])
    edit(a, 'n1', 'A', 2000)
    edit(b, 'n1', 'B', 3000)
    await settle([a, b])
    const before = JSON.stringify(view(a))
    expect(await settle([a, b])).toBe(0)
    expect(JSON.stringify(view(a))).toBe(before)
    expect(JSON.stringify(view(b))).toBe(before)
  })
})

describe('конфликт на трёх устройствах', () => {
  it('три независимые правки: все три версии есть на всех устройствах', async () => {
    const a = newDevice('a')
    const b = newDevice('b')
    const c = newDevice('c')
    create(a, 'n1', 'исходный')
    await settle([a, b, c])
    edit(a, 'n1', 'версия A', 2000)
    edit(b, 'n1', 'версия B', 3000)
    edit(c, 'n1', 'версия C', 2500)
    await settle([a, b, c])
    expect(view(a)).toEqual(view(b))
    expect(view(b)).toEqual(view(c))
    expect(
      alive(a)
        .map((n) => n.text)
        .sort(),
    ).toEqual(['версия A', 'версия B', 'версия C'])
  })
})

// Случайные правки, удаления, возвращения и обмены между тремя устройствами. После полного обмена
// устройства обязаны совпасть. Начальное число выводится при ошибке, чтобы её можно было повторить.
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

describe('случайные расхождения', () => {
  it('триста случайных историй сходятся, обмен заканчивается, лишних копий не плодится бесконечно', async () => {
    for (let seed = 1; seed <= 300; seed++) {
      drive.length = 0 // у каждой истории свой Диск
      const rnd = random(seed)
      const devices = [newDevice('a'), newDevice('b'), newDevice('c')]
      const ids: string[] = []
      let counter = 0
      const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)]
      try {
        for (let step = 0; step < 40; step++) {
          const dev = pick(devices)
          const roll = rnd()
          if (roll < 0.15 || ids.length === 0) {
            const id = `n${++counter}`
            ids.push(id)
            create(dev, id, `текст ${counter}`)
          } else if (roll < 0.55) {
            const known = ids.filter((id) => dev.notes.has(id))
            if (known.length > 0) edit(dev, pick(known), `правка ${step} от ${dev.id}`)
          } else if (roll < 0.65) {
            const known = ids.filter((id) => dev.notes.get(id)?.deletedAt === null)
            if (known.length > 0) remove(dev, pick(known))
          } else if (roll < 0.7) {
            const known = ids.filter((id) => dev.notes.get(id)?.deletedAt)
            if (known.length > 0) restore(dev, pick(known))
          } else {
            // обмен в произвольном порядке: только отправить, только получить или полный круг
            const kind = rnd()
            if (kind < 0.35) push(dev)
            else if (kind < 0.7) await pull(dev)
            else await round(dev)
          }
        }
        await settle(devices)
        expect(view(devices[0])).toEqual(view(devices[1]))
        expect(view(devices[1])).toEqual(view(devices[2]))
      } catch (error) {
        const states = devices.map((d) => JSON.stringify(view(d))).join('\n')
        throw new Error(`история с начальным числом ${seed}: ${String(error)}\n${states}`, {
          cause: error,
        })
      }
    }
  }, 60_000)

  it('в случайных историях текст каждой правки не пропадает, если после неё его никто не заменил осознанно', async () => {
    // Все правки независимые (каждое устройство правит свою запись до обмена), значит заменить их
    // осознанно никто не мог: после обмена все тексты обязаны присутствовать у всех.
    for (let seed = 1; seed <= 100; seed++) {
      drive.length = 0 // у каждой истории свой Диск
      const rnd = random(seed * 7)
      const devices = [newDevice('a'), newDevice('b'), newDevice('c')]
      create(devices[0], 'n1', 'исходный')
      await settle(devices)
      const written: string[] = []
      for (const dev of devices) {
        const edits = 1 + Math.floor(rnd() * 3)
        for (let i = 0; i < edits; i++) {
          const text = `${dev.id}${i}`
          edit(dev, 'n1', text)
          if (i === edits - 1) written.push(text) // осознанно заменённые своей же следующей правкой не считаем
        }
      }
      await settle(devices)
      const present = alive(devices[0]).map((n) => n.text)
      for (const text of written) expect(present, `начальное число ${seed * 7}`).toContain(text)
      expect(view(devices[0])).toEqual(view(devices[1]))
      expect(view(devices[1])).toEqual(view(devices[2]))
    }
  })
})
