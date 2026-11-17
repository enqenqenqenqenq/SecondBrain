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

export interface ListOptions {
  limit?: number
  offset?: number
}
