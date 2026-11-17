import { describe, expect, it } from 'vitest'
import { VaultError, createVault, openVault } from '../crypto/vault'
import { defaultConfig, createController } from './controller'
import type { Config, ConfigStore, Controller } from './controller'
import { DriveError } from './drive'
import { AuthError } from './google'
import type { Auth } from './google'
import { MemoryLocal, MemoryRemote, currentTime } from './testing'
import type { LocalStore, RemoteStore } from './types'

const FAST = 1000

class MemoryConfig implements ConfigStore {
  config: Config = defaultConfig()
  key: CryptoKey | null = null
  keyAllowed = true
  async load() {
    return { ...this.config }
  }
  async save(config: Config) {
    this.config = { ...config }
  }
  async loadKey() {
    return this.key
  }
  async saveKey(key: CryptoKey | null) {
    if (key && !this.keyAllowed) return false
    this.key = key
    return true
  }
}

class FakeAuth implements Auth {
  signedIn = false
  interactiveCalls = 0
  silentFails = false
  signedOut = false
  async token(interactive: boolean) {
    if (interactive) {
      this.interactiveCalls++
      this.signedIn = true
      return 'токен'
    }
    if (!this.signedIn || this.silentFails) throw new AuthError('timeout', 'Google не ответил')
    return 'токен'
  }
  hasToken() {
    return this.signedIn
  }
  async refresh() {
    return this.token(false)
  }
  async signOut() {
    this.signedIn = false
    this.signedOut = true
  }
}

interface Rig {
  controller: Controller
  config: MemoryConfig
  auth: FakeAuth
  local: MemoryLocal
  timers: { fn: () => void; ms: number; cleared: boolean }[]
  online: { value: boolean }
  forgot: { count: number }
}

function rig(
  remote: RemoteStore,
  id: string,
  shared?: { config?: MemoryConfig; local?: MemoryLocal; auth?: FakeAuth },
): Rig {
  const config = shared?.config ?? new MemoryConfig()
  const auth = shared?.auth ?? new FakeAuth()
  const local = shared?.local ?? new MemoryLocal(id)
  const timers: Rig['timers'] = []
  const online = { value: true }
  const forgot = { count: 0 }
  const controller = createController({
    local,
    config,
    connect: () => ({ remote, auth }),
    vault: {
      create: (password) => createVault(password, FAST),
      open: (meta, password) => openVault(meta, password, FAST),
    },
    forgetSyncState: async () => {
      forgot.count++
      local.synced.clear()
      local.meta = (await import('./types')).emptyMeta()
    },
    now: currentTime,
    isOnline: () => online.value,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false }
      timers.push(t)
      return t
    },
    clearTimer: (t) => {
      ;(t as { cleared: boolean }).cleared = true
    },
  })
  return { controller, config, auth, local, timers, online, forgot }
}

const status = (r: Rig) => {
  const st = r.controller.getState().status
  return st.kind === 'error' ? `error: ${st.message}` : st.kind
}
const connect = async (r: Rig, password = 'общий пароль', remember = true) => {
  const step = await r.controller.beginConnect()
  await r.controller.finishConnect(password, remember)
  return step
}
const code = async (p: Promise<unknown>) => {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof VaultError ? e.code : `другая ошибка: ${String(e)}`
  }
}

