import { useSyncExternalStore } from 'react'
import { createVault, openVault } from '../crypto/vault'
import { db } from '../storage/db'
import { createController, defaultConfig } from './controller'
import type { Config, ConfigStore, Controller, SyncState } from './controller'
import { driveStore } from './drive'
import { googleAuth } from './google'
import type { Auth } from './google'
import { dexieLocalStore, forgetSyncState } from './localStore'

// Настройки синхронизации и запомненный ключ лежат в таблице настроек этого устройства.
// Ни то, ни другое в копию данных и на Диск не попадает.
const configStore: ConfigStore = {
  async load() {
    const row = await db.settings.get('syncConfig')
    return { ...defaultConfig(), ...((row?.value as Partial<Config> | undefined) ?? {}) }
  },
  async save(config) {
    await db.settings.put({ key: 'syncConfig', value: config })
  },
  async loadKey() {
    const row = await db.settings.get('syncKey')
    return typeof CryptoKey !== 'undefined' && row?.value instanceof CryptoKey ? row.value : null
  },
  async saveKey(key) {
    try {
      if (key) await db.settings.put({ key: 'syncKey', value: key })
      else await db.settings.delete('syncKey')
      return true
    } catch {
      // например приватный режим: ключ не запомнился, пароль будет нужен при каждом запуске
      return false
    }
  },
}

// При разработке можно подменить Диск локальным сервером (localStorage sbFakeDrive), чтобы проверять
// обмен двух устройств без Google. В выложенной сборке этой ветки нет.
function developmentRemote() {
  if (!import.meta.env.DEV) return null
  const base = localStorage.getItem('sbFakeDrive')
  if (!base) return null
  const auth: Auth = {
    token: async () => 'dev-token',
    hasToken: () => true,
    refresh: async () => 'dev-token',
    signOut: async () => {},
  }
  return {
    auth,
    remote: driveStore({ token: () => auth.token(false), apiBase: base, delays: [0, 0] }),
  }
}

function connect() {
  const fake = developmentRemote()
  if (fake) return fake
  const auth = googleAuth()
  return {
    auth,
    remote: driveStore({ token: () => auth.token(false), refresh: () => auth.refresh() }),
  }
}

export const sync: Controller = createController({
  local: dexieLocalStore(),
  config: configStore,
  connect,
  vault: {
    create: (password) => createVault(password),
    open: (meta, password) => openVault(meta, password),
  },
  forgetSyncState,
})

let started = false

// Запускается один раз при открытии приложения: круг сразу, потом при возврате на вкладку, при появлении
// сети и после изменений данных (через минуту после последнего).
export function startSync() {
  if (started) return
  started = true
  // Хуки Dexie работают внутри транзакции записи: обращаться к базе оттуда нельзя, поэтому выходим из неё через таймер
  // Хук срабатывает на каждый объект, а загрузка файла пишет тысячи объектов сразу: сообщаем один раз за ход
  let scheduled = false
  const notify = () => {
    if (scheduled) return
    scheduled = true
    setTimeout(() => {
      scheduled = false
      sync.notifyLocalChange()
    }, 0)
  }
  for (const table of [db.notes, db.cards, db.links]) {
    table.hook('creating', () => {
      notify()
    })
    table.hook('updating', () => {
      notify()
    })
    table.hook('deleting', () => {
      notify()
    })
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync.syncNow()
  })
  window.addEventListener('online', () => void sync.syncNow())
  void sync.start()
}

export function useSync(): SyncState {
  return useSyncExternalStore(sync.subscribe, sync.getState)
}
