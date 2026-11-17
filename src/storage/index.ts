// Единственная точка входа к данным. Остальной код базу напрямую не трогает.
export {
  createNote,
  getNote,
  listNotes,
  countNotes,
  updateNote,
  deleteNote,
  restoreNote,
  watchNotes,
  watchNote,
  isUnreviewed,
} from './notes'
export {
  createCard,
  getCard,
  listCards,
  updateCard,
  deleteCard,
  restoreCard,
  watchCards,
  watchCard,
  isValidBirthday,
} from './cards'
export {
  linkNote,
  unlinkNote,
  listCardsOfNote,
  listNotesOfCard,
  listCardFeed,
  countNotesOfCard,
  cardStats,
  watchCardsOfNote,
  watchNotesOfCard,
  watchCardFeed,
  watchCardStats,
} from './links'
export type { CardOfNote, CardFeedEntry, CardStats } from './links'
export { completeNote } from './complete'
export type { CompleteInput, CompleteLink, CompleteResult } from './complete'
export {
  exportData,
  serializeExport,
  exportText,
  parseExport,
  importData,
  EXPORT_FORMAT,
  EXPORT_VERSION,
} from './backup'
export type { ExportFile, ParsedExport, ParseResult, ImportReport } from './backup'
export { eventAt, formatMinute, describeEvent, MONTHS_OF } from './time'
export {
  minuteEvent,
  dayEvent,
  monthEvent,
  seasonEvent,
  yearEvent,
  rangeEvent,
  isValidEvent,
} from './fuzzyTime'
export type { Season } from './fuzzyTime'
export { seedNotes, removeSeededNotes, generateNotes, SEED_TAG } from './seed'
export type {
  Note,
  NotePatch,
  EventTime,
  Precision,
  ListOptions,
  Card,
  CardKind,
  CardPatch,
  NewCard,
  Birthday,
  Fact,
  Link,
  LinkRole,
} from './types'