describe('подключение первого устройства', () => {
  it('без подключения состояние «выключено» и ничего не происходит', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    await r.controller.start()
    expect(status(r)).toBe('off')
    expect(remote.calls.list).toBe(0)
  })

  it('пустой Диск: нужно создать пароль, хранилище создаётся и данные уходят снимком', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    r.local.addNote('n1', 'раз')
    const step = await connect(r)
    expect(step).toEqual({ needs: 'create' })
    expect(r.auth.interactiveCalls).toBe(1)
    expect(remote.names()).toContain('meta.json')
    expect(remote.names().some((n) => n.startsWith('snap-'))).toBe(true)
    expect(status(r)).toBe('idle')
    expect(r.controller.getState().lastAt).not.toBeNull()
    expect(r.controller.getState().pending).toBe(0)
    expect(r.config.config).toMatchObject({ enabled: true, remember: true })
    expect(r.config.key).not.toBeNull()
  })

  it('открытый файл на Диске не содержит пароля и ключа', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    await connect(r, 'секретнейший пароль')
    const meta = remote.files.get(remote.idOf('meta.json'))!.content
    expect(meta).not.toContain('секретнейший')
  })

  it('не запоминать ключ: настройка сохраняется, ключа на устройстве нет', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    await connect(r, 'общий пароль', false)
    expect(r.config.key).toBeNull()
    expect(r.config.config.remember).toBe(false)
    expect(status(r)).toBe('idle')
  })

  it('браузер не позволил запомнить ключ: работает до перезапуска, дальше спросит пароль', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    r.config.keyAllowed = false
    await connect(r)
    expect(r.controller.getState().remember).toBe(false)
    expect(status(r)).toBe('idle')
    // после перезапуска приложения (новый контроллер, тот же сохранённый)
    const again = rig(remote, 'a', { config: r.config, local: r.local, auth: r.auth })
    await again.controller.start()
    expect(status(again)).toBe('password')
  })
})

describe('подключение второго устройства и пароль', () => {
  it('Диск не пуст: нужен пароль, неверный отклоняется и ничего не сохраняется', async () => {
    const remote = new MemoryRemote()
    const a = rig(remote, 'a')
    a.local.addNote('n1', 'с первого')
    await connect(a)
    const b = rig(remote, 'b')
    expect(await b.controller.beginConnect()).toEqual({ needs: 'enter' })
    expect(await code(b.controller.finishConnect('другой пароль', true))).toBe('wrong-password')
    expect(b.config.config.enabled).toBe(false)
    expect(b.config.key).toBeNull()
    expect(b.local.notes.size).toBe(0)
  })

  it('верный пароль: данные приходят, ничего лишнего не отправляется', async () => {
    const remote = new MemoryRemote()
    const a = rig(remote, 'a')
    a.local.addNote('n1', 'с первого')
    await connect(a)
    const before = remote.names().length
    const b = rig(remote, 'b')
    await connect(b)
    expect(b.local.notes.get('n1')?.text).toBe('с первого')
    expect(status(b)).toBe('idle')
    expect(remote.names().length).toBe(before)
  })

  it('после перезапуска с запомненным ключом пароль не нужен', async () => {
    const remote = new MemoryRemote()
    const a = rig(remote, 'a')
    a.local.addNote('n1', 'раз')
    await connect(a)
    a.local.editNote('n1', { text: 'раз, исправлено' })
    const again = rig(remote, 'a', { config: a.config, local: a.local, auth: a.auth })
    await again.controller.start()
    expect(status(again)).toBe('idle')
    const b = rig(remote, 'b')
    await connect(b)
    expect(b.local.notes.get('n1')?.text).toBe('раз, исправлено')
  })

  it('без запомненного ключа после перезапуска нужен пароль, верный открывает, неверный нет', async () => {
    const remote = new MemoryRemote()
    const a = rig(remote, 'a')
    a.local.addNote('n1', 'раз')
    await connect(a, 'общий пароль', false)
    const again = rig(remote, 'a', { config: a.config, local: a.local, auth: a.auth })
    await again.controller.start()
    expect(status(again)).toBe('password')
    expect(again.controller.getState().status).toEqual({ kind: 'password', reason: 'locked' })
    expect(await code(again.controller.unlock('неверный', false))).toBe('wrong-password')
    expect(status(again)).toBe('password')
    await again.controller.unlock('общий пароль', false)
    expect(status(again)).toBe('idle')
  })

  it('одновременное создание хранилища двумя устройствами оставляет одно, оба работают с ним', async () => {
    const remote = new MemoryRemote()
    const a = rig(remote, 'a')
    const b = rig(remote, 'b')
    a.local.addNote('na', 'от первого')
    b.local.addNote('nb', 'от второго')
    expect(await a.controller.beginConnect()).toEqual({ needs: 'create' })
    expect(await b.controller.beginConnect()).toEqual({ needs: 'create' })
    await a.controller.finishConnect('общий пароль', true)
    await b.controller.finishConnect('общий пароль', true)
    expect(remote.names().filter((n) => n === 'meta.json')).toHaveLength(1)
    await a.controller.syncNow()
    await b.controller.syncNow()
    await a.controller.syncNow()
    expect(
      a.local
        .alive()
        .map((n) => n.text)
        .sort(),
    ).toEqual(['от второго', 'от первого'])
    expect(
      b.local
        .alive()
        .map((n) => n.text)
        .sort(),
    ).toEqual(['от второго', 'от первого'])
  })
})

