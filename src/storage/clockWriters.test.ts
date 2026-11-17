import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  completeNote,
  createCard,
  createNote,
  deleteCard,
  deleteNote,
  linkNote,
  restoreCard,
  restoreNote,
  unlinkNote,
  updateCard,
  updateNote,
} from './index'

// Версии для разбора конфликтов должны расти при каждой настоящей правке на устройстве и не расти без неё
beforeEach(async () => {
  await db.delete()
  await db.open()
  await db.settings.put({ key: 'deviceId', value: 'dev-a' })
})

const useDevice = (id: string) => db.settings.put({ key: 'deviceId', value: id })

describe('записи', () => {
  it('новая запись получает одну правку своего устройства', async () => {
    const note = await createNote('раз')
    expect(note.clock).toEqual({ 'dev-a': 1 })
  })

  it('каждая правка, удаление и возвращение прибавляют единицу', async () => {
    const note = await createNote('раз')
    await updateNote(note.id, { text: 'два' })
    expect((await db.notes.get(note.id))?.clock).toEqual({ 'dev-a': 2 })
    await deleteNote(note.id)
    expect((await db.notes.get(note.id))?.clock).toEqual({ 'dev-a': 3 })
    await restoreNote(note.id)
    expect((await db.notes.get(note.id))?.clock).toEqual({ 'dev-a': 4 })
  })

  it('пустая правка версии не меняет', async () => {
    const note = await createNote('раз')
    await updateNote(note.id, {})
    expect((await db.notes.get(note.id))?.clock).toEqual({ 'dev-a': 1 })
  })

  it('правка с другого устройства добавляет его в версии и сохраняет прежние', async () => {
    const note = await createNote('раз')
    await useDevice('dev-b')
    await updateNote(note.id, { text: 'два' })
    expect((await db.notes.get(note.id))?.clock).toEqual({ 'dev-a': 1, 'dev-b': 1 })
  })

  it('у старой записи без версий первая правка начинает их', async () => {
    const note = await createNote('старая')
    await db.notes.put({ ...note, clock: undefined })
    await updateNote(note.id, { text: 'новая' })
    expect((await db.notes.get(note.id))?.clock).toEqual({ 'dev-a': 1 })
  })
})

describe('карточки и связи', () => {
  it('карточка: создание, правка, удаление и возвращение', async () => {
    const card = await createCard({ kind: 'person', name: 'А' })
    expect(card.clock).toEqual({ 'dev-a': 1 })
    await updateCard(card.id, { name: 'Б' })
    expect((await db.cards.get(card.id))?.clock).toEqual({ 'dev-a': 2 })
    await deleteCard(card.id)
    expect((await db.cards.get(card.id))?.clock).toEqual({ 'dev-a': 3 })
    await restoreCard(card.id)
    expect((await db.cards.get(card.id))?.clock).toEqual({ 'dev-a': 4 })
  })

  it('пустая правка карточки версии не меняет', async () => {
    const card = await createCard({ kind: 'person', name: 'А' })
    await updateCard(card.id, {})
    expect((await db.cards.get(card.id))?.clock).toEqual({ 'dev-a': 1 })
  })

  it('связь: создание, смена роли, снятие и возвращение', async () => {
    const note = await createNote('раз')
    const card = await createCard({ kind: 'person', name: 'А' })
    await linkNote(note.id, card.id, 'with')
    const clock = async () => (await db.links.toArray())[0].clock
    expect(await clock()).toEqual({ 'dev-a': 1 })
    await linkNote(note.id, card.id, 'with') // ничего не изменилось
    expect(await clock()).toEqual({ 'dev-a': 1 })
    await linkNote(note.id, card.id, 'mentioned')
    expect(await clock()).toEqual({ 'dev-a': 2 })
    await unlinkNote(note.id, card.id)
    expect(await clock()).toEqual({ 'dev-a': 3 })
    await linkNote(note.id, card.id)
    expect(await clock()).toEqual({ 'dev-a': 4 })
  })

  it('удаление карточки прибавляет единицу и её связям', async () => {
    const note = await createNote('раз')
    const card = await createCard({ kind: 'person', name: 'А' })
    await linkNote(note.id, card.id)
    await deleteCard(card.id)
    expect((await db.links.toArray())[0].clock).toEqual({ 'dev-a': 2 })
  })
})

describe('дополнение записи', () => {
  it('запись, новые карточки и связи получают версии, неизменённое нет', async () => {
    const note = await createNote('раз')
    const keep = await createCard({ kind: 'person', name: 'Остаётся' })
    const drop = await createCard({ kind: 'person', name: 'Уходит' })
    await linkNote(note.id, keep.id, 'with')
    await linkNote(note.id, drop.id)
    await useDevice('dev-b')
    const { createdCards } = await completeNote(note.id, {
      text: 'два',
      newCards: [{ kind: 'place', name: 'Новое' }],
      links: [{ cardId: keep.id, role: 'with' }, { newCard: 0 }],
    })
    expect((await db.notes.get(note.id))?.clock).toEqual({ 'dev-a': 1, 'dev-b': 1 })
    expect(createdCards[0].clock).toEqual({ 'dev-b': 1 })
    const links = await db.links.toArray()
    const of = (cardId: string) => links.find((l) => l.cardId === cardId)!
    expect(of(keep.id).clock).toEqual({ 'dev-a': 1 }) // не менялась
    expect(of(drop.id).clock).toEqual({ 'dev-a': 1, 'dev-b': 1 }) // отвязана
    expect(of(createdCards[0].id).clock).toEqual({ 'dev-b': 1 }) // новая
  })
})
