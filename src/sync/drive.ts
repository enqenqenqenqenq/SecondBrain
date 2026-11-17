import type { RemoteFile, RemoteStore } from './types'

// Google Диск, скрытая папка приложения (доступ drive.appdata). Запросы те же, что проверены на мини-приложении:
// список, чтение, создание и удаление файла. Токен живёт один час, при отказе просим новый один раз.

export type DriveFailure =
  | 'auth' // нужен вход заново
  | 'quota' // на Диске нет места
  | 'network' // нет сети
  | 'busy' // Google просит подождать, повторим позже
  | 'other'

export class DriveError extends Error {
  failure: DriveFailure
  status: number | null
  constructor(failure: DriveFailure, message: string, status: number | null = null) {
    super(message)
    this.name = 'DriveError'
    this.failure = failure
    this.status = status
  }
}

export interface DriveOptions {
  // Действующий токен доступа. Вызывается перед каждым запросом, поэтому устаревший сам обновится.
  token: () => Promise<string>
  // Новый токен после отказа 401. Если не задан, отказ сразу считается потерей входа.
  refresh?: () => Promise<string>
  apiBase?: string
  uploadBase?: string
  fetch?: typeof fetch
  // Паузы между повторами при сбое сети и просьбе подождать. Для проверок можно обнулить.
  delays?: number[]
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_DELAYS = [1500, 6000]

interface GoogleErrorBody {
  error?: { errors?: { reason?: string }[]; message?: string }
}

function classify(status: number, body: string): DriveError {
  let reason = ''
  try {
    reason = (JSON.parse(body) as GoogleErrorBody).error?.errors?.[0]?.reason ?? ''
  } catch {
    // тело не JSON
  }
  const text = `Диск ответил ${status}${reason ? `, ${reason}` : ''}`
  if (status === 401) return new DriveError('auth', text, status)
  if (reason === 'storageQuotaExceeded')
    return new DriveError('quota', 'На Диске нет места', status)
  if (status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
    return new DriveError('busy', text, status)
  }
  if (status === 403) return new DriveError('auth', text, status)
  if (status >= 500) return new DriveError('busy', text, status)
  return new DriveError('other', text, status)
}

export function driveStore(options: DriveOptions): RemoteStore {
  const api = options.apiBase ?? 'https://www.googleapis.com'
  const upload = options.uploadBase ?? api
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const delays = options.delays ?? DEFAULT_DELAYS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  // Один запрос с повторами: просьба подождать и сбой сети повторяются, потеря входа один раз с новым токеном
  async function request(
    url: string,
    init: RequestInit = {},
    okStatuses: number[] = [],
  ): Promise<Response> {
    let refreshed = false
    for (let attempt = 0; ; attempt++) {
      let token = await options.token()
      for (;;) {
        let response: Response
        try {
          response = await doFetch(url, {
            ...init,
            headers: {
              ...(init.headers as Record<string, string>),
              Authorization: `Bearer ${token}`,
            },
          })
        } catch {
          if (attempt < delays.length) {
            await sleep(delays[attempt])
            break
          }
          throw new DriveError('network', 'Нет связи с Диском')
        }
        if (response.ok || okStatuses.includes(response.status)) return response
        const error = classify(response.status, await response.text().catch(() => ''))
        if (error.failure === 'auth' && error.status === 401 && options.refresh && !refreshed) {
          refreshed = true
          token = await options.refresh()
          continue
        }
        if (error.failure === 'busy' && attempt < delays.length) {
          await sleep(delays[attempt])
          break
        }
        throw error
      }
    }
  }

  return {
    async list() {
      const files: RemoteFile[] = []
      let pageToken = ''
      do {
        const url =
          `${api}/drive/v3/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name)` +
          (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
        const body = (await (await request(url)).json()) as {
          files?: RemoteFile[]
          nextPageToken?: string
        }
        for (const f of body.files ?? []) files.push({ id: f.id, name: f.name })
        pageToken = body.nextPageToken ?? ''
      } while (pageToken)
      return files
    },

    async read(id) {
      return (await request(`${api}/drive/v3/files/${encodeURIComponent(id)}?alt=media`)).text()
    },

    async create(name, content) {
      const boundary = `sb${crypto.randomUUID().replaceAll('-', '')}`
      const meta = JSON.stringify({ name, parents: ['appDataFolder'] })
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`
      const response = await request(
        `${upload}/upload/drive/v3/files?uploadType=multipart&fields=id,name`,
        {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          body,
        },
      )
      const created = (await response.json()) as RemoteFile
      return { id: created.id, name: created.name }
    },

    async delete(id) {
      // Файла уже нет: цель достигнута
      await request(`${api}/drive/v3/files/${encodeURIComponent(id)}`, { method: 'DELETE' }, [404])
    },
  }
}
