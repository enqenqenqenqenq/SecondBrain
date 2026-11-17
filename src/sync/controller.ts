import { VaultError } from '../crypto/vault'
import type { VaultMeta } from '../crypto/vault'
import { DriveError } from './drive'
import { runSync, resendAll } from './engine'
import type { SyncProblem, SyncResult } from './engine'
import { META_NAME, makeCodec } from './format'
import { AuthError } from './google'
import type { Auth } from './google'
import type { ApplyReport, LocalStore, RemoteFile, RemoteStore, SyncObject } from './types'

// Управление синхронизацией: подключение, пароль, запуск кругов, состояние для экрана. Всё внешнее (Диск, вход,
// база, часы, таймеры) передаётся снаружи, поэтому логика проверяется без Google и без браузера.

export interface Config {
  enabled: boolean
  salt: string | null // соль хранилища, с которым подключились: по ней видно, что хранилище создали заново
  metaFileId: string | null
  remember: boolean // запоминать ли ключ на этом устройстве
}

export const defaultConfig = (): Config => ({
  enabled: false,
  salt: null,
  metaFileId: null,
  remember: true,
})

export interface ConfigStore {
  load(): Promise<Config>
  save(config: Config): Promise<void>
  loadKey(): Promise<CryptoKey | null>
  // Возвращает false, если запомнить не вышло (например, приватный режим): тогда пароль будет нужен при каждом запуске
  saveKey(key: CryptoKey | null): Promise<boolean>
}

export interface ControllerDeps {
  local: LocalStore
  config: ConfigStore
  connect(): { remote: RemoteStore; auth: Auth }
  vault: {
    create(password: string): Promise<{ meta: VaultMeta; key: CryptoKey }>
    open(meta: unknown, password: string): Promise<CryptoKey>
  }
  forgetSyncState(): Promise<void>
  now?: () => number
  isOnline?: () => boolean
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (id: unknown) => void
}

export type Status =
  | { kind: 'off' } // не подключено
  | { kind: 'idle' } // всё согласовано (время последнего круга в lastAt)
  | { kind: 'syncing' }
  | { kind: 'offline' }
  | { kind: 'signin' } // нужен вход в Google
  | { kind: 'password'; reason: 'locked' | 'changed' } // нужен пароль: ключ не запомнен или хранилище создано заново
  | { kind: 'error'; message: string }

export interface SyncState {
  status: Status
  lastAt: number | null
  pending: number // сколько объектов ждёт отправки
  problems: SyncProblem[] // файлы, которые не удалось прочитать в последнем круге
  remember: boolean
}

export type ConnectStep = { needs: 'create' } | { needs: 'enter' }

const DEBOUNCE_MS = 60_000

class VaultChanged extends Error {}
class VaultMissing extends Error {}

export interface Controller {
  getState(): SyncState
  subscribe(listener: () => void): () => void
  // Подключение в два шага: вход в Google и проверка Диска, потом пароль
  beginConnect(): Promise<ConnectStep>
  finishConnect(password: string, remember: boolean): Promise<void>
  // Снова войти в Google, когда токен потерян
  signIn(): Promise<void>
  // Ввести пароль, когда ключ не запомнен или хранилище создали заново
  unlock(password: string, remember: boolean): Promise<void>
  syncNow(reason?: string): Promise<void>
  // Изменение местных данных: через минуту после последнего начнётся круг
  notifyLocalChange(): void
  // Отключить: токен и ключ забываются, местные данные остаются
  disconnect(): Promise<void>
  // Удалить файлы приложения на Диске и создать хранилище заново с новым паролем из местных данных
  restartVault(password: string, remember: boolean): Promise<void>
  // Запоминать ли ключ на этом устройстве. Выключение удаляет запомненный ключ, включение возможно, пока ключ открыт.
  setRemember(remember: boolean): Promise<'ok' | 'needs-password' | 'unsupported'>
  // Отправить всё местное заново одним снимком
  resend(): Promise<void>
  // Включается при открытии приложения
  start(): Promise<void>
  stop(): void
}

