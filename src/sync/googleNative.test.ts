import { describe, expect, it, vi } from 'vitest'
import { AuthError, DRIVE_SCOPE } from './google'
import { ANDROID_CLIENT_ID, REDIRECT_URI, challengeOf, nativeAuth } from './googleNative'
import type { NativeBridge, TokenStore } from './googleNative'

// Вместо телефона заменитель: записывает, что просили открыть и отправить, и позволяет сыграть возврат из браузера

interface Post {
  url: string
  form: Record<string, string>
}

function rig(options: { refresh?: string | null; closeGrace?: number } = {}) {
  const log = {
    opened: [] as string[],
    posts: [] as Post[],
    closed: 0,
    saved: [] as (string | null)[],
  }
  let urlListener: ((url: string) => void) | null = null
  let closedListener: (() => void) | null = null
  let clock = 1_000_000
  const answers: ((post: Post) => { status: number; data: unknown } | Error)[] = []
  const bridge: NativeBridge = {
    async open(url) {
      log.opened.push(url)
    },
    async close() {
      log.closed++
    },
    async onUrl(callback) {
      urlListener = callback
      return () => {
        urlListener = null
      }
    },
    async onBrowserClosed(callback) {
      closedListener = callback
      return () => {
        closedListener = null
      }
    },
    async post(url, form) {
      const post = { url, form }
      log.posts.push(post)
      const answer = answers.shift()?.(post) ?? { status: 200, data: {} }
      if (answer instanceof Error) throw answer
      return answer
    },
  }
  let stored: string | null = options.refresh ?? null
  const store: TokenStore = {
    async load() {
      return stored
    },
    async save(token) {
      stored = token
      log.saved.push(token)
    },
  }
  const auth = nativeAuth({
    bridge,
    store,
    now: () => clock,
    closeGrace: options.closeGrace ?? 20,
  })
  return {
    auth,
    log,
    answers,
    stored: () => stored,
    advance: (ms: number) => (clock += ms),
    // Браузер вернул в приложение по ссылке
    redirect: (query: string) => urlListener?.(`${REDIRECT_URI}?${query}`),
    closeBrowser: () => closedListener?.(),
    listening: () => urlListener !== null,
    stateOf: () => new URL(log.opened.at(-1)!).searchParams.get('state')!,
  }
}

const tokenReply = (extra: Record<string, unknown> = {}) => ({
  status: 200,
  data: {
    access_token: 'доступ-1',
    expires_in: 3600,
    refresh_token: 'обновление-1',
    scope: DRIVE_SCOPE,
    ...extra,
  },
})

// Ждём, пока вход откроет окно браузера
const opened = (r: ReturnType<typeof rig>) => vi.waitFor(() => expect(r.log.opened).toHaveLength(1))