describe('состояния и ошибки', () => {
  it('нет сети: «нет связи», Диск не трогаем, после возвращения всё доходит', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    r.local.addNote('n1', 'раз')
    await connect(r)
    r.local.editNote('n1', { text: 'без сети' })
    r.online.value = false
    const calls = remote.calls.list
    await r.controller.syncNow()
    expect(status(r)).toBe('offline')
    expect(remote.calls.list).toBe(calls)
    expect(r.controller.getState().pending).toBe(1)
    r.online.value = true
    await r.controller.syncNow()
    expect(status(r)).toBe('idle')
    expect(r.controller.getState().pending).toBe(0)
  })

  it('потеря входа: «нужен вход», правки копятся, после входа уходят', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    r.local.addNote('n1', 'раз')
    await connect(r)
    r.local.editNote('n1', { text: 'пока не вошёл' })
    let failing = true
    const original = remote.list.bind(remote)
    remote.list = async () => {
      if (failing) throw new DriveError('auth', 'Диск ответил 401', 401)
      return original()
    }
    await r.controller.syncNow()
    expect(status(r)).toBe('signin')
    expect(r.controller.getState().pending).toBe(1)
    failing = false
    await r.controller.signIn()
    expect(status(r)).toBe('idle')
    expect(r.controller.getState().pending).toBe(0)
  })

  it('отказ тихого входа: «нужен вход»', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    await connect(r)
    remote.list = async () => {
      throw new AuthError('timeout', 'Google не ответил')
    }
    await r.controller.syncNow()
    expect(status(r)).toBe('signin')
  })

  it('сбой сети на запросе: «нет связи». Нет места и просьба подождать: ошибка с понятным текстом', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    await connect(r)
    const original = remote.list.bind(remote)
    remote.list = async () => {
      throw new DriveError('network', 'Нет связи с Диском')
    }
    await r.controller.syncNow()
    expect(status(r)).toBe('offline')
    remote.list = async () => {
      throw new DriveError('quota', 'нет места')
    }
    await r.controller.syncNow()
    expect(r.controller.getState().status).toEqual({
      kind: 'error',
      message: 'На Google Диске нет места.',
    })
    remote.list = async () => {
      throw new DriveError('busy', 'подождите', 429)
    }
    await r.controller.syncNow()
    expect(r.controller.getState().status).toMatchObject({ kind: 'error' })
    remote.list = original
    await r.controller.syncNow()
    expect(status(r)).toBe('idle')
  })

  it('неожиданная ошибка показывается текстом, ничего не теряется', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    r.local.addNote('n1', 'раз')
    await connect(r)
    r.local.editNote('n1', { text: 'правка' })
    remote.fail('create', 1, (n) => n.startsWith('seg-'))
    await r.controller.syncNow()
    expect(r.controller.getState().status).toMatchObject({ kind: 'error' })
    expect(r.controller.getState().pending).toBe(1)
    await r.controller.syncNow()
    expect(status(r)).toBe('idle')
  })

  it('повреждённые файлы сообщаются отдельно, остальное работает', async () => {
    const remote = new MemoryRemote()
    const a = rig(remote, 'a')
    a.local.addNote('n1', 'раз')
    await connect(a)
    const b = rig(remote, 'b')
    await connect(b)
    a.local.editNote('n1', { text: 'правка' })
    await a.controller.syncNow()
    remote.files.get(remote.idOf('seg-a-000001.sb'))!.content = 'это не шифр'
    a.local.editNote('n1', { text: 'ещё правка' })
    await b.controller.syncNow()
    expect(b.controller.getState().problems).toHaveLength(1)
    expect(b.controller.getState().problems[0].code).toBe('bad-file')
    expect(b.local.notes.get('n1')?.text).toBe('раз')
  })
})

