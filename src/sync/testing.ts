// Заменители Диска и местной базы для проверок движка. В приложение не попадают: их импортируют только тесты.
import { bumpClock } from '../storage/clock'
import type { Card, Link, Note } from '../storage'
import { decide } from './apply'
import { emptyMeta } from './types'
import type {
  ApplyReport,
  Entity,
  LocalStore,
  RemoteFile,
  RemoteStore,
  SyncMeta,
  SyncObject,
} from './types'

type Op = 'list' | 'read' | 'create' | 'delete'

// Диск в памяти. Можно заставить действие падать, чтобы проверить обрывы.
export class MemoryRemote implements RemoteStore {
  files = new Map<string, { name: string; content: string }>()
  private next = 1
  calls: Record<Op, number> = { list: 0, read: 0, create: 0, delete: 0 }
  private failures: { op: Op; match?: (name: string) => boolean; times: number }[] = []

  // Следующие times вызовов действия op (для файлов, подходящих под match) завершатся ошибкой
  fail(op: Op, times = 1, match?: (name: string) => boolean) {
    this.failures.push({ op, times, match })
  }

  private maybeFail(op: Op, name = '') {
    this.calls[op]++
    const f = this.failures.find((x) => x.op === op && x.times > 0 && (!x.match || x.match(name)))
    if (f) {
      f.times--
      throw new Error(`Сбой Диска: ${op} ${name}`)
    }
  }

  async list(): Promise<RemoteFile[]> {
    this.maybeFail('list')
    return [...this.files].map(([id, f]) => ({ id, name: f.name }))
  }

  async read(id: string): Promise<string> {
    const f = this.files.get(id)
    this.maybeFail('read', f?.name)
    if (!f) throw new Error('Файла нет')
    return f.content
  }

  async create(name: string, content: string): Promise<RemoteFile> {
    this.maybeFail('create', name)
    const id = `f${this.next++}`
    this.files.set(id, { name, content })
    return { id, name }
  }

  async delete(id: string): Promise<void> {
    this.maybeFail('delete', this.files.get(id)?.name)
    this.files.delete(id)
  }

  names(): string[] {
    return [...this.files.values()].map((f) => f.name).sort()
  }

  idOf(name: string): string {
    const found = [...this.files].find(([, f]) => f.name === name)
    if (!found) throw new Error(`Нет файла ${name}`)
    return found[0]
  }
}

// Местные данные в памяти: те же правила слияния и те же признаки «не отправлено», что и у базы
export class MemoryLocal implements LocalStore {
  notes = new Map<string, Note>()
  cards = new Map<string, Card>()
  links = new Map<string, Link>()
  synced = new Map<string, number>()
  meta: SyncMeta = emptyMeta()
  failSaveMeta = 0
  id: string
  private tick: () => number

  constructor(id: string, tick: () => number = () => ++sharedTime) {
    this.id = id
    this.tick = tick
  }

  private table(entity: Entity): Map<string, Note | Card | Link> {
    return { note: this.notes, card: this.cards, link: this.links }[entity] as Map<
      string,
      Note | Card | Link
    >
  }

  async deviceId() {
    return this.id
  }

  // ----- как будто это пишет приложение -----
  addNote(id: string, text: string): Note {
    const at = this.tick()
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
      clock: bumpClock(undefined, this.id),
      deviceId: this.id,
      deletedAt: null,
    }
    this.notes.set(id, note)
    return note
  }

  editNote(id: string, changes: Partial<Note>): Note {
    const n = this.notes.get(id)
    if (!n) throw new Error(`Нет записи ${id}`)
    const next: Note = {
      ...n,
      ...changes,
      updatedAt: this.tick(),
      rev: n.rev + 1,
      clock: bumpClock(n.clock, this.id),
      deviceId: this.id,
    }
    this.notes.set(id, next)
    return next
  }

  removeNote(id: string) {
    return this.editNote(id, { deletedAt: this.tick() })
  }

  addCard(id: string, name: string): Card {
    const at = this.tick()
    const card: Card = {
      id,
      kind: 'person',
      name,
      aliases: [],
      description: '',
      birthday: null,
      facts: [],
      address: '',
      mergedInto: null,
      createdAt: at,
      updatedAt: at,
      rev: 1,
      clock: bumpClock(undefined, this.id),
      deviceId: this.id,
      deletedAt: null,
    }
    this.cards.set(id, card)
    return card
  }

  addLink(id: string, ownerId: string, cardId: string): Link {
    const at = this.tick()
    const link: Link = {
      id,
      ownerType: 'note',
      ownerId,
      cardId,
      role: null,
      createdAt: at,
      updatedAt: at,
      rev: 1,
      clock: bumpClock(undefined, this.id),
      deviceId: this.id,
      deletedAt: null,
    }
    this.links.set(id, link)
    return link
  }

  alive(): Note[] {
    return [...this.notes.values()].filter((n) => n.deletedAt === null)
  }

  // ----- LocalStore -----
  private entries(): SyncObject[] {
    return [
      ...[...this.notes.values()].map((data): SyncObject => ({ entity: 'note', data })),
      ...[...this.cards.values()].map((data): SyncObject => ({ entity: 'card', data })),
      ...[...this.links.values()].map((data): SyncObject => ({ entity: 'link', data })),
    ]
  }

  async collectDirty() {
    return this.entries().filter(
      (o) => o.data.rev > (this.synced.get(`${o.entity}:${o.data.id}`) ?? 0),
    )
  }

  async markSynced(objects: SyncObject[]) {
    for (const o of objects) {
      const key = `${o.entity}:${o.data.id}`
      this.synced.set(key, Math.max(this.synced.get(key) ?? 0, o.data.rev))
    }
  }

  async allObjects() {
    return this.entries()
  }

  async applyRemote(objects: SyncObject[]): Promise<ApplyReport> {
    const report: ApplyReport = { applied: 0, skipped: 0, conflicts: 0, invalid: 0 }
    for (const o of objects) {
      const table = this.table(o.entity)
      const outcome = await decide(o.entity, table.get(o.data.id), o.data, this.id)
      if (outcome.action === 'skip') {
        report.skipped++
        continue
      }
      table.set(o.data.id, outcome.write!)
      if (outcome.synced) this.synced.set(`${o.entity}:${o.data.id}`, outcome.write!.rev)
      if (outcome.copy && !table.has(outcome.copy.id)) table.set(outcome.copy.id, outcome.copy)
      if (outcome.action === 'conflict') report.conflicts++
      else report.applied++
    }
    return report
  }

  async loadMeta() {
    return structuredClone(this.meta)
  }

  async saveMeta(meta: SyncMeta) {
    if (this.failSaveMeta > 0) {
      this.failSaveMeta--
      throw new Error('Сбой при сохранении состояния')
    }
    this.meta = structuredClone(meta)
  }
}

let sharedTime = 1_000_000_000_000
export const advanceTime = (ms: number) => {
  sharedTime += ms
}
export const currentTime = () => sharedTime
