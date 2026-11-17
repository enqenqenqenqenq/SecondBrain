export type Precision = 'minute' | 'day' | 'month' | 'season' | 'year' | 'range'

// Время события: период от from до to, строки вида 2024-06-01T00:00
export interface EventTime {
  precision: Precision
  from: string
  to: string
}

export interface Note {
  id: string
  text: string
  event: EventTime
  timeIsAuto: boolean
  reviewedAt: number | null
  tagIds: string[]
  createdAt: number
  updatedAt: number
  rev: number
  deviceId: string
  deletedAt: number | null
}

export interface NotePatch {
  text?: string
  event?: EventTime
  tagIds?: string[]
  reviewedAt?: number | null
}

export type CardKind = 'person' | 'place'

// День рождения: год может быть неизвестен
export interface Birthday {
  month: number
  day: number
  year?: number
}

// Строка анкеты: свободная пара, поэтому новые вопросы не меняют схему
export interface Fact {
  label: string
  value: string
}

// Карточка человека или места. Поля birthday и facts только у человека, address только у места
export interface Card {
  id: string
  kind: CardKind
  name: string
  aliases: string[]
  description: string
  birthday: Birthday | null
  facts: Fact[]
  address: string
  mergedInto: string | null
  createdAt: number
  updatedAt: number
  rev: number
  deviceId: string
  deletedAt: number | null
}

export interface NewCard {
  kind: CardKind
  name: string
  aliases?: string[]
  description?: string
  birthday?: Birthday | null
  facts?: Fact[]
  address?: string
}

export interface CardPatch {
  name?: string
  aliases?: string[]
  description?: string
  birthday?: Birthday | null
  facts?: Fact[]
  address?: string
}

// with значит «был со мной», mentioned значит «упомянут». Для места роли нет
export type LinkRole = 'with' | 'mentioned'

// Связь записи (позже и задачи) с карточкой
export interface Link {
  id: string
  ownerType: 'note' | 'task'
  ownerId: string
  cardId: string
  role: LinkRole | null
  createdAt: number
  updatedAt: number
  rev: number
  deviceId: string
  deletedAt: number | null
}

export interface ListOptions {
  limit?: number
  offset?: number
}
