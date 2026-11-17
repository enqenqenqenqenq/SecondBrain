import type { Card, Link, Note } from '../storage'

// Синхронизируются записи, карточки и связи. Задачи и теги добавятся вместе со своими экранами.
export type SyncObject =
  { entity: 'note'; data: Note } | { entity: 'card'; data: Card } | { entity: 'link'; data: Link }

export type Entity = SyncObject['entity']

// Файл на Диске. Содержимое всегда текст.
export interface RemoteFile {
  id: string
  name: string
}

// Хранилище на другой стороне. Диск скрыт за четырьмя действиями, поэтому движок проверяется без Google.
export interface RemoteStore {
  list(): Promise<RemoteFile[]>
  read(id: string): Promise<string>
  create(name: string, content: string): Promise<RemoteFile>
  delete(id: string): Promise<void>
}

// Что движок помнит между кругами. Хранится на этом устройстве и на Диск не уходит.
export interface SyncMeta {
  counter: number // номер последнего своего сегмента
  cursor: Record<string, number> // для каждого чужого устройства номер последнего разобранного сегмента
  snapshots: string[] // имена уже применённых снимков
  covers: Record<string, number> // что покрывает самый новый известный снимок
  coversAt: number // время этого снимка
  lastAt: number | null // когда круг последний раз закончился успешно
  lastSnapshotAt: number | null // когда снимок последний раз делали мы
  cleanedWith: string | null // каким снимком уже убирали старые файлы
}

export const emptyMeta = (): SyncMeta => ({
  counter: 0,
  cursor: {},
  snapshots: [],
  covers: {},
  coversAt: 0,
  lastAt: null,
  lastSnapshotAt: null,
  cleanedWith: null,
})

export interface ApplyReport {
  applied: number // записано как есть или объединено
  skipped: number // уже было или старее
  conflicts: number // независимые правки, версии объединены, проигравшая сохранена копией
  invalid: number // повреждённые объекты, пропущены
}

// Местные данные. Движок видит только этот набор действий, поэтому проверяется без базы.
export interface LocalStore {
  deviceId(): Promise<string>
  // Объекты, которые ещё не отправлены (rev больше номера, согласованного с Диском)
  collectDirty(): Promise<SyncObject[]>
  // Отправленное считается согласованным. Вызывается только после успешной загрузки на Диск.
  markSynced(objects: SyncObject[]): Promise<void>
  // Все объекты вместе с удалёнными: для снимка
  allObjects(): Promise<SyncObject[]>
  // Применяет пришедшие объекты по правилам слияния
  applyRemote(objects: SyncObject[]): Promise<ApplyReport>
  loadMeta(): Promise<SyncMeta>
  saveMeta(meta: SyncMeta): Promise<void>
}

export type FileKind = 'segment' | 'snapshot'

// Содержимое файла после расшифровки
export interface Payload {
  kind: FileKind
  deviceId: string
  // номер сегмента или время снимка
  seq: number
  createdAt: number
  objects: SyncObject[]
  // только у снимка: для каждого устройства наибольший учтённый номер сегмента
  covers?: Record<string, number>
  // сколько объектов в файле оказались повреждены и пропущены
  invalid: number
}

// Шифр и сжатие файлов. Движок про ключ ничего не знает.
export interface Codec {
  encode(name: string, payload: Omit<Payload, 'invalid'>): Promise<string>
  decode(name: string, content: string): Promise<Payload>
}
