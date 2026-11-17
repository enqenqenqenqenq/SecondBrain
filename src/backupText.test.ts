import { describe, expect, it } from 'vitest'
import { addedTotal, backupFileName, describeAdded, previewLines } from './backupText'
import type { ImportReport } from './storage'

const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  notes: { added: 0, existing: 0, deleted: 0 },
  cards: { added: 0, existing: 0, deleted: 0 },
  links: { added: 0, existing: 0, orphaned: 0 },
  invalid: 0,
  duplicates: 0,
  ...over,
})

describe('имя файла копии', () => {
  it('дата по местному времени, два знака для месяца и дня', () => {
    expect(backupFileName(new Date(2026, 10, 17, 23, 59), 'json')).toBe(
      'secondbrain-2026-11-17.json',
    )
    expect(backupFileName(new Date(2026, 0, 5), 'txt')).toBe('secondbrain-2026-01-05.txt')
  })
})

describe('что показываем про загрузку', () => {
  it('добавленное без нулевых частей и с верным склонением', () => {
    const r = report({
      notes: { added: 118, existing: 0, deleted: 0 },
      cards: { added: 3, existing: 0, deleted: 0 },
      links: { added: 21, existing: 0, orphaned: 0 },
    })
    expect(describeAdded(r)).toBe('Добавлено: 118 записей, 3 карточки, 21 связь.')
    expect(describeAdded(report({ notes: { added: 1, existing: 0, deleted: 0 } }))).toBe(
      'Добавлено: 1 запись.',
    )
    expect(addedTotal(r)).toBe(142)
  })

  it('перед загрузкой: что добавится, что уже есть, что удалено, что повреждено', () => {
    const r = report({
      notes: { added: 2, existing: 5, deleted: 1 },
      cards: { added: 0, existing: 1, deleted: 0 },
      links: { added: 0, existing: 0, orphaned: 2 },
      invalid: 1,
    })
    expect(previewLines(r)).toEqual([
      'Будет добавлено: 2 записи.',
      'Уже есть, останется как есть: 6 объектов.',
      'Вы их удалили, не вернутся: 1 объект.',
      'Повреждено, будет пропущено: 3 объекта.',
    ])
  })

  it('когда добавлять нечего, строки про добавление нет', () => {
    const r = report({ notes: { added: 0, existing: 4, deleted: 0 } })
    expect(addedTotal(r)).toBe(0)
    expect(previewLines(r)).toEqual(['Уже есть, останется как есть: 4 объекта.'])
    expect(previewLines(report())).toEqual([])
  })
})
