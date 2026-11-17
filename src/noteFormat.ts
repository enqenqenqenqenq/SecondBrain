import { MONTHS_OF } from './storage'
import type { Birthday, Note } from './storage'

// Сплошная плашка для точного времени, пунктирная для приблизительного
export const isApproximate = (note: Note) =>
  note.event.precision !== 'minute' && note.event.precision !== 'day'

// «14 марта 1990», а если год неизвестен, «14 марта»
export const formatBirthday = (b: Birthday): string =>
  `${b.day} ${MONTHS_OF[b.month - 1]}${b.year === undefined ? '' : ` ${b.year}`}`