describe('хранилище пересоздано, потеряно, заменено', () => {
  it('другое устройство начало хранилище заново: здесь «нужен пароль», новый пароль открывает и данные объединяются', async () => {
    const remote = new MemoryRemote()
    const a = rig(remote, 'a')
    a.local.addNote('na', 'у первого')
    await connect(a, 'старый пароль')
    const b = rig(remote, 'b')
    await connect(b, 'старый пароль')
    b.local.addNote('nb', 'у второго')
    await b.controller.syncNow()
    await a.controller.syncNow()
    // первое устройство начинает заново с новым паролем
    await a.controller.restartVault('новый пароль', true)
    expect(remote.names().filter((n) => n === 'meta.json')).toHaveLength(1)
    // второе видит чужую соль
    await b.controller.syncNow()
    expect(b.controller.getState().status).toEqual({ kind: 'password', reason: 'changed' })
    expect(await code(b.controller.unlock('старый пароль', true))).toBe('wrong-password')
    await b.controller.unlock('новый пароль', true)
    expect(status(b)).toBe('idle')
    await a.controller.syncNow()
    expect(
      a.local
        .alive()
        .map((n) => n.text)
        .sort(),
    ).toEqual(['у второго', 'у первого'])
    expect(
      b.local
        .alive()
        .map((n) => n.text)
        .sort(),
    ).toEqual(['у второго', 'у первого'])
  })

  it('«начать заново» отправляет местные данные снимком и забывает прежние номера', async () => {
    const remote = new MemoryRemote()
    const a = rig(remote, 'a')
    a.local.addNote('n1', 'раз')
    a.local.addNote('n2', 'два')
    await connect(a)
    a.local.editNote('n1', { text: 'раз, исправлено' })
    await a.controller.syncNow()
    expect(remote.names().some((n) => n.startsWith('seg-'))).toBe(true)
    await a.controller.restartVault('новый пароль', true)
    expect(a.forgot.count).toBe(1)
    expect(remote.names().filter((n) => n.startsWith('seg-'))).toEqual([])
    expect(remote.names().filter((n) => n.startsWith('snap-'))).toHaveLength(1)
    const fresh = rig(remote, 'c')
    await connect(fresh, 'новый пароль')
    expect(
      fresh.local
        .alive()
        .map((n) => n.text)
        .sort(),
    ).toEqual(['два', 'раз, исправлено'])
  })

  it('файл хранилища пропал, а другие файлы остались: понятная ошибка, ничего не отправляется', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    r.local.addNote('n1', 'раз')
    await connect(r)
    await remote.delete(remote.idOf('meta.json'))
    r.local.editNote('n1', { text: 'после пропажи' })
    const files = remote.names().length
    await r.controller.syncNow()
    expect(r.controller.getState().status).toMatchObject({ kind: 'error' })
    expect(remote.names().length).toBe(files)
    expect(r.controller.getState().pending).toBe(1)
  })

  it('«отправить всё заново» создаёт снимок', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    r.local.addNote('n1', 'раз')
    await connect(r)
    const snapshots = () => remote.names().filter((n) => n.startsWith('snap-')).length
    expect(snapshots()).toBe(1)
    await r.controller.resend()
    expect(snapshots()).toBe(2)
    expect(status(r)).toBe('idle')
  })

  it('отключение: токен и ключ забываются, настройки сброшены, местные данные целы', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    r.local.addNote('n1', 'раз')
    await connect(r)
    await r.controller.disconnect()
    expect(r.auth.signedOut).toBe(true)
    expect(r.config.key).toBeNull()
    expect(r.config.config).toEqual(defaultConfig())
    expect(r.forgot.count).toBe(1)
    expect(status(r)).toBe('off')
    expect(r.local.notes.size).toBe(1)
    // и после перезапуска остаётся выключено
    const again = rig(remote, 'a', { config: r.config, local: r.local, auth: r.auth })
    await again.controller.start()
    expect(status(again)).toBe('off')
  })
})

