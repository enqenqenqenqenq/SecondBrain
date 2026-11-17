import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import { idFromKey } from './ids'
import {
  createCard,
  createNote,
  deleteCard,
  getCard,
  isValidBirthday,
  linkNote,
  listCards,
  restoreCard,
  unlinkNote,
  updateCard,
  watchCards,
} from './index'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('создание карточки', () => {
  it('человек получает все обязательные поля', async () => {
    const card = await createCard({ kind: 'person', name: 'Мария' })
    expect(card.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(card).toMatchObject({
      kind: 'person',
      name: 'Мария',
      aliases: [],
      description: '',
      birthday: null,
      facts: [],
      address: '',
      mergedInto: null,
      rev: 1,
      deletedAt: null,
    })
    expect(card.createdAt).toBe(card.updatedAt)
    expect(card.deviceId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('место сохраняется с адресом', async () => {
    const card = await createCard({ kind: 'place', name: 'Библиотека', address: ' Невский 20 ' })
    expect(card.kind).toBe('place')
    expect(card.address).toBe('Невский 20')
  })

  it('человек с прозвищами, описанием, днём рождения и анкетой', async () => {
    const card = await createCard({
      kind: 'person',
      name: ' Мария ',
      aliases: ['Маша', ' Машенька ', 'маша', ''],
      description: ' коллега ',
      birthday: { month: 3, day: 14 },
      facts: [{ label: ' любимый кофе ', value: ' капучино ' }],
    })
    expect(card.name).toBe('Мария')
    expect(card.aliases).toEqual(['Маша', 'Машенька'])
    expect(card.description).toBe('коллега')
    expect(card.birthday).toEqual({ month: 3, day: 14 })
    expect(card.facts).toEqual([{ label: 'любимый кофе', value: 'капучино' }])
  })

  it('пустое имя и неизвестный вид отклоняются', async () => {
    await expect(createCard({ kind: 'person', name: '   ' })).rejects.toThrow('Имя')
    await expect(createCard({ kind: 'thing' as never, name: 'Х' })).rejects.toThrow('вид')
    expect(await db.cards.count()).toBe(0)
  })

  it('поля человека не принимаются у места и наоборот', async () => {
    await expect(
      createCard({ kind: 'place', name: 'Парк', birthday: { month: 1, day: 1 } }),
    ).rejects.toThrow('только у человека')
    await expect(
      createCard({ kind: 'place', name: 'Парк', facts: [{ label: 'а', value: 'б' }] }),
    ).rejects.toThrow('только у человека')
    await expect(createCard({ kind: 'person', name: 'Иван', address: 'улица' })).rejects.toThrow(
      'только у места',
    )
    expect(await db.cards.count()).toBe(0)
  })

  it('одинаковые имена разрешены, это разные люди', async () => {
    const a = await createCard({ kind: 'person', name: 'Иван' })
    const b = await createCard({ kind: 'person', name: 'Иван' })
    expect(a.id).not.toBe(b.id)
    expect(await listCards()).toHaveLength(2)
  })
})

describe('день рождения', () => {
  it('допустимые значения', () => {
    expect(isValidBirthday({ month: 1, day: 31 })).toBe(true)
    expect(isValidBirthday({ month: 12, day: 31, year: 1990 })).toBe(true)
    expect(isValidBirthday({ month: 2, day: 29 })).toBe(true) // без года можно
    expect(isValidBirthday({ month: 2, day: 29, year: 2000 })).toBe(true)
    expect(isValidBirthday({ month: 2, day: 29, year: 2024 })).toBe(true)
  })

  it('невозможные значения', () => {
    expect(isValidBirthday({ month: 2, day: 30 })).toBe(false)
    expect(isValidBirthday({ month: 2, day: 29, year: 2023 })).toBe(false)
    expect(isValidBirthday({ month: 2, day: 29, year: 1900 })).toBe(false) // 1900 не високосный
    expect(isValidBirthday({ month: 4, day: 31 })).toBe(false)
    expect(isValidBirthday({ month: 0, day: 1 })).toBe(false)
    expect(isValidBirthday({ month: 13, day: 1 })).toBe(false)
    expect(isValidBirthday({ month: 5, day: 0 })).toBe(false)
    expect(isValidBirthday({ month: 5, day: 1.5 })).toBe(false)
    expect(isValidBirthday({ month: 5, day: 1, year: 0 })).toBe(false)
    expect(isValidBirthday({ month: 5, day: 1, year: 10000 })).toBe(false)
  })

  it('испорченные данные не ломают проверку', () => {
    expect(isValidBirthday(null)).toBe(false)
    expect(isValidBirthday(undefined)).toBe(false)
    expect(isValidBirthday('1 марта')).toBe(false)
    expect(isValidBirthday({})).toBe(false)
    expect(isValidBirthday({ month: '3', day: '14' })).toBe(false)
  })

  it('неверный день рождения не сохраняется', async () => {
    await expect(
      createCard({ kind: 'person', name: 'Иван', birthday: { month: 2, day: 30 } }),
    ).rejects.toThrow('день рождения')
    expect(await db.cards.count()).toBe(0)
  })
})

describe('чтение и список', () => {
  it('getCard возвращает карточку, а неизвестную и удалённую нет', async () => {
    const card = await createCard({ kind: 'person', name: 'Иван' })
    expect((await getCard(card.id))?.name).toBe('Иван')
    expect(await getCard('нет-такой')).toBeUndefined()
    await deleteCard(card.id)
    expect(await getCard(card.id)).toBeUndefined()
  })

  it('список по имени без учёта регистра', async () => {
    await createCard({ kind: 'person', name: 'борис' })
    await createCard({ kind: 'place', name: 'Аптека' })
    await createCard({ kind: 'person', name: 'Артём' })
    await createCard({ kind: 'person', name: 'Андрей' })
    expect((await listCards()).map((c) => c.name)).toEqual(['Андрей', 'Аптека', 'Артём', 'борис'])
  })

  it('фильтр по виду', async () => {
    await createCard({ kind: 'person', name: 'Иван' })
    await createCard({ kind: 'place', name: 'Парк' })
    expect((await listCards({ kind: 'person' })).map((c) => c.name)).toEqual(['Иван'])
    expect((await listCards({ kind: 'place' })).map((c) => c.name)).toEqual(['Парк'])
    expect(await listCards()).toHaveLength(2)
  })

  it('удалённые в списке не видны', async () => {
    const a = await createCard({ kind: 'person', name: 'А' })
    await createCard({ kind: 'person', name: 'Б' })
    await deleteCard(a.id)
    expect((await listCards()).map((c) => c.name)).toEqual(['Б'])
  })
})

describe('изменение', () => {
  it('меняет только указанное и поднимает номер правки', async () => {
    const card = await createCard({
      kind: 'person',
      name: 'Мария',
      description: 'коллега',
      aliases: ['Маша'],
    })
    const changed = await updateCard(card.id, { description: 'подруга' })
    expect(changed).toMatchObject({
      id: card.id,
      name: 'Мария',
      description: 'подруга',
      aliases: ['Маша'],
      rev: 2,
      createdAt: card.createdAt,
    })
    expect(changed!.updatedAt).toBeGreaterThanOrEqual(card.updatedAt)
  })

  it('пустое изменение не создаёт новую правку', async () => {
    const card = await createCard({ kind: 'person', name: 'Мария' })
    const same = await updateCard(card.id, {})
    expect(same?.rev).toBe(1)
    expect((await db.cards.get(card.id))?.rev).toBe(1)
  })

  it('день рождения можно поставить и убрать', async () => {
    const card = await createCard({ kind: 'person', name: 'Мария' })
    expect(
      (await updateCard(card.id, { birthday: { month: 5, day: 9, year: 1990 } }))?.birthday,
    ).toEqual({
      month: 5,
      day: 9,
      year: 1990,
    })
    expect((await updateCard(card.id, { birthday: null }))?.birthday).toBeNull()
  })

  it('анкету и прозвища можно заменить целиком', async () => {
    const card = await createCard({ kind: 'person', name: 'Мария', aliases: ['Маша'] })
    const changed = await updateCard(card.id, {
      aliases: ['Мэри', 'мэри'],
      facts: [{ label: 'город', value: 'Казань' }],
    })
    expect(changed?.aliases).toEqual(['Мэри'])
    expect(changed?.facts).toEqual([{ label: 'город', value: 'Казань' }])
  })

  it('неверное изменение отклоняется и ничего не меняет', async () => {
    const card = await createCard({ kind: 'person', name: 'Мария' })
    await expect(updateCard(card.id, { name: '  ' })).rejects.toThrow('Имя')
    await expect(updateCard(card.id, { birthday: { month: 2, day: 31 } })).rejects.toThrow()
    await expect(updateCard(card.id, { address: 'улица' })).rejects.toThrow('только у места')
    await expect(updateCard(card.id, { facts: [{ label: 'а', value: ' ' }] })).rejects.toThrow(
      'анкеты',
    )
    expect(await db.cards.get(card.id)).toEqual(card)
  })

  it('у места нельзя задать день рождения и анкету', async () => {
    const place = await createCard({ kind: 'place', name: 'Парк' })
    await expect(updateCard(place.id, { birthday: { month: 1, day: 1 } })).rejects.toThrow()
    await expect(updateCard(place.id, { facts: [{ label: 'а', value: 'б' }] })).rejects.toThrow()
    expect((await updateCard(place.id, { address: 'Лесная 1' }))?.address).toBe('Лесная 1')
  })

  it('неизвестная и удалённая карточка не изменяются', async () => {
    expect(await updateCard('нет-такой', { name: 'Х' })).toBeUndefined()
    const card = await createCard({ kind: 'person', name: 'Мария' })
    await deleteCard(card.id)
    expect(await updateCard(card.id, { name: 'Х' })).toBeUndefined()
  })
})

describe('удаление и возвращение', () => {
  it('мягкое удаление оставляет карточку в базе', async () => {
    const card = await createCard({ kind: 'person', name: 'Мария' })
    expect(await deleteCard(card.id)).toBe(true)
    const raw = await db.cards.get(card.id)
    expect(raw?.deletedAt).not.toBeNull()
    expect(raw?.rev).toBe(2)
  })

  it('повторное удаление и удаление неизвестной ничего не делают', async () => {
    const card = await createCard({ kind: 'person', name: 'Мария' })
    expect(await deleteCard('нет-такой')).toBe(false)
    expect(await deleteCard(card.id)).toBe(true)
    expect(await deleteCard(card.id)).toBe(false)
    expect((await db.cards.get(card.id))?.rev).toBe(2)
  })

  it('отмена возвращает карточку со всеми полями', async () => {
    const card = await createCard({
      kind: 'person',
      name: 'Мария',
      aliases: ['Маша'],
      birthday: { month: 3, day: 14 },
    })
    await deleteCard(card.id)
    expect(await restoreCard(card.id)).toBe(true)
    expect(await getCard(card.id)).toMatchObject({ name: 'Мария', aliases: ['Маша'], rev: 3 })
    expect(await restoreCard(card.id)).toBe(false)
    expect(await restoreCard('нет-такой')).toBe(false)
  })

  it('удаление убирает связи карточки, а отмена возвращает только их', async () => {
    const note1 = await createNote('раз')
    const note2 = await createNote('два')
    const note3 = await createNote('три')
    const card = await createCard({ kind: 'person', name: 'Мария' })
    await linkNote(note1.id, card.id)
    await linkNote(note2.id, card.id)
    await linkNote(note3.id, card.id)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)
    await unlinkNote(note3.id, card.id) // убрана раньше, отдельно
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000)
    await deleteCard(card.id)
    expect((await db.links.toArray()).filter((l) => l.deletedAt === null)).toHaveLength(0)
    await restoreCard(card.id)
    const alive = (await db.links.toArray()).filter((l) => l.deletedAt === null)
    expect(alive.map((l) => l.ownerId).sort()).toEqual([note1.id, note2.id].sort())
  })
})

describe('слежение', () => {
  it('сообщает список сразу и после каждого изменения', async () => {
    const seen: string[][] = []
    const stop = watchCards((cards) => seen.push(cards.map((c) => c.name)))
    await vi.waitFor(() => expect(seen).toEqual([[]]))
    await createCard({ kind: 'person', name: 'Мария' })
    await vi.waitFor(() => expect(seen.at(-1)).toEqual(['Мария']))
    stop()
    await createCard({ kind: 'person', name: 'Иван' })
    await new Promise((r) => setTimeout(r, 50))
    expect(seen.at(-1)).toEqual(['Мария'])
  })
})

describe('идентификатор из ключа', () => {
  it('один ключ даёт один id, разные ключи разные', async () => {
    expect(await idFromKey('a')).toBe(await idFromKey('a'))
    expect(await idFromKey('a')).not.toBe(await idFromKey('b'))
  })

  it('похож на UUID версии 5', async () => {
    expect(await idFromKey('ключ')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('известный пример не меняется между версиями приложения', async () => {
    // Если этот id изменится, связи с двух устройств перестанут совпадать
    expect(await idFromKey('link:note:n1:c1')).toBe(await idFromKey('link:note:n1:c1'))
    expect(await idFromKey('')).toBe('e3b0c442-98fc-5c14-9afb-f4c8996fb924')
  })
})
