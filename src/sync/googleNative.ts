import { AuthError, DRIVE_SCOPE } from './google'
import type { Auth } from './google'

// Вход Google в установленном приложении Android. Google не пускает вход во встроенное окно, поэтому
// вход идёт в системном браузере (Chrome), а в приложение возвращает ссылка app.secondbrain.notes:/oauth2redirect.
// Код подтверждения (PKCE) защищает обмен, секретного ключа у клиента Android нет. В ответ приходит токен
// обновления: он хранится на устройстве и даёт новый токен доступа без окна.

// Клиент типа Android: пакет app.secondbrain.notes и отпечаток SHA-1 ключа подписи (docs/android-apk.txt)
export const ANDROID_CLIENT_ID =
  '979456919192-vsnvd9pkq9m9aco9utm40s93u2c3ds0b.apps.googleusercontent.com'
export const REDIRECT_URI = 'app.secondbrain.notes:/oauth2redirect'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

// Всё, что нужно от самого телефона. Настоящее устройство в nativeBridge.ts, в проверках заменитель.
export interface NativeBridge {
  open(url: string): Promise<void>
  close(): Promise<void>
  // Приложение открыто по ссылке. Возвращает функцию, которая отписывается.
  onUrl(callback: (url: string) => void): Promise<() => void>
  // Человек закрыл окно браузера
  onBrowserClosed(callback: () => void): Promise<() => void>
  // Запрос в обход ограничений браузера (CORS), тело в виде формы
  post(url: string, form: Record<string, string>): Promise<{ status: number; data: unknown }>
}

// Где лежит токен обновления
export interface TokenStore {
  load(): Promise<string | null>
  save(token: string | null): Promise<void>
}

export interface NativeAuthOptions {
  bridge: NativeBridge
  store: TokenStore
  clientId?: string
  now?: () => number
  random?: (bytes: Uint8Array) => Uint8Array
  // Окно браузера закрылось: ссылка возврата может прийти чуть позже, ждём столько
  closeGrace?: number
  consentTimeout?: number
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

const defaultRandom = (bytes: Uint8Array): Uint8Array => {
  crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>)
  return bytes
}

