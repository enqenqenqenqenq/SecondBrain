import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createVault } from './crypto/vault'
import {
  completeNote,
  createCard,
  createNote,
  dayEvent,
  deleteNote,
  isUnreviewed,
  listCardFeed,
  listCardsOfNote,
  markReviewed,
  minuteEvent,
  monthEvent,
  restoreNote,
  watchCardStats,
} from './storage'
import type { CardStats } from './storage'
import { db } from './storage/db'
import { filterNotes } from './feedFilters'
import { foldedFor, parseQuery } from './search'
import { runSync } from './sync/engine'
import { makeCodec } from './sync/format'
import { MemoryLocal, MemoryRemote, currentTime } from './sync/testing'
import type { Codec } from './sync/types'

// Сквозные проверки главных пользовательских сценариев (SB-95 / Требование ФТ-Синхронизация, Лекция 5):
// 1. Быстрая мысль -> Поиск в ленте -> Привязка к человеку и месту -> Проверка в досье.
// 2. Разбор неразобранного (Inbox Zero): фильтр, пошаговое дополнение, уменьшение очереди.
// 3. Сквозная синхронизация двух устройств (Телефон и ПК), обнаружение и слияние конфликта.

let sharedCodec: Codec

beforeAll(async () => {
  const vault = await createVault('пароль для сквозных проверок', 1000)
  sharedCodec = makeCodec(vault.key)
})

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('Сценарий 1: Записать мысль -> найти в ленте -> привязать к человеку и месту -> увидеть в досье', () => {
  it('полный путь заметки от быстрого ввода до карточек досье', async () => {
    // 1. Быстрая мысль: пользователь на бегу записывает текст без структуры
    const rawText =
      'Встретились с Анной в Кофейне на Арбате обсудить запуск веб-версии и сроки сдачи проекта'
    const note = await createNote(rawText)

    expect(note.id).toBeDefined()
    expect(note.text).toBe(rawText)
    expect(note.timeIsAuto).toBe(true)
    expect(note.reviewedAt).toBeNull()
    expect(isUnreviewed(note)).toBe(true)

    // Создаём фоновые заметки для проверки точности поиска
    await createNote('Купить молоко и хлеб по дороге домой')
    await createNote('Встреча с Олегом по серверной инфраструктуре')

    const allNotes = await db.notes.filter((n) => n.deletedAt === null).toArray()
    expect(allNotes.length).toBe(3)

    // 2. Поиск в ленте: пользователь ищет заметку по ключевым словам
    const query = parseQuery('Анн Кофейн Арбат')
    const found = filterNotes(
      allNotes,
      { words: query, unreviewed: false, period: null, linked: [] },
      (n) => foldedFor(n.id, n.rev, n.text),
    )

    expect(found.length).toBe(1)
    expect(found[0].id).toBe(note.id)
    expect(found[0].text).toContain('Анной')

    // 3. Разбор и связывание: создаём карточки человека и места
    const person = await createCard({ name: 'Анна Смирнова', kind: 'person' })
    const place = await createCard({ name: 'Кофейня на Арбате', kind: 'place' })

    expect(person.kind).toBe('person')
    expect(place.kind).toBe('place')

    // Дополняем заметку: привязываем Анну (роль 'with'), Кофейню и ставим точное время
    const eventTime = minuteEvent(2026, 11, 21, 15, 30)
    const { note: completed } = await completeNote(note.id, {
      text: note.text,
      event: eventTime,
      links: [
        { cardId: person.id, role: 'with' },
        { cardId: place.id, role: null },
      ],
    })

    // Помечаем как разобранную
    const reviewed = await markReviewed(completed.id)
    expect(reviewed).toBeDefined()
    if (reviewed) {
      expect(reviewed.reviewedAt).not.toBeNull()
      expect(isUnreviewed(reviewed)).toBe(false)
      expect(reviewed.timeIsAuto).toBe(false)
    }

    // Проверяем карточки, привязанные к заметке
    const attachedCards = await listCardsOfNote(note.id)
    expect(attachedCards.length).toBe(2)
    expect(attachedCards.some((c) => c.card.id === person.id && c.role === 'with')).toBe(true)
    expect(attachedCards.some((c) => c.card.id === place.id && c.role === null)).toBe(true)

    // 4. Проверка в досье: открываем персональную ленту Анны
    const personFeed = await listCardFeed(person.id)
    expect(personFeed.length).toBe(1)
    expect(personFeed[0].note.id).toBe(note.id)
    expect(personFeed[0].role).toBe('with')

    // Проверяем персональную ленту Кофейни
    const placeFeed = await listCardFeed(place.id)
    expect(placeFeed.length).toBe(1)
    expect(placeFeed[0].note.id).toBe(note.id)

    // Проверяем статистику карточки
    let statsMap: Map<string, CardStats> | null = null
    const unsub = watchCardStats((s) => {
      statsMap = s
    })
    await new Promise((r) => setTimeout(r, 60))
    unsub()

    expect(statsMap).not.toBeNull()
    const currentStats: Map<string, CardStats> = statsMap ?? new Map()
    const annaStats = currentStats.get(person.id)
    expect(annaStats).toBeDefined()
    expect(annaStats?.count).toBe(1)
    expect(annaStats?.last).toEqual(eventTime)
  })
})

