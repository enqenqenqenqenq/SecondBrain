import { liveQuery } from 'dexie'
import { db, getDeviceId } from './db'
import type { Birthday, Card, CardKind, CardPatch, Fact, NewCard } from './types'

const collator = new Intl.Collator('ru', { sensitivity: 'base' })

function cleanName(name: string): string {
  const value = name.trim()
  if (!value) throw new Error('Имя не может быть пустым')
  return value
}

// Прозвища: без пустых и без повторов (регистр не важен), порядок сохраняется
function cleanAliases(aliases: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const alias of aliases) {
    const value = alias.trim()
    const key = value.toLowerCase()
    if (!value || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function cleanFacts(facts: Fact[]): Fact[] {
  return facts.map((fact) => {
    const label = fact.label.trim()
    const value = fact.value.trim()
    if (!label || !value) throw new Error('Строка анкеты не может быть пустой')
    return { label, value }
  })
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)

// 29 февраля допустимо без года и в високосном году
export function isValidBirthday(value: unknown): value is Birthday {
  if (typeof value !== 'object' || value === null) return false
  const { month, day, year } = value as Birthday
  if (!isInt(month) || month < 1 || month > 12) return false
  if (!isInt(day) || day < 1) return false
  if (year === undefined) return day <= new Date(2024, month, 0).getDate()
  if (!isInt(year) || year < 1 || year > 9999) return false
  const probe = new Date(2000, month - 1, day)
  probe.setFullYear(year)
  return probe.getMonth() === month - 1 && probe.getDate() === day
}

function cleanBirthday(value: Birthday | null): Birthday | null {
  if (value === null) return null
  if (!isValidBirthday(value)) throw new Error('Некорректный день рождения')
  return value.year === undefined
    ? { month: value.month, day: value.day }
    : { month: value.month, day: value.day, year: value.year }
}

// Поля человека не должны попасть к месту и наоборот
function checkKindFields(kind: CardKind, birthday: unknown, facts: unknown[], address: string) {
  if (kind === 'place' && (birthday !== null || facts.length > 0)) {
    throw new Error('День рождения и анкета бывают только у человека')
  }
  if (kind === 'person' && address !== '') {
    throw new Error('Адрес бывает только у места')
  }
}

export async function createCard(input: NewCard): Promise<Card> {
  if (input.kind !== 'person' && input.kind !== 'place') throw new Error('Неизвестный вид карточки')
  const birthday = cleanBirthday(input.birthday ?? null)
  const facts = cleanFacts(input.facts ?? [])
  const address = (input.address ?? '').trim()
  checkKindFields(input.kind, birthday, facts, address)
  const now = Date.now()
  const card: Card = {
    id: crypto.randomUUID(),
    kind: input.kind,
    name: cleanName(input.name),
    aliases: cleanAliases(input.aliases ?? []),
    description: (input.description ?? '').trim(),
    birthday,
    facts,
    address,
    mergedInto: null,
    createdAt: now,
    updatedAt: now,
    rev: 1,
    deviceId: await getDeviceId(),
    deletedAt: null,
  }
  await db.cards.add(card)
  return card
}

export async function getCard(id: string): Promise<Card | undefined> {
  const card = await db.cards.get(id)
  return card && card.deletedAt === null ? card : undefined
}

// Карточки по имени, без учёта регистра. Без вида возвращаются и люди, и места
export async function listCards(options: { kind?: CardKind } = {}): Promise<Card[]> {
  const cards = await db.cards
    .filter((c) => c.deletedAt === null && (!options.kind || c.kind === options.kind))
    .toArray()
  return cards.sort((a, b) => collator.compare(a.name, b.name) || a.createdAt - b.createdAt)
}

export async function updateCard(id: string, patch: CardPatch): Promise<Card | undefined> {
  const existing = await getCard(id)
  if (!existing) return undefined
  // Пустое изменение не считается правкой
  if (Object.values(patch).every((value) => value === undefined)) return existing
  const birthday = patch.birthday === undefined ? existing.birthday : cleanBirthday(patch.birthday)
  const facts = patch.facts === undefined ? existing.facts : cleanFacts(patch.facts)
  const address = patch.address === undefined ? existing.address : patch.address.trim()
  checkKindFields(existing.kind, birthday, facts, address)
  const changes: Partial<Card> = {
    ...(patch.name !== undefined && { name: cleanName(patch.name) }),
    ...(patch.aliases !== undefined && { aliases: cleanAliases(patch.aliases) }),
    ...(patch.description !== undefined && { description: patch.description.trim() }),
    ...(patch.birthday !== undefined && { birthday }),
    ...(patch.facts !== undefined && { facts }),
    ...(patch.address !== undefined && { address }),
  }
  const deviceId = await getDeviceId()
  return db.transaction('rw', db.cards, async () => {
    const current = await db.cards.get(id)
    if (!current || current.deletedAt !== null) return undefined
    const next: Card = {
      ...current,
      ...changes,
      updatedAt: Date.now(),
      rev: current.rev + 1,
      deviceId,
    }
    await db.cards.put(next)
    return next
  })
}

// Мягкое удаление. Связи карточки удаляются в тот же момент, поэтому отмена возвращает именно их
export async function deleteCard(id: string): Promise<boolean> {
  if (!(await getCard(id))) return false
  const deviceId = await getDeviceId()
  return db.transaction('rw', db.cards, db.links, async () => {
    const current = await db.cards.get(id)
    if (!current || current.deletedAt !== null) return false
    const at = Date.now()
    await db.cards.put({ ...current, deletedAt: at, updatedAt: at, rev: current.rev + 1, deviceId })
    const links = await db.links
      .where('cardId')
      .equals(id)
      .filter((l) => l.deletedAt === null)
      .toArray()
    await db.links.bulkPut(
      links.map((l) => ({ ...l, deletedAt: at, updatedAt: at, rev: l.rev + 1, deviceId })),
    )
    return true
  })
}

// Отмена удаления возвращает карточку и те связи, что ушли вместе с ней, но не те, что убрали раньше
export async function restoreCard(id: string): Promise<boolean> {
  const current = await db.cards.get(id)
  if (!current || current.deletedAt === null) return false
  const deviceId = await getDeviceId()
  return db.transaction('rw', db.cards, db.links, async () => {
    const card = await db.cards.get(id)
    if (!card || card.deletedAt === null) return false
    const removedAt = card.deletedAt
    const at = Date.now()
    await db.cards.put({ ...card, deletedAt: null, updatedAt: at, rev: card.rev + 1, deviceId })
    const links = await db.links
      .where('cardId')
      .equals(id)
      .filter((l) => l.deletedAt === removedAt)
      .toArray()
    await db.links.bulkPut(
      links.map((l) => ({ ...l, deletedAt: null, updatedAt: at, rev: l.rev + 1, deviceId })),
    )
    return true
  })
}

export function watchCards(
  onChange: (cards: Card[]) => void,
  onError?: (error: unknown) => void,
  options: { kind?: CardKind } = {},
): () => void {
  const subscription = liveQuery(() => listCards(options)).subscribe({
    next: onChange,
    error: onError,
  })
  return () => subscription.unsubscribe()
}

export function watchCard(
  id: string,
  onChange: (card: Card | undefined) => void,
  onError?: (error: unknown) => void,
): () => void {
  const subscription = liveQuery(() => getCard(id)).subscribe({ next: onChange, error: onError })
  return () => subscription.unsubscribe()
}