describe('запоминание пароля на устройстве', () => {
  it('выключение удаляет ключ, после перезапуска нужен пароль', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    r.local.addNote('n1', 'раз')
    await connect(r)
    expect(r.config.key).not.toBeNull()
    expect(await r.controller.setRemember(false)).toBe('ok')
    expect(r.config.key).toBeNull()
    expect(r.config.config.remember).toBe(false)
    expect(r.controller.getState().remember).toBe(false)
    // в этом сеансе синхронизация продолжает работать
    r.local.editNote('n1', { text: 'правка' })
    await r.controller.syncNow()
    expect(status(r)).toBe('idle')
    const again = rig(remote, 'a', { config: r.config, local: r.local, auth: r.auth })
    await again.controller.start()
    expect(status(again)).toBe('password')
  })

  it('включение снова запоминает ключ, пока он открыт', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    await connect(r, 'общий пароль', false)
    expect(r.config.key).toBeNull()
    expect(await r.controller.setRemember(true)).toBe('ok')
    expect(r.config.key).not.toBeNull()
    expect(r.config.config.remember).toBe(true)
    const again = rig(remote, 'a', { config: r.config, local: r.local, auth: r.auth })
    await again.controller.start()
    expect(status(again)).toBe('idle')
  })

  it('браузер отказал: сообщаем и ничего не меняем', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    await connect(r, 'общий пароль', false)
    r.config.keyAllowed = false
    expect(await r.controller.setRemember(true)).toBe('unsupported')
    expect(r.config.config.remember).toBe(false)
    expect(r.config.key).toBeNull()
  })

  it('ключа нет (после перезапуска без запоминания): нужен пароль', async () => {
    const remote = new MemoryRemote()
    const a = rig(remote, 'a')
    await connect(a, 'общий пароль', false)
    const again = rig(remote, 'a', { config: a.config, local: a.local, auth: a.auth })
    await again.controller.start()
    expect(await again.controller.setRemember(true)).toBe('needs-password')
  })

  it('без подключения ничего не делает', async () => {
    const r = rig(new MemoryRemote(), 'a')
    expect(await r.controller.setRemember(true)).toBe('ok')
    expect(r.config.config).toEqual(defaultConfig())
  })
})

