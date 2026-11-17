import type { Note } from './storage'

// Сплошная плашка для точного времени, пунктирная для приблизительного
export const isApproximate = (note: Note) =>
  note.event.precision !== 'minute' && note.event.precision !== 'day'
