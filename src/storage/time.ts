import type { EventTime } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

// Местное время с точностью до минуты, например 2026-11-17T13:45
export function formatMinute(date: Date): string {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${d}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Время события для обычной записи: момент сохранения
export function eventAt(date: Date = new Date()): EventTime {
  const s = formatMinute(date)
  return { precision: 'minute', from: s, to: s }
}