describe('код подтверждения (PKCE)', () => {
  it('совпадает с примером из RFC 7636', async () => {
    expect(await challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })
})

describe('вход через системный браузер', () => {
  it('открывает окно Google с нужными параметрами и меняет код на токены', async () => {
    const r = rig()
    r.answers.push(() => tokenReply())
    const pending = r.auth.token(true)
    await opened(r)
    const url = new URL(r.log.opened[0])
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const q = url.searchParams
    expect(q.get('client_id')).toBe(ANDROID_CLIENT_ID)
    expect(q.get('redirect_uri')).toBe(REDIRECT_URI)
    expect(q.get('response_type')).toBe('code')
    expect(q.get('scope')).toBe(DRIVE_SCOPE)
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('access_type')).toBe('offline')
    r.redirect(`code=код-1&state=${r.stateOf()}`)
    expect(await pending).toBe('доступ-1')

    // Обмен: код, проверка PKCE подходит к отправленному в окне, секретного ключа нет
    const exchange = r.log.posts[0]
    expect(exchange.url).toBe('https://oauth2.googleapis.com/token')
    expect(exchange.form).toMatchObject({
      client_id: ANDROID_CLIENT_ID,
      grant_type: 'authorization_code',
      code: 'код-1',
      redirect_uri: REDIRECT_URI,
    })
    expect(await challengeOf(exchange.form.code_verifier)).toBe(q.get('code_challenge'))
    expect(exchange.form).not.toHaveProperty('client_secret')
    // Токен обновления запомнен, окно закрыто, подписка снята
    expect(r.stored()).toBe('обновление-1')
    expect(r.log.closed).toBe(1)
    expect(r.listening()).toBe(false)
    expect(r.auth.hasToken()).toBe(true)
  })

  it('ответ с чужим кодом состояния отклоняется', async () => {
    const r = rig()
    const pending = r.auth.token(true)
    await opened(r)
    r.redirect('code=чужой&state=не-тот')
    await expect(pending).rejects.toBeInstanceOf(AuthError)
    expect(r.log.posts).toEqual([])
    expect(r.stored()).toBeNull()
  })

  it('человек отказал: ошибка «denied», токенов нет', async () => {
    const r = rig()
    const pending = r.auth.token(true)
    await opened(r)
    r.redirect(`error=access_denied&state=${r.stateOf()}`)
    await expect(pending).rejects.toMatchObject({ failure: 'denied' })
    expect(r.log.posts).toEqual([])
  })

  it('окно закрыли, не войдя: ошибка «closed»', async () => {
    const r = rig()
    const pending = r.auth.token(true)
    await opened(r)
    r.closeBrowser()
    await expect(pending).rejects.toMatchObject({ failure: 'closed' })
  })

  it('окно закрылось раньше, чем пришла ссылка возврата: вход всё равно проходит', async () => {
    const r = rig({ closeGrace: 200 })
    r.answers.push(() => tokenReply())
    const pending = r.auth.token(true)
    await opened(r)
    r.closeBrowser()
    r.redirect(`code=код-2&state=${r.stateOf()}`)
    expect(await pending).toBe('доступ-1')
  })

  it('чужие ссылки приложение во время входа не сбивают', async () => {
    const r = rig()
    r.answers.push(() => tokenReply())
    const pending = r.auth.token(true)
    await opened(r)
    ;(r.redirect as unknown as (q: string) => void)('code=x')
    // ссылка другого приложения
    r.log.opened.length = 1
    r.redirect(`code=код-3&state=${r.stateOf()}`)
    expect(await pending).toBe('доступ-1')
  })

  it('доступ к папке приложения не выдан: вход отклоняется, токены не запоминаются', async () => {
    const r = rig()
    r.answers.push(() => tokenReply({ scope: 'openid' }))
    const pending = r.auth.token(true)
    await opened(r)
    r.redirect(`code=к&state=${r.stateOf()}`)
    await expect(pending).rejects.toMatchObject({ failure: 'denied' })
    expect(r.stored()).toBeNull()
    expect(r.auth.hasToken()).toBe(false)
  })

  it('нет связи при обмене кода: ошибка, токенов нет', async () => {
    const r = rig()
    r.answers.push(() => new Error('сеть'))
    const pending = r.auth.token(true)
    await opened(r)
    r.redirect(`code=к&state=${r.stateOf()}`)
    await expect(pending).rejects.toMatchObject({ failure: 'other' })
    expect(r.stored()).toBeNull()
  })

  it('Google отклонил обмен кода: ошибка, токенов нет', async () => {
    const r = rig()
    r.answers.push(() => ({ status: 400, data: { error: 'invalid_grant' } }))
    const pending = r.auth.token(true)
    await opened(r)
    r.redirect(`code=к&state=${r.stateOf()}`)
    await expect(pending).rejects.toBeInstanceOf(AuthError)
    expect(r.stored()).toBeNull()
  })
})

