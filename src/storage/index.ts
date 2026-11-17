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
  countNotesOfCard,
  watchCardsOfNote,
  watchNotesOfCard,
} from './links'
export type { CardOfNote } from './links'
export { eventAt, formatMinute, describeEvent } from './time'
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