export function nativeAuth(options: NativeAuthOptions): Auth {
  const { bridge, store } = options
  const clientId = options.clientId ?? ANDROID_CLIENT_ID
  const now = options.now ?? Date.now
  const random = options.random ?? defaultRandom
  const closeGrace = options.closeGrace ?? 1500
  const consentTimeout = options.consentTimeout ?? 10 * 60_000

  let access: string | null = null
  let expiresAt = 0
  let refreshToken: string | null | undefined // undefined: ещё не читали
  let inflight: Promise<string> | null = null

  const valid = () => access !== null && now() < expiresAt - 60_000

  async function loadRefresh(): Promise<string | null> {
    if (refreshToken === undefined) refreshToken = await store.load()
    return refreshToken
  }

  async function forgetRefresh() {
    refreshToken = null
    await store.save(null)
  }

  async function post(form: Record<string, string>) {
    try {
      return await bridge.post(TOKEN_URL, { client_id: clientId, ...form })
    } catch {
      throw new AuthError('other', 'Нет связи с Google')
    }
  }

  // Принимает ответ с токеном. Возвращает токен доступа или ошибку Google.
  function accept(response: { status: number; data: unknown }): string | { error: string } {
    const data = (response.data ?? {}) as Record<string, unknown>
    if (response.status >= 400 || typeof data.access_token !== 'string') {
      return { error: typeof data.error === 'string' ? data.error : 'unknown' }
    }
    access = data.access_token
    expiresAt = now() + (typeof data.expires_in === 'number' ? data.expires_in : 3600) * 1000
    return access
  }

  // Новый токен доступа без окна, по токену обновления
  async function silent(): Promise<string> {
    const saved = await loadRefresh()
    if (!saved) throw new AuthError('other', 'Нужно войти в Google')
    const result = accept(await post({ grant_type: 'refresh_token', refresh_token: saved }))
    if (typeof result === 'string') return result
    // Отозван или просрочен: токен обновления больше не нужен, надо войти заново
    if (result.error === 'invalid_grant') await forgetRefresh()
    throw new AuthError('other', 'Нужно войти в Google заново')
  }

  // Ждёт, пока браузер вернёт в приложение код. Возвращает код.
  async function waitForCode(url: string, state: string): Promise<string> {
    let finish!: (outcome: { code: string } | AuthError) => void
    const outcome = new Promise<{ code: string } | AuthError>((resolve) => {
      finish = resolve
    })
    let closedTimer: ReturnType<typeof setTimeout> | undefined
    const offs: (() => void)[] = []
    const timer = setTimeout(
      () => finish(new AuthError('timeout', 'Вход в Google не завершён')),
      consentTimeout,
    )
    try {
      offs.push(
        await bridge.onUrl((incoming) => {
          if (!incoming.startsWith(REDIRECT_URI.split(':')[0] + ':')) return
          const qIndex = incoming.indexOf('?')
          if (qIndex === -1) return
          const params = new URLSearchParams(incoming.slice(qIndex + 1))
          if (!params.has('state')) return
          if (params.get('state') !== state) {
            finish(new AuthError('other', 'Ответ Google не подошёл, попробуйте ещё раз'))
          } else if (params.get('error')) {
            finish(
              params.get('error') === 'access_denied'
                ? new AuthError('denied', 'Вход отменён')
                : new AuthError('other', params.get('error') ?? 'Вход не удался'),
            )
          } else if (params.get('code')) {
            finish({ code: params.get('code')! })
          }
        }),
        await bridge.onBrowserClosed(() => {
          // Ссылка возврата и закрытие окна приходят в любом порядке, поэтому даём ссылке время
          closedTimer = setTimeout(
            () => finish(new AuthError('closed', 'Окно входа закрыто')),
            closeGrace,
          )
        }),
      )
      await bridge.open(url)
      const result = await outcome
      if (result instanceof AuthError) throw result
      return result.code
    } finally {
      clearTimeout(timer)
      clearTimeout(closedTimer)
      for (const off of offs) off()
      try {
        await bridge.close()
      } catch {
        // окно могло уже закрыться
      }
    }
  }

  async function consent(): Promise<string> {
    const verifier = base64url(random(new Uint8Array(48)))
    const state = base64url(random(new Uint8Array(16)))
    const url =
      AUTH_URL +
      '?' +
      new URLSearchParams({
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: DRIVE_SCOPE,
        code_challenge: await challengeOf(verifier),
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'select_account consent',
      })
    const code = await waitForCode(url, state)
    const response = await post({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    })
    const result = accept(response)
    if (typeof result !== 'string') {
      throw new AuthError(
        result.error === 'access_denied' ? 'denied' : 'other',
        'Вход не удался: ' + result.error,
      )
    }
    const data = response.data as { scope?: unknown; refresh_token?: unknown }
    if (typeof data.scope !== 'string' || !data.scope.split(' ').includes(DRIVE_SCOPE)) {
      access = null
      throw new AuthError('denied', 'Доступ к папке приложения не выдан')
    }
    if (typeof data.refresh_token === 'string') {
      refreshToken = data.refresh_token
      await store.save(data.refresh_token)
    }
    return result
  }

  // Параллельные просьбы о токене объединяются в одну
  function once(work: () => Promise<string>): Promise<string> {
    inflight ??= work().finally(() => {
      inflight = null
    })
    return inflight
  }

  return {
    token(interactive) {
      if (valid()) return Promise.resolve(access!)
      return once(async () => {
        try {
          return await silent()
        } catch (error) {
          if (!interactive) throw error
          return consent()
        }
      })
    },
    hasToken: valid,
    refresh() {
      access = null
      expiresAt = 0
      return once(silent)
    },
    async signOut() {
      const saved = (await loadRefresh()) ?? access
      access = null
      expiresAt = 0
      await forgetRefresh()
      if (!saved) return
      try {
        await bridge.post(REVOKE_URL, { token: saved })
      } catch {
        // отзыв не удался: на устройстве всё забыто
      }
    },
  }
}