describe('тихое обновление токена', () => {
  it('без токена обновления окно не открывается, если вход не просили', async () => {
    const r = rig()
    await expect(r.auth.token(false)).rejects.toBeInstanceOf(AuthError)
    expect(r.log.opened).toEqual([])
    expect(r.log.posts).toEqual([])
  })

  it('по запомненному токену новый токен доступа приходит без окна', async () => {
    const r = rig({ refresh: 'обновление-0' })
    r.answers.push(() => tokenReply({ access_token: 'доступ-2', refresh_token: undefined }))
    expect(await r.auth.token(false)).toBe('доступ-2')
    expect(r.log.posts[0].form).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'обновление-0',
      client_id: ANDROID_CLIENT_ID,
    })
    expect(r.log.opened).toEqual([])
    expect(r.stored()).toBe('обновление-0')
  })

  it('пока токен действует, запросов нет, а за минуту до конца берётся новый', async () => {
    const r = rig({ refresh: 'о' })
    r.answers.push(() => tokenReply({ access_token: 'доступ-A' }))
    r.answers.push(() => tokenReply({ access_token: 'доступ-B' }))
    expect(await r.auth.token(false)).toBe('доступ-A')
    r.advance(3_000_000)
    expect(await r.auth.token(false)).toBe('доступ-A')
    expect(r.log.posts).toHaveLength(1)
    r.advance(600_000)
    expect(r.auth.hasToken()).toBe(false)
    expect(await r.auth.token(false)).toBe('доступ-B')
    expect(r.log.posts).toHaveLength(2)
  })

  it('одновременные просьбы дают один запрос', async () => {
    const r = rig({ refresh: 'о' })
    r.answers.push(() => tokenReply())
    const all = await Promise.all([r.auth.token(false), r.auth.token(false), r.auth.refresh()])
    expect(new Set(all)).toEqual(new Set(['доступ-1']))
    expect(r.log.posts).toHaveLength(1)
  })

  it('refresh() берёт новый токен, даже если прежний ещё действует', async () => {
    const r = rig({ refresh: 'о' })
    r.answers.push(() => tokenReply({ access_token: 'доступ-A' }))
    r.answers.push(() => tokenReply({ access_token: 'доступ-B' }))
    await r.auth.token(false)
    expect(await r.auth.refresh()).toBe('доступ-B')
  })

  it('токен обновления отозван: он забывается, тихий вход не удаётся, а обычный открывает окно', async () => {
    const r = rig({ refresh: 'старый' })
    r.answers.push(() => ({ status: 400, data: { error: 'invalid_grant' } }))
    await expect(r.auth.token(false)).rejects.toBeInstanceOf(AuthError)
    expect(r.stored()).toBeNull()
    r.answers.push(() => tokenReply())
    const pending = r.auth.token(true)
    await opened(r)
    r.redirect(`code=к&state=${r.stateOf()}`)
    expect(await pending).toBe('доступ-1')
    expect(r.stored()).toBe('обновление-1')
  })

  it('нет связи при обновлении: токен обновления остаётся, ошибка не «нужно войти заново»', async () => {
    const r = rig({ refresh: 'остаётся' })
    r.answers.push(() => new Error('сеть'))
    await expect(r.auth.token(false)).rejects.toMatchObject({ failure: 'other' })
    expect(r.stored()).toBe('остаётся')
  })

  it('другая ошибка Google не стирает токен обновления', async () => {
    const r = rig({ refresh: 'остаётся' })
    r.answers.push(() => ({ status: 500, data: {} }))
    await expect(r.auth.token(false)).rejects.toBeInstanceOf(AuthError)
    expect(r.stored()).toBe('остаётся')
  })
})

describe('выход', () => {
  it('токен обновления отзывается и забывается, дальше нужен новый вход', async () => {
    const r = rig({ refresh: 'прощай' })
    r.answers.push(() => tokenReply())
    await r.auth.token(false)
    await r.auth.signOut()
    const revoke = r.log.posts.at(-1)!
    expect(revoke.url).toBe('https://oauth2.googleapis.com/revoke')
    expect(revoke.form).toEqual({ token: 'прощай' })
    expect(r.stored()).toBeNull()
    expect(r.auth.hasToken()).toBe(false)
    await expect(r.auth.token(false)).rejects.toBeInstanceOf(AuthError)
  })

  it('отзыв не удался: на устройстве всё равно всё забыто', async () => {
    const r = rig({ refresh: 'прощай' })
    r.answers.push(() => tokenReply())
    await r.auth.token(false)
    r.answers.push(() => new Error('сеть'))
    await r.auth.signOut()
    expect(r.stored()).toBeNull()
  })

  it('выход без входа ничего не отправляет', async () => {
    const r = rig()
    await r.auth.signOut()
    expect(r.log.posts).toEqual([])
  })
})
