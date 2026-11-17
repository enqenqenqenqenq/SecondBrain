export interface Range {
  start: number
  end: number
}

export interface Part {
  text: string
  mark: boolean
}

// Приводит текст к виду для сравнения: без регистра, «ё» как «е».
// Длина строки не меняется, поэтому номера знаков совпадают с исходным текстом.
export function fold(text: string): string {
  let out = ''
  for (const ch of text) {
    const lower = ch.toLowerCase().replace('ё', 'е')
    out += lower.length === ch.length ? lower : ch
  }
  return out
}

// Приведённый текст запоминается по номеру и версии записи: при следующем нажатии клавиши
// пересчитываются только изменившиеся записи, а не все
const foldCache = new Map<string, { rev: number; folded: string }>()

export function foldedFor(id: string, rev: number, text: string): string {
  const hit = foldCache.get(id)
  if (hit && hit.rev === rev) return hit.folded
  const folded = fold(text)
  foldCache.set(id, { rev, folded })
  return folded
}

// Слова запроса. Пустой запрос даёт пустой список, и тогда подходит любая запись.
export function parseQuery(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean)
}

// Запись подходит, если в ней есть все слова запроса, в любом порядке
export function matches(foldedText: string, words: string[]): boolean {
  return words.every((word) => foldedText.includes(word))
}

// Места найденных слов в исходном тексте, пересекающиеся и соседние склеены
export function findRanges(text: string, words: string[]): Range[] {
  if (words.length === 0) return []
  const folded = fold(text)
  const found: Range[] = []
  for (const word of words) {
    let at = folded.indexOf(word)
    while (at !== -1) {
      found.push({ start: at, end: at + word.length })
      at = folded.indexOf(word, at + word.length)
    }
  }
  found.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Range[] = []
  for (const range of found) {
    const last = merged.at(-1)
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

// Делит текст на части: обычные и подсвеченные
export function splitByRanges(text: string, ranges: Range[]): Part[] {
  const parts: Part[] = []
  let cursor = 0
  for (const { start, end } of ranges) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), mark: false })
    parts.push({ text: text.slice(start, end), mark: true })
    cursor = end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), mark: false })
  return parts
}

// Для длинной записи берёт кусок вокруг первого совпадения, чтобы найденное было видно
export function makeSnippet(
  text: string,
  ranges: Range[],
  max = 200,
  before = 60,
): { text: string; ranges: Range[] } {
  if (text.length <= max || ranges.length === 0) return { text, ranges }
  const start = Math.max(0, ranges[0].start - before)
  const end = Math.min(text.length, start + max)
  const lead = start > 0 ? '…' : ''
  const tail = end < text.length ? '…' : ''
  const shift = lead.length - start
  const inside = ranges
    .filter((r) => r.end > start && r.start < end)
    .map((r) => ({ start: Math.max(r.start, start) + shift, end: Math.min(r.end, end) + shift }))
  return { text: lead + text.slice(start, end) + tail, ranges: inside }
}
