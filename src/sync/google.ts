// Вход через Google. Токен доступа живёт только в памяти страницы: в базу и в localStorage он не пишется
// (после перезагрузки получаем заново). Новый токен без окна работает, пока в браузере открыт сеанс Google.

export const GOOGLE_CLIENT_ID =
  '979456919192-j0cq9ciuq9npluuf6ltisvpsfc1d4548.apps.googleusercontent.com'
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const SCRIPT = 'https://accounts.google.com/gsi/client'
const SILENT_TIMEOUT = 15_000

export type AuthFailure = 'blocked' | 'denied' | 'closed' | 'timeout' | 'other'

export class AuthError extends Error {
  failure: AuthFailure
  constructor(failure: AuthFailure, message: string) {
    super(message)
    this.name = 'AuthError'
    this.failure = failure
  }
}

// Что нужно остальному приложению от входа. Настоящий вход и заменитель для проверок на этом устройстве.
export interface Auth {
  // Действующий токен. С interactive равным false окно входа не показывается.
  token(interactive: boolean): Promise<string>
  // Вход есть и токен ещё действует
  hasToken(): boolean
  // Новый токен без окна, когда прежний отклонён Диском
  refresh(): Promise<string>
  // Выйти: токен отзывается и забывается
  signOut(): Promise<void>
}

// Минимальное описание нужной части библиотеки Google
interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  scope?: string
}
interface TokenClient {
  requestAccessToken(config?: { prompt?: string }): void
}
interface GoogleOAuth {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
    error_callback: (error: { type?: string; message?: string }) => void
  }): TokenClient
  revoke(token: string, done?: () => void): void
  hasGrantedAllScopes(response: TokenResponse, scope: string): boolean
}

// Приложение запущено как установленный файл Android (Capacitor), а не в браузере
export function isNativeApp(): boolean {
  const capacitor = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor
  return capacitor?.isNativePlatform?.() === true
}

let loading: Promise<GoogleOAuth> | null = null

function loadScript(): Promise<GoogleOAuth> {
  const existing = (window as unknown as { google?: { accounts?: { oauth2?: GoogleOAuth } } })
    .google?.accounts?.oauth2
  if (existing) return Promise.resolve(existing)
  loading ??= new Promise<GoogleOAuth>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT
    script.async = true
    script.onload = () => {
      const oauth = (window as unknown as { google?: { accounts?: { oauth2?: GoogleOAuth } } })
        .google?.accounts?.oauth2
      if (oauth) resolve(oauth)
      else reject(new AuthError('blocked', 'Библиотека входа Google не запустилась'))
    }
    script.onerror = () => {
      loading = null
      reject(
        new AuthError('blocked', 'Не удалось загрузить вход Google. Проверьте сеть и блокировщики'),
      )
    }
    document.head.append(script)
  })
  return loading
}

export function googleAuth(clientId: string = GOOGLE_CLIENT_ID): Auth {
  let token: string | null = null
  let expiresAt = 0
  let client: TokenClient | null = null
  let pending: ((r: TokenResponse | AuthError) => void) | null = null

  const valid = () => token !== null && Date.now() < expiresAt - 60_000

  async function ask(prompt: '' | 'select_account'): Promise<string> {
    // Google не пускает вход во встроенное окно приложения. В APK используется googleNative.ts, сюда по ошибке попасть нельзя.
    if (isNativeApp()) {
      throw new AuthError(
        'blocked',
        'Окно входа Google в приложении для Android не работает. Вход идёт через системный браузер.',
      )
    }
    const oauth = await loadScript()
    client ??= oauth.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => pending?.(response),
      error_callback: (error) =>
        pending?.(
          new AuthError(
            error.type === 'popup_closed'
              ? 'closed'
              : error.type === 'popup_failed_to_open'
                ? 'blocked'
                : 'other',
            error.message ?? 'Окно входа Google не открылось',
          ),
        ),
    })
    const response = await new Promise<TokenResponse | AuthError>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      pending = (r) => {
        clearTimeout(timer)
        resolve(r)
      }
      // Тихий запрос без окна может так и не ответить, если сеанс Google закрыт
      if (prompt === '') {
        timer = setTimeout(
          () => resolve(new AuthError('timeout', 'Google не ответил')),
          SILENT_TIMEOUT,
        )
      }
      client!.requestAccessToken({ prompt })
    })
    pending = null
    if (response instanceof AuthError) throw response
    if (response.error || !response.access_token) {
      throw new AuthError(
        response.error === 'access_denied' ? 'denied' : 'other',
        response.error ?? 'Вход не удался',
      )
    }
    if (!oauth.hasGrantedAllScopes(response, DRIVE_SCOPE))
      throw new AuthError('denied', 'Доступ к папке приложения не выдан')
    token = response.access_token
    expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000
    return token
  }

  return {
    async token(interactive) {
      if (valid()) return token!
      try {
        return await ask('')
      } catch (error) {
        if (!interactive) throw error
        return ask('select_account')
      }
    },
    hasToken: valid,
    async refresh() {
      token = null
      expiresAt = 0
      return ask('')
    },
    async signOut() {
      const old = token
      token = null
      expiresAt = 0
      if (!old) return
      try {
        const oauth = await loadScript()
        await new Promise<void>((resolve) => oauth.revoke(old, resolve))
      } catch {
        // отзыв не удался: токен всё равно забыт, а через час перестанет действовать
      }
    },
  }
}