describe('когда запускать', () => {
  it('при открытии приложения запускается круг, если синхронизация включена', async () => {
    const remote = new MemoryRemote()
    const a = rig(remote, 'a')
    a.local.addNote('n1', 'раз')
    await connect(a)
    a.local.editNote('n1', { text: 'правка' })
    const again = rig(remote, 'a', { config: a.config, local: a.local, auth: a.auth })
    await again.controller.start()
    expect(again.controller.getState().pending).toBe(0)
    expect(remote.names().some((n) => n.startsWith('seg-a-'))).toBe(true)
  })

  it('правки откладываются: много изменений подряд дают один запуск через минуту', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    await connect(r)
    r.local.addNote('n1', 'раз')
    r.controller.notifyLocalChange()
    r.controller.notifyLocalChange()
    r.controller.notifyLocalChange()
    await new Promise((res) => setTimeout(res, 20))
    const live = r.timers.filter((t) => !t.cleared)
    expect(live).toHaveLength(1)
    expect(live[0].ms).toBe(60_000)
    live[0].fn()
    await new Promise((res) => setTimeout(res, 50))
    expect(r.controller.getState().pending).toBe(0)
  })

  it('без подключения изменения запуск не назначают', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    r.local.addNote('n1', 'раз')
    r.controller.notifyLocalChange()
    await new Promise((res) => setTimeout(res, 20))
    expect(r.timers).toEqual([])
  })

  it('запись, которую делает сама синхронизация, нового круга не вызывает', async () => {
    const remote = new MemoryRemote()
    const a = rig(remote, 'a')
    a.local.addNote('n1', 'раз')
    await connect(a)
    const b = rig(remote, 'b')
    const original = b.local.applyRemote.bind(b.local)
    // как будто хуки базы сообщают о каждой записи
    let notify: () => void = () => {}
    b.local.applyRemote = async (objects) => {
      const report = await original(objects)
      notify()
      return report
    }
    notify = () => b.controller.notifyLocalChange()
    await connect(b)
    await new Promise((res) => setTimeout(res, 20))
    expect(b.timers.filter((t) => !t.cleared)).toEqual([])
  })

  it('два запроса одновременно дают один круг', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    await connect(r)
    const before = remote.calls.list
    await Promise.all([r.controller.syncNow(), r.controller.syncNow(), r.controller.syncNow()])
    expect(remote.calls.list - before).toBe(1)
  })

  it('после остановки изменения запуск не назначают', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    await connect(r)
    r.controller.stop()
    r.controller.notifyLocalChange()
    await new Promise((res) => setTimeout(res, 20))
    expect(r.timers).toEqual([])
  })

  it('слушатели узнают об изменениях состояния и могут отписаться', async () => {
    const remote = new MemoryRemote()
    const r = rig(remote, 'a')
    let count = 0
    const stop = r.controller.subscribe(() => count++)
    await connect(r)
    expect(count).toBeGreaterThan(0)
    stop()
    const seen = count
    await r.controller.syncNow()
    expect(count).toBe(seen)
  })
})

describe('данные вернулись в обе стороны', () => {
  it('запись с одного устройства доходит до другого через контроллеры', async () => {
    const remote = new MemoryRemote()
    const a = rig(remote, 'a')
    const b = rig(remote, 'b')
    await connect(a)
    await connect(b)
    a.local.addNote('n1', 'с телефона')
    await a.controller.syncNow()
    await b.controller.syncNow()
    expect(b.local.notes.get('n1')?.text).toBe('с телефона')
    b.local.editNote('n1', { text: 'с телефона, поправлено на компьютере' })
    await b.controller.syncNow()
    await a.controller.syncNow()
    expect(a.local.notes.get('n1')?.text).toBe('с телефона, поправлено на компьютере')
  })

  it('независимые правки через контроллеры дают запись и копию на обоих', async () => {
    const remote = new MemoryRemote()
    const a = rig(remote, 'a')
    const b = rig(remote, 'b')
    a.local.addNote('n1', 'исходный')
    await connect(a)
    await connect(b)
    a.local.editNote('n1', { text: 'правка A' })
    b.local.editNote('n1', { text: 'правка B' })
    for (let i = 0; i < 3; i++) {
      await a.controller.syncNow()
      await b.controller.syncNow()
    }
    expect(
      a.local
        .alive()
        .map((n) => n.text)
        .sort(),
    ).toEqual(['правка A', 'правка B'])
    expect(
      b.local
        .alive()
        .map((n) => n.text)
        .sort(),
    ).toEqual(['правка A', 'правка B'])
  })
})

// Чтобы типы использовались и проверялись
export type { LocalStore }
