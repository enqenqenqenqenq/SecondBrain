import { isValidClock } from './clock'
import { db } from './db'
import { isValidBirthday } from './cards'
import { isValidEvent } from './fuzzyTime'
import { idFromKey } from './ids'
import { MONTHS_OF, describeEvent, eventAt } from './time'
import type { Card, Fact, Link, Note } from './types'

// Копия данных: обычный файл JSON, который открывается любым редактором, и текстовый вариант для чтения.
// Файл не зашифрован, это сделано намеренно: копия нужна, чтобы данные нельзя было потерять вместе с приложением.

export const EXPORT_FORMAT = 'secondbrain-export'
export const EXPORT_VERSION = 1

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: number
  exportedAt: string
  notes: Note[]
  cards: Card[]
  links: Link[]
}

// Выгрузка только живых объектов: то, что человек удалил, в копию не попадает.
// Связь попадает, если живы и запись, и карточка.
export async function exportData(now: Date = new Date()): Promise<ExportFile> {
  return db.transaction('r', db.notes, db.cards, db.links, async () => {
    const notes = await db.notes.filter((n) => n.deletedAt === null).toArray()
    const cards = await db.cards.filter((c) => c.deletedAt === null).toArray()
    const noteIds = new Set(notes.map((n) => n.id))
    const cardIds = new Set(cards.map((c) => c.id))
    const links = await db.links
      .filter((l) => l.deletedAt === null && noteIds.has(l.ownerId) && cardIds.has(l.cardId))
      .toArray()
    notes.sort((a, b) =>
      a.event.from === b.event.from
        ? b.createdAt - a.createdAt
        : a.event.from < b.event.from
          ? 1
          : -1,
    )
    cards.sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.createdAt - b.createdAt)
    links.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: now.toISOString(),
      notes,
      cards,
      links,
    }
  })
}

export const serializeExport = (file: ExportFile): string => JSON.stringify(file, null, 2)

// Для текстового файла нужны даты без «сегодня» и «вчера», поэтому «сейчас» берётся из далёкого будущего
const FAR_FUTURE = new Date(9999, 0, 1)

function birthdayText(card: Card): string {
  const b = card.birthday
  if (!b) return ''
  return `${b.day} ${MONTHS_OF[b.month - 1]}${b.year === undefined ? '' : ` ${b.year}`}`
}

export function exportText(file: ExportFile): string {
  const cardsById = new Map(file.cards.map((c) => [c.id, c]))
  const linksByNote = new Map<string, Link[]>()
  for (const link of file.links) {
    const list = linksByNote.get(link.ownerId) ?? []
    list.push(link)
    linksByNote.set(link.ownerId, list)
  }
  const people = file.cards.filter((c) => c.kind === 'person')
  const places = file.cards.filter((c) => c.kind === 'place')
  const out: string[] = [
    'Копия данных SecondBrain',
    describeEvent(eventAt(new Date(file.exportedAt)), FAR_FUTURE),
    `Записей: ${file.notes.length}. Людей: ${people.length}. Мест: ${places.length}.`,
  ]

  if (file.notes.length > 0) {
    out.push('', 'ЗАПИСИ')
    for (const note of file.notes) {
      const lines = [describeEvent(note.event, FAR_FUTURE), note.text]
      const names = (linksByNote.get(note.id) ?? [])
        .map((l) => {
          const card = cardsById.get(l.cardId)
          if (!card) return ''
          const role =
            l.role === 'with' ? ' (был со мной)' : l.role === 'mentioned' ? ' (упомянут)' : ''
          return card.name + role
        })
        .filter(Boolean)
      if (names.length > 0) lines.push(`Люди и места: ${names.join(', ')}`)
      out.push('', ...lines)
    }
  }

  const cardBlock = (card: Card): string[] => {
    const lines = [card.name]
    if (card.aliases.length > 0) lines.push(`Прозвища: ${card.aliases.join(', ')}`)
    if (card.description) lines.push(`Описание: ${card.description}`)
    if (card.birthday) lines.push(`День рождения: ${birthdayText(card)}`)
    if (card.address) lines.push(`Адрес: ${card.address}`)
    for (const fact of card.facts) lines.push(`${fact.label}: ${fact.value}`)
    return lines
  }
  if (people.length > 0) {
    out.push('', 'ЛЮДИ')
    for (const card of people) out.push('', ...cardBlock(card))
  }
  if (places.length > 0) {
    out.push('', 'МЕСТА')
    for (const card of places) out.push('', ...cardBlock(card))
  }
  return `${out.join('\n')}\n`
}

// ---------- чтение файла ----------

const MAX_TEXT = 1_000_000
const MAX_ID = 100

export interface ParsedExport {
  notes: Note[]
  cards: Card[]
  links: Link[]
  invalid: number // повреждённые объекты, они пропущены
  duplicates: number // повторы одного id внутри файла, берётся первый
}