describe('Сценарий 2: Разбор неразобранных записей (Inbox Zero) и фильтрация потока', () => {
  it('входящие мысли пошагово разбираются и уходят из фильтра неразобранного', async () => {
    // 1. Накапливаем 4 заметки
    const n1 = await createNote('Идея: добавить экспорт базы в JSON файл')
    const n2 = await createNote('Позвонить Борису по поводу согласования сметы')
    const n3 = await createNote('Купить подарок на день рождения брата')
    const n4 = await createNote('План на завтра', dayEvent(2026, 11, 22))
    await markReviewed(n4.id)

    let all = await db.notes.filter((n) => n.deletedAt === null).toArray()
    expect(all.length).toBe(4)

    // 2. Проверяем фильтр «Неразобранные»
    const unreviewedOnly = filterNotes(
      all,
      { words: [], unreviewed: true, period: null, linked: [] },
      (n) => foldedFor(n.id, n.rev, n.text),
    )
    expect(unreviewedOnly.length).toBe(3)
    const unreviewedIds = new Set(unreviewedOnly.map((n) => n.id))
    expect(unreviewedIds.has(n1.id)).toBe(true)
    expect(unreviewedIds.has(n2.id)).toBe(true)
    expect(unreviewedIds.has(n3.id)).toBe(true)
    expect(unreviewedIds.has(n4.id)).toBe(false)

    // 3. Пошаговый разбор:
    // Разбираем n1: задаём нечёткий срок (ноябрь 2026) и отмечаем разобранной
    await completeNote(n1.id, { event: monthEvent(2026, 11), links: [] })
    await markReviewed(n1.id)

    // Разбираем n2: связываем с человеком Борисом
    const boris = await createCard({ name: 'Борис Инженер', kind: 'person' })
    await completeNote(n2.id, { links: [{ cardId: boris.id, role: 'with' }] })
    await markReviewed(n2.id)

    // Заметку n3 удаляем, затем восстанавливаем
    await deleteNote(n3.id)
    all = await db.notes.filter((n) => n.deletedAt === null).toArray()
    expect(all.length).toBe(3)

    await restoreNote(n3.id)
    all = await db.notes.filter((n) => n.deletedAt === null).toArray()
    expect(all.length).toBe(4)

    // 4. Проверяем остаток в фильтре «Неразобранные»: осталась только n3
    const unreviewedAfter = filterNotes(
      all,
      { words: [], unreviewed: true, period: null, linked: [] },
      (n) => foldedFor(n.id, n.rev, n.text),
    )
    expect(unreviewedAfter.length).toBe(1)
    expect(unreviewedAfter[0].id).toBe(n3.id)

    // В досье Бориса заметка n2 на месте
    const borisFeed = await listCardFeed(boris.id)
    expect(borisFeed.length).toBe(1)
    expect(borisFeed[0].note.id).toBe(n2.id)
  })
})

