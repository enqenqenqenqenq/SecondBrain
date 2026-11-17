// Единственная точка входа к данным. Остальной код базу напрямую не трогает.
export {
  createNote,
  getNote,
  listNotes,
  countNotes,
  updateNote,
  deleteNote,
  restoreNote,
} from './notes'
export { eventAt, formatMinute } from './time'
export type { Note, NotePatch, EventTime, Precision, ListOptions } from './types'