export type ParseResult = { ok: true; data: ParsedExport } | { ok: false; error: string }

type Raw = Record<string, unknown>
const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const isId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_ID
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_TEXT
const isStrList = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length <= 1000 &&
  v.every((s) => typeof s === 'string' && s.length <= MAX_ID)

// Общие поля. Удалённые объекты не восстанавливаем, поэтому deletedAt обязан быть пустым
function common(o: Raw, allowDeleted = false) {
  const { id, createdAt, updatedAt, rev, deviceId, deletedAt } = o
  if (!isId(id) || !isNum(createdAt) || !isNum(updatedAt)) return null
  if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 1) return null
  if (!isId(deviceId)) return null
  // При загрузке из копии данных удалённые не нужны. С Диска приходят и удалённые: это и есть удаление.
  if (allowDeleted ? deletedAt !== null && !isNum(deletedAt) : deletedAt !== null) return null
  // Версии для разбора конфликтов: нет у старых копий, а испорченные делают объект повреждённым
  if (o.clock !== undefined && !isValidClock(o.clock)) return null
  return {
    id,
    createdAt,
    updatedAt,
    rev,
    deviceId,
    deletedAt: allowDeleted ? (deletedAt as number | null) : null,
    ...(o.clock !== undefined && { clock: o.clock }),
  }
}

function toNote(o: Raw, allowDeleted = false): Note | null {
  const base = common(o, allowDeleted)
  if (!base || !isStr(o.text) || o.text.trim() === '') return null
  if (!isValidEvent(o.event as never) || typeof o.timeIsAuto !== 'boolean') return null
  if (o.reviewedAt !== null && !isNum(o.reviewedAt)) return null
  if (!isStrList(o.tagIds)) return null
  if (o.conflictOf !== undefined && o.conflictOf !== null && !isId(o.conflictOf)) return null
  const e = o.event as Note['event']
  return {
    ...base,
    text: o.text,
    event: { precision: e.precision, from: e.from, to: e.to },
    timeIsAuto: o.timeIsAuto,
    reviewedAt: o.reviewedAt as number | null,
    tagIds: o.tagIds,
    ...(typeof o.conflictOf === 'string' && { conflictOf: o.conflictOf }),
  }
}

function toFacts(v: unknown): Fact[] | null {
  if (!Array.isArray(v) || v.length > 1000) return null
  const facts: Fact[] = []
  for (const f of v) {
    if (!isRecord(f) || !isStr(f.label) || !isStr(f.value)) return null
    if (f.label.trim() === '' || f.value.trim() === '') return null
    facts.push({ label: f.label, value: f.value })
  }
  return facts
}

function toCard(o: Raw, allowDeleted = false): Card | null {
  const base = common(o, allowDeleted)
  if (!base || (o.kind !== 'person' && o.kind !== 'place')) return null
  if (!isStr(o.name) || o.name.trim() === '' || !isStrList(o.aliases)) return null
  if (!isStr(o.description) || !isStr(o.address)) return null
  if (o.mergedInto !== null && !isId(o.mergedInto)) return null
  const facts = toFacts(o.facts)
  if (!facts) return null
  let birthday: Card['birthday'] = null
  if (o.birthday !== null) {
    if (!isValidBirthday(o.birthday)) return null
    const b = o.birthday
    birthday =
      b.year === undefined
        ? { month: b.month, day: b.day }
        : { month: b.month, day: b.day, year: b.year }
  }
  if (o.kind === 'place' && (birthday !== null || facts.length > 0)) return null
  if (o.kind === 'person' && o.address !== '') return null
  return {
    ...base,
    kind: o.kind,
    name: o.name,
    aliases: o.aliases,
    description: o.description,
    birthday,
    facts,
    address: o.address,
    mergedInto: o.mergedInto,
  }
}

function toLink(o: Raw, allowDeleted = false): Link | null {
  const base = common(o, allowDeleted)
  if (!base || o.ownerType !== 'note' || !isId(o.ownerId) || !isId(o.cardId)) return null
  if (o.role !== null && o.role !== 'with' && o.role !== 'mentioned') return null
  return { ...base, ownerType: 'note', ownerId: o.ownerId, cardId: o.cardId, role: o.role }
}

function readList<T extends { id: string }>(
  list: unknown[],
  convert: (o: Raw) => T | null,
  counters: { invalid: number; duplicates: number },
): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of list) {
    const value = isRecord(item) ? convert(item) : null
    if (!value) {
      counters.invalid++
    } else if (seen.has(value.id)) {
      counters.duplicates++
    } else {
      seen.add(value.id)
      result.push(value)
    }
  }
  return result
}