describe('Сценарий 3: Сквозная синхронизация, слияние и разрешение конфликтов между устройствами', () => {
  it('обмен зашифрованными данными между Телефоном и ПК с безопасным разбором конфликта', async () => {
    const remote = new MemoryRemote()
    const phone = new MemoryLocal('device-phone')
    const pc = new MemoryLocal('device-pc')

    const syncDevice = (device: MemoryLocal) =>
      runSync({ local: device, remote, codec: sharedCodec, now: currentTime })

    // 1. На телефоне создаётся заметка и карточка человека, они связываются
    const noteId = 'note-arch-1'
    const cardId = 'card-mikhail-1'
    const linkId = 'link-arch-mikhail'
    phone.addNote(noteId, 'Архитектурный план: ядро хранения и PWA')
    phone.addCard(cardId, 'Михаил Архитектор')
    phone.addLink(linkId, noteId, cardId)

    expect(phone.notes.get(noteId)?.text).toBe('Архитектурный план: ядро хранения и PWA')

    // 2. Телефон синхронизируется: данные шифруются и попадают на Диск
    const repPhone1 = await syncDevice(phone)
    expect(repPhone1.pushed).toBeGreaterThan(0)
    expect(remote.files.size).toBeGreaterThan(0)

    // ПК синхронизируется: скачивает зашифрованные файлы и применяет
    const repPc1 = await syncDevice(pc)
    expect(repPc1.pulled).toBeGreaterThan(0)
    expect(repPc1.applied).toBeGreaterThan(0)

    // На ПК данные полностью совпадают с телефоном
    expect(pc.notes.get(noteId)?.text).toBe('Архитектурный план: ядро хранения и PWA')
    expect(pc.cards.get(cardId)?.name).toBe('Михаил Архитектор')
    expect(pc.links.get(linkId)?.cardId).toBe(cardId)

    // 3. Конфликт в офлайне: оба устройства редактируют ту же заметку независимо
    phone.editNote(noteId, {
      text: 'Архитектурный план: ядро хранения, PWA и синхронизация Google',
    })
    pc.editNote(noteId, { text: 'Архитектурный план: ядро хранения, PWA и шифрование Web Crypto' })

    // 4. Выход в сеть и синхронизация: телефон отправляет свои правки
    await syncDevice(phone)

    // ПК скачивает правки телефона и отправляет свои: движок регистрирует конфликт
    const repPc2 = await syncDevice(pc)
    expect(repPc2.conflicts).toBe(1)

    // Телефон скачивает обновления
    await syncDevice(phone)

    // 5. Проверка сохранности данных: обе версии сохранены без потерь
    const pcNotes = [...pc.notes.values()].filter((n) => n.deletedAt === null)
    expect(pcNotes.length).toBe(2)

    const mainNote = pc.notes.get(noteId)
    const conflictCopy = pcNotes.find((n) => n.conflictOf === noteId)

    expect(mainNote).toBeDefined()
    expect(conflictCopy).toBeDefined()
    expect(conflictCopy?.conflictOf).toBe(noteId)

    const texts = [mainNote?.text, conflictCopy?.text]
    expect(texts).toContain('Архитектурный план: ядро хранения, PWA и синхронизация Google')
    expect(texts).toContain('Архитектурный план: ядро хранения, PWA и шифрование Web Crypto')

    // Телефон также видит обе версии
    await syncDevice(phone)
    const phoneNotes = [...phone.notes.values()].filter((n) => n.deletedAt === null)
    expect(phoneNotes.length).toBe(2)
    expect(phoneNotes.some((n) => n.conflictOf === noteId)).toBe(true)

    // 6. Разрешение конфликта: объединяем финальный текст и удаляем копию конфликта
    if (conflictCopy) {
      pc.editNote(noteId, {
        text: 'Архитектурный план: ядро хранения, PWA, синхронизация Google и шифрование Web Crypto',
      })
      pc.removeNote(conflictCopy.id)

      await syncDevice(pc)
      await syncDevice(phone)

      expect(phone.notes.get(noteId)?.text).toBe(
        'Архитектурный план: ядро хранения, PWA, синхронизация Google и шифрование Web Crypto',
      )
      expect(pc.notes.get(noteId)?.text).toBe(
        'Архитектурный план: ядро хранения, PWA, синхронизация Google и шифрование Web Crypto',
      )
      expect(phone.notes.get(conflictCopy.id)?.deletedAt).not.toBeNull()
      expect(pc.notes.get(conflictCopy.id)?.deletedAt).not.toBeNull()
    }
  })
})