export function createController(deps: ControllerDeps): Controller {
  const now = deps.now ?? Date.now
  const online =
    deps.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>))

  let state: SyncState = {
    status: { kind: 'off' },
    lastAt: null,
    pending: 0,
    problems: [],
    remember: true,
  }
  const listeners = new Set<() => void>()
  let connection: { remote: RemoteStore; auth: Auth } | null = null
  let key: CryptoKey | null = null
  let running: Promise<void> | null = null
  let timer: unknown = null
  let pendingMeta: { meta: unknown; fileId: string | null } | null = null
  let applying = false
  let stopped = false

  const set = (patch: Partial<SyncState>) => {
    state = { ...state, ...patch }
    for (const l of [...listeners]) l()
  }
  const setStatus = (status: Status) => set({ status })

  const link = () => (connection ??= deps.connect())

  // Местное хранилище, которое помечает, что записи делает сама синхронизация, а не человек
  const guardedLocal: LocalStore = {
    deviceId: () => deps.local.deviceId(),
    collectDirty: () => deps.local.collectDirty(),
    markSynced: (objects) => deps.local.markSynced(objects),
    allObjects: () => deps.local.allObjects(),
    loadMeta: () => deps.local.loadMeta(),
    saveMeta: (meta) => deps.local.saveMeta(meta),
    async applyRemote(objects: SyncObject[]): Promise<ApplyReport> {
      applying = true
      try {
        return await deps.local.applyRemote(objects)
      } finally {
        applying = false
      }
    },
  }

  async function refreshPending() {
    try {
      set({ pending: (await deps.local.collectDirty()).length })
    } catch {
      // число не обязательно
    }
  }

  const remoteOf = () => {
    const { remote } = link()
    return remote
  }

  async function readMeta(files: RemoteFile[]): Promise<{ meta: unknown; fileId: string } | null> {
    const found = files.filter((f) => f.name === META_NAME).sort((a, b) => (a.id < b.id ? -1 : 1))
    if (found.length === 0) return null
    const canonical = found[0]
    let meta: unknown
    try {
      meta = JSON.parse(await remoteOf().read(canonical.id))
    } catch {
      throw new VaultError('bad-meta', 'Файл хранилища повреждён')
    }
    return { meta, fileId: canonical.id }
  }

  // Проверка перед каждым кругом: хранилище то же, что и при подключении
  async function inspect(files: RemoteFile[]) {
    const config = await deps.config.load()
    const meta = files.filter((f) => f.name === META_NAME)
    if (meta.length === 0) {
      if (files.length > 0 || config.salt) throw new VaultMissing('Файл хранилища пропал с Диска')
      return
    }
    const canonical = [...meta].sort((a, b) => (a.id < b.id ? -1 : 1))[0]
    // Файл тот же, что запомнили: читать заново не нужно
    if (config.metaFileId === canonical.id) return
    const read = await readMeta(files)
    const salt = (read?.meta as { salt?: string } | undefined)?.salt
    if (config.salt && salt !== config.salt)
      throw new VaultChanged('Хранилище на Диске создано заново')
    await deps.config.save({ ...config, metaFileId: canonical.id, salt: salt ?? config.salt })
  }

  function failure(error: unknown): Status {
    if (error instanceof VaultChanged) return { kind: 'password', reason: 'changed' }
    if (error instanceof VaultMissing) {
      return {
        kind: 'error',
        message:
          'Файл хранилища пропал с Диска. Отправьте всё заново или создайте хранилище заново.',
      }
    }
    if (error instanceof AuthError || (error instanceof DriveError && error.failure === 'auth'))
      return { kind: 'signin' }
    if (error instanceof DriveError) {
      if (error.failure === 'network') return { kind: 'offline' }
      if (error.failure === 'quota') return { kind: 'error', message: 'На Google Диске нет места.' }
      if (error.failure === 'busy')
        return { kind: 'error', message: 'Google просит подождать. Повторим позже.' }
    }
    if (error instanceof VaultError) {
      if (error.code === 'newer-version')
        return {
          kind: 'error',
          message: 'Хранилище создано более новой версией приложения. Обновите приложение.',
        }
      if (error.code === 'bad-meta') return { kind: 'error', message: error.message }
    }
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : 'Не удалось синхронизировать.',
    }
  }

  async function loadKey(): Promise<CryptoKey | null> {
    if (key) return key
    key = await deps.config.loadKey()
    return key
  }

  async function round(): Promise<void> {
    const config = await deps.config.load()
    if (!config.enabled) {
      setStatus({ kind: 'off' })
      return
    }
    set({ remember: config.remember })
    if (!online()) {
      setStatus({ kind: 'offline' })
      await refreshPending()
      return
    }
    const k = await loadKey()
    if (!k) {
      setStatus({ kind: 'password', reason: 'locked' })
      await refreshPending()
      return
    }
    setStatus({ kind: 'syncing' })
    try {
      const { remote } = link()
      const result: SyncResult = await runSync({
        local: guardedLocal,
        remote,
        codec: makeCodec(k),
        now,
        inspect,
      })
      // Все файлы не расшифровались: чужой пароль или хранилище пересоздано
      const unreadable =
        result.errors.length > 0 &&
        result.errors.every((e) => e.code === 'bad-file') &&
        result.pulled === 0
      if (unreadable) {
        set({ problems: result.errors })
        setStatus({ kind: 'password', reason: 'changed' })
      } else {
        set({ problems: result.errors, lastAt: now() })
        setStatus({ kind: 'idle' })
      }
    } catch (error) {
      setStatus(failure(error))
    }
    await refreshPending()
  }

  function syncNow(): Promise<void> {
    // Один круг за раз: пока идёт круг, новый запрос присоединяется к нему
    running ??= round().finally(() => {
      running = null
    })
    return running
  }

  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  async function open(password: string, meta: unknown, fileId: string | null, remember: boolean) {
    const opened = await deps.vault.open(meta, password)
    await finish(opened, (meta as VaultMeta).salt, fileId, remember)
  }

  async function finish(opened: CryptoKey, salt: string, fileId: string | null, remember: boolean) {
    key = opened
    let saved = false
    if (remember) saved = await deps.config.saveKey(opened)
    else await deps.config.saveKey(null)
    await deps.config.save({ enabled: true, salt, metaFileId: fileId, remember: remember && saved })
    set({ remember: remember && saved })
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async beginConnect() {
      const { remote, auth } = link()
      await auth.token(true)
      const found = await readMeta(await remote.list())
      pendingMeta = found
      return found ? { needs: 'enter' } : { needs: 'create' }
    },

    async finishConnect(password, remember) {
      const { remote } = link()
      if (pendingMeta) {
        await open(password, pendingMeta.meta, pendingMeta.fileId, remember)
      } else {
        const created = await deps.vault.create(password)
        const file = await remote.create(META_NAME, JSON.stringify(created.meta))
        // Если другое устройство создало хранилище одновременно, остаётся то, чей номер файла меньше
        const files = await remote.list()
        const all = files.filter((f) => f.name === META_NAME).sort((a, b) => (a.id < b.id ? -1 : 1))
        if (all.length > 1 && all[0].id !== file.id) {
          await remote.delete(file.id)
          const other = await readMeta(files.filter((f) => f.id !== file.id))
          if (!other) throw new Error('Хранилище не удалось создать')
          await open(password, other.meta, other.fileId, remember)
        } else {
          await finish(created.key, created.meta.salt, file.id, remember)
        }
      }
      pendingMeta = null
      await syncNow()
    },

    async signIn() {
      await link().auth.token(true)
      await syncNow()
    },

    async unlock(password, remember) {
      const { remote } = link()
      await link().auth.token(true)
      const found = await readMeta(await remote.list())
      if (!found) throw new VaultMissing('Файл хранилища пропал с Диска')
      await open(password, found.meta, found.fileId, remember)
      await syncNow()
    },

    syncNow,

    notifyLocalChange() {
      // Запись, сделанная самой синхронизацией, новым кругом не считается
      if (applying || stopped) return
      void refreshPending()
      void deps.config.load().then((config) => {
        if (!config.enabled) return
        cancelTimer()
        timer = setTimer(() => {
          timer = null
          void syncNow()
        }, DEBOUNCE_MS)
      })
    },

    async disconnect() {
      cancelTimer()
      try {
        await connection?.auth.signOut()
      } catch {
        // токен всё равно забыт
      }
      connection = null
      key = null
      pendingMeta = null
      await deps.config.saveKey(null)
      await deps.config.save(defaultConfig())
      await deps.forgetSyncState()
      set({ status: { kind: 'off' }, lastAt: null, problems: [], pending: 0 })
    },

    async restartVault(password, remember) {
      const { remote, auth } = link()
      await auth.token(true)
      // Только файлы приложения: папка скрытая, чужого в ней нет
      for (const file of await remote.list()) await remote.delete(file.id)
      const created = await deps.vault.create(password)
      const file = await remote.create(META_NAME, JSON.stringify(created.meta))
      await deps.forgetSyncState()
      await finish(created.key, created.meta.salt, file.id, remember)
      await syncNow()
    },

    async setRemember(remember) {
      const config = await deps.config.load()
      if (!config.enabled) return 'ok'
      if (!remember) {
        await deps.config.saveKey(null)
        await deps.config.save({ ...config, remember: false })
        set({ remember: false })
        return 'ok'
      }
      const current = key ?? (await deps.config.loadKey())
      if (!current) return 'needs-password'
      if (!(await deps.config.saveKey(current))) return 'unsupported'
      await deps.config.save({ ...config, remember: true })
      set({ remember: true })
      return 'ok'
    },

    async resend() {
      const k = await loadKey()
      if (!k) {
        setStatus({ kind: 'password', reason: 'locked' })
        return
      }
      setStatus({ kind: 'syncing' })
      try {
        await resendAll({ local: guardedLocal, remote: remoteOf(), codec: makeCodec(k), now })
        set({ lastAt: now() })
        setStatus({ kind: 'idle' })
      } catch (error) {
        setStatus(failure(error))
      }
      await refreshPending()
    },

    async start() {
      stopped = false
      const config = await deps.config.load()
      set({ remember: config.remember })
      if (!config.enabled) {
        setStatus({ kind: 'off' })
        return
      }
      await refreshPending()
      await syncNow()
    },

    stop() {
      stopped = true
      cancelTimer()
    },
  }
}