// Разбор файла. Целиком файл отклоняется, если это не копия или версия новее. Отдельные повреждённые
// объекты пропускаются и считаются, чтобы одна испорченная запись не мешала вернуть остальные.
export function parseExport(raw: string): ParseResult {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  if (text.trim() === '') return { ok: false, error: 'Файл пустой' }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Файл повреждён или это не копия данных' }
  }
  if (!isRecord(value) || value.format !== EXPORT_FORMAT) {
    return { ok: false, error: 'Это не копия данных SecondBrain' }
  }
  const { version } = value
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'Неизвестная версия файла' }
  }
  if (version > EXPORT_VERSION) {
    return { ok: false, error: 'Копия сделана более новой версией приложения. Обновите приложение' }
  }
  if (!Array.isArray(value.notes) || !Array.isArray(value.cards) || !Array.isArray(value.links)) {
    return { ok: false, error: 'В файле не хватает данных, он повреждён' }
  }
  const counters = { invalid: 0, duplicates: 0 }
  return {
    ok: true,
    data: {
      notes: readList(value.notes, toNote, counters),
      cards: readList(value.cards, toCard, counters),
      links: readList(value.links, toLink, counters),
      ...counters,
    },
  }
}

// ---------- загрузка в базу ----------

export interface ImportReport {
  notes: { added: number; existing: number; deleted: number }
  cards: { added: number; existing: number; deleted: number }
  // orphaned: связь, у которой нет записи или карточки, она не нужна
  links: { added: number; existing: number; orphaned: number }
  invalid: number
  duplicates: number
}

interface Found {
  deletedAt: number | null
}

// Делит объекты файла на те, что добавятся, и на уже существующие и удалённые у человека
function split<T extends { id: string }>(items: T[], found: (Found | undefined)[]) {
  const add: T[] = []
  let existing = 0
  let deleted = 0
  items.forEach((item, i) => {
    const local = found[i]
    if (!local) add.push(item)
    else if (local.deletedAt === null) existing++
    else deleted++
  })
  return { add, existing, deleted }
}

// Добавляет в базу то, чего в ней нет. Ничего не заменяет и не удаляет: что уже есть, остаётся как было,
// что человек удалил, не возвращается. С commit равным false только считает, что произойдёт.
export async function importData(
  data: ParsedExport,
  { commit }: { commit: boolean },
): Promise<ImportReport> {
  // Идентификатор связи всегда из хеша пары, как у связей приложения
  const links: Link[] = []
  const seenLinks = new Set<string>()
  let duplicates = data.duplicates
  for (const link of data.links) {
    const id = await idFromKey(`link:note:${link.ownerId}:${link.cardId}`)
    if (seenLinks.has(id)) {
      duplicates++
      continue
    }
    seenLinks.add(id)
    links.push({ ...link, id })
  }

  return db.transaction('rw', db.notes, db.cards, db.links, async () => {
    const notes = split(data.notes, await db.notes.bulkGet(data.notes.map((n) => n.id)))
    const cards = split(data.cards, await db.cards.bulkGet(data.cards.map((c) => c.id)))

    // Живые записи и карточки после загрузки: были живыми или добавляются сейчас
    const aliveNotes = new Set(notes.add.map((n) => n.id))
    const aliveCards = new Map(cards.add.map((c) => [c.id, c.kind]))
    const localNotes = await db.notes.bulkGet([...new Set(links.map((l) => l.ownerId))])
    const localCards = await db.cards.bulkGet([...new Set(links.map((l) => l.cardId))])
    for (const n of localNotes) if (n && n.deletedAt === null) aliveNotes.add(n.id)
    for (const c of localCards) if (c && c.deletedAt === null) aliveCards.set(c.id, c.kind)

    let invalid = data.invalid
    let orphaned = 0
    const usable: Link[] = []
    for (const link of links) {
      const kind = aliveCards.get(link.cardId)
      if (!aliveNotes.has(link.ownerId) || !kind) orphaned++
      else if (kind === 'place' && link.role !== null)
        invalid++ // роль бывает только у человека
      else usable.push(link)
    }
    const linkSplit = split(usable, await db.links.bulkGet(usable.map((l) => l.id)))

    if (commit) {
      await db.notes.bulkAdd(notes.add)
      await db.cards.bulkAdd(cards.add)
      await db.links.bulkAdd(linkSplit.add)
    }
    return {
      notes: { added: notes.add.length, existing: notes.existing, deleted: notes.deleted },
      cards: { added: cards.add.length, existing: cards.existing, deleted: cards.deleted },
      links: {
        added: linkSplit.add.length,
        existing: linkSplit.existing + linkSplit.deleted,
        orphaned,
      },
      invalid,
      duplicates,
    }
  })
}

// Проверка одного объекта, пришедшего с другого устройства через Диск. Возвращает чистый объект или
// null, если он повреждён. Удалённые допустимы.
export const readRemoteNote = (value: unknown): Note | null =>
  isRecord(value) ? toNote(value, true) : null
export const readRemoteCard = (value: unknown): Card | null =>
  isRecord(value) ? toCard(value, true) : null
export const readRemoteLink = (value: unknown): Link | null =>
  isRecord(value) ? toLink(value, true) : null
