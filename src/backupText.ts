import type { ImportReport } from './storage'
import { withUnit } from './plural'

const NOTES: [string, string, string] = ['запись', 'записи', 'записей']
const CARDS: [string, string, string] = ['карточка', 'карточки', 'карточек']
const LINKS: [string, string, string] = ['связь', 'связи', 'связей']
const THINGS: [string, string, string] = ['объект', 'объекта', 'объектов']

const pad = (n: number) => String(n).padStart(2, '0')

// secondbrain-2026-11-17.json, дата местная
export function backupFileName(date: Date, extension: 'json' | 'txt'): string {
  return `secondbrain-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.${extension}`
}

export const addedTotal = (r: ImportReport): number => r.notes.added + r.cards.added + r.links.added

// «118 записей, 3 карточки, 7 связей», без нулевых частей
function addedParts(r: ImportReport): string {
  return [
    r.notes.added > 0 && withUnit(r.notes.added, NOTES),
    r.cards.added > 0 && withUnit(r.cards.added, CARDS),
    r.links.added > 0 && withUnit(r.links.added, LINKS),
  ]
    .filter(Boolean)
    .join(', ')
}

export const describeAdded = (r: ImportReport): string => `Добавлено: ${addedParts(r)}.`

// Что покажем перед загрузкой, чтобы человек понимал, что произойдёт
export function previewLines(r: ImportReport): string[] {
  const existing = r.notes.existing + r.cards.existing + r.links.existing
  const deleted = r.notes.deleted + r.cards.deleted
  const damaged = r.invalid + r.links.orphaned
  const lines: string[] = []
  if (addedTotal(r) > 0) lines.push(`Будет добавлено: ${addedParts(r)}.`)
  if (existing > 0) lines.push(`Уже есть, останется как есть: ${withUnit(existing, THINGS)}.`)
  if (deleted > 0) lines.push(`Вы их удалили, не вернутся: ${withUnit(deleted, THINGS)}.`)
  if (damaged > 0) lines.push(`Повреждено, будет пропущено: ${withUnit(damaged, THINGS)}.`)
  return lines
}
