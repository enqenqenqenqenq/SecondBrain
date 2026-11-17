import { describe, expect, it } from 'vitest'
import { DriveError, driveStore } from './drive'

// Подставной сервер Диска: понимает те же четыре запроса и проверяет вид запросов, а не Google
interface Stored {
  name: string
  content: string
  parents: string[]
}

function fakeDrive() {
  const files = new Map<string, Stored>()
  const log: { method: string; url: string; auth: string | null }[] = []
  let next = 1
  let script: ((url: string, init: RequestInit) => Response | null)[] = []

  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    const headers = init.headers as Record<string, string>
    log.push({ method, url, auth: headers?.Authorization ?? null })
    const scripted = script.shift()
    if (scripted) {
      const forced = scripted(url, init)
      if (forced) return forced
    }
    const parsed = new URL(url)
    if (method === 'GET' && parsed.pathname === '/drive/v3/files') {
      if (parsed.searchParams.get('spaces') !== 'appDataFolder')
        return new Response('нужна скрытая папка', { status: 400 })
      const all = [...files].map(([id, f]) => ({ id, name: f.name }))
      const size = Number(parsed.searchParams.get('pageSize') ?? 100)
      const from = Number(parsed.searchParams.get('pageToken') ?? 0)
      const page = all.slice(from, from + size)
      const more = from + size < all.length
      return Response.json({ files: page, ...(more && { nextPageToken: String(from + size) }) })
    }
    if (method === 'GET' && parsed.pathname.startsWith('/drive/v3/files/')) {
      const f = files.get(decodeURIComponent(parsed.pathname.split('/').pop()!))
      if (!f) return new Response('нет файла', { status: 404 })
      if (parsed.searchParams.get('alt') !== 'media')
        return new Response('нужен alt=media', { status: 400 })
      return new Response(f.content)
    }
    if (method === 'POST' && parsed.pathname === '/upload/drive/v3/files') {
      const type = headers['Content-Type']
      const boundary = /boundary=(.+)$/.exec(type)?.[1]
      if (!boundary || parsed.searchParams.get('uploadType') !== 'multipart')
        return new Response('плохой запрос', { status: 400 })
      const parts = String(init.body)
        .split(`--${boundary}`)
        .filter((p) => p.trim() !== '' && p.trim() !== '--')
        .map((p) => p.replace(/^\r\n/, '').replace(/\r\n$/, ''))
      const meta = JSON.parse(parts[0].split('\r\n\r\n')[1])
      const content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n')
      const id = `id${next++}`
      files.set(id, { name: meta.name, content, parents: meta.parents })
      return Response.json({ id, name: meta.name })
    }
    if (method === 'DELETE' && parsed.pathname.startsWith('/drive/v3/files/')) {
      const id = decodeURIComponent(parsed.pathname.split('/').pop()!)
      if (!files.delete(id)) return new Response('нет файла', { status: 404 })
      return new Response(null, { status: 204 })
    }
    return new Response('неизвестный запрос', { status: 400 })
  }) as typeof fetch

  return {
    files,
    log,
    fetcher,
    // Следующие запросы по очереди отвечают так, как задано; null значит обычный ответ
    queue: (...responders: ((url: string, init: RequestInit) => Response | null)[]) => {
      script = responders
    },
  }
}

const quick = { delays: [0, 0], sleep: async () => {} }
const json = (status: number, reason: string) =>
  new Response(JSON.stringify({ error: { errors: [{ reason }], message: reason } }), { status })

describe('действия с файлами', () => {
  it('создание: скрытая папка приложения, имя и содержимое доходят точно, включая переносы и юникод', async () => {
    const drive = fakeDrive()
    const store = driveStore({ token: async () => 'токен', fetch: drive.fetcher, ...quick })
    const content = '{"v":1,"data":"строка\r\nс переносом и эмодзи 🙂 -- --boundary"}'
    const created = await store.create('seg-a-000001.sb', content)
    expect(created.name).toBe('seg-a-000001.sb')
    const stored = drive.files.get(created.id)!
    expect(stored.parents).toEqual(['appDataFolder'])
    expect(stored.content).toBe(content)
    expect(await store.read(created.id)).toBe(content)
  })

  it('список возвращает номера и имена, многостраничный тоже', async () => {
    const drive = fakeDrive()
    const store = driveStore({ token: async () => 'токен', fetch: drive.fetcher, ...quick })
    for (let i = 0; i < 2500; i++)
      drive.files.set(`f${i}`, { name: `file-${i}`, content: '', parents: [] })
    const list = await store.list()
    expect(list).toHaveLength(2500)
    expect(new Set(list.map((f) => f.id)).size).toBe(2500)
    expect(drive.log.filter((l) => l.url.includes('/drive/v3/files?')).length).toBe(3)
    expect(list[0]).toEqual({ id: 'f0', name: 'file-0' })
  })

  it('пустая папка', async () => {
    const drive = fakeDrive()
    expect(
      await driveStore({ token: async () => 't', fetch: drive.fetcher, ...quick }).list(),
    ).toEqual([])
  })

  it('удаление, а удаление уже удалённого не ошибка', async () => {
    const drive = fakeDrive()
    const store = driveStore({ token: async () => 't', fetch: drive.fetcher, ...quick })
    const { id } = await store.create('a.sb', 'x')
    await store.delete(id)
    expect(drive.files.size).toBe(0)
    await expect(store.delete(id)).resolves.toBeUndefined()
  })

  it('чтение несуществующего файла это ошибка', async () => {
    const drive = fakeDrive()
    const store = driveStore({ token: async () => 't', fetch: drive.fetcher, ...quick })
    await expect(store.read('нет')).rejects.toMatchObject({ failure: 'other', status: 404 })
  })

  it('каждый запрос идёт с токеном, взятым заново перед запросом', async () => {
    const drive = fakeDrive()
    let n = 0
    const store = driveStore({ token: async () => `токен-${++n}`, fetch: drive.fetcher, ...quick })
    await store.list()
    await store.create('a.sb', 'x')
    expect(drive.log.map((l) => l.auth)).toEqual(['Bearer токен-1', 'Bearer токен-2'])
  })
})

describe('сбои и повторы', () => {
  it('потеря входа (401): один раз берётся новый токен, запрос повторяется', async () => {
    const drive = fakeDrive()
    drive.queue(() => json(401, 'authError'))
    let refreshed = 0
    const store = driveStore({
      token: async () => 'старый',
      refresh: async () => {
        refreshed++
        return 'новый'
      },
      fetch: drive.fetcher,
      ...quick,
    })
    expect(await store.list()).toEqual([])
    expect(refreshed).toBe(1)
    expect(drive.log.map((l) => l.auth)).toEqual(['Bearer старый', 'Bearer новый'])
  })

  it('если и новый токен не помог, это потеря входа', async () => {
    const drive = fakeDrive()
    drive.queue(
      () => json(401, 'authError'),
      () => json(401, 'authError'),
    )
    const store = driveStore({
      token: async () => 'a',
      refresh: async () => 'b',
      fetch: drive.fetcher,
      ...quick,
    })
    await expect(store.list()).rejects.toMatchObject({ failure: 'auth', status: 401 })
  })

  it('без способа обновить токен 401 сразу потеря входа', async () => {
    const drive = fakeDrive()
    drive.queue(() => json(401, 'authError'))
    const store = driveStore({ token: async () => 'a', fetch: drive.fetcher, ...quick })
    await expect(store.list()).rejects.toMatchObject({ failure: 'auth' })
  })

  it('просьба подождать (429, 5xx, лимит) повторяется, потом сдаёмся', async () => {
    const drive = fakeDrive()
    drive.queue(
      () => json(429, 'rateLimitExceeded'),
      () => new Response('x', { status: 503 }),
    )
    const store = driveStore({ token: async () => 't', fetch: drive.fetcher, ...quick })
    expect(await store.list()).toEqual([])
    expect(drive.log).toHaveLength(3)

    const busy = fakeDrive()
    busy.queue(
      () => json(429, 'x'),
      () => json(429, 'x'),
      () => json(429, 'x'),
    )
    await expect(
      driveStore({ token: async () => 't', fetch: busy.fetcher, ...quick }).list(),
    ).rejects.toMatchObject({
      failure: 'busy',
      status: 429,
    })
  })

  it('паузы между повторами растут и вызываются', async () => {
    const drive = fakeDrive()
    drive.queue(
      () => json(503, 'x'),
      () => json(503, 'x'),
    )
    const waits: number[] = []
    const store = driveStore({
      token: async () => 't',
      fetch: drive.fetcher,
      delays: [1500, 6000],
      sleep: async (ms) => {
        waits.push(ms)
      },
    })
    await store.list()
    expect(waits).toEqual([1500, 6000])
  })

  it('сбой сети повторяется, потом это «нет связи»', async () => {
    const drive = fakeDrive()
    let calls = 0
    const flaky = (async (...args: Parameters<typeof fetch>) => {
      calls++
      if (calls <= 2) throw new TypeError('Failed to fetch')
      return drive.fetcher(...args)
    }) as typeof fetch
    expect(await driveStore({ token: async () => 't', fetch: flaky, ...quick }).list()).toEqual([])
    expect(calls).toBe(3)

    const dead = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    await expect(
      driveStore({ token: async () => 't', fetch: dead, ...quick }).list(),
    ).rejects.toMatchObject({
      failure: 'network',
    })
  })

  it('на Диске нет места: отдельная ошибка без повторов', async () => {
    const drive = fakeDrive()
    drive.queue(() => json(403, 'storageQuotaExceeded'))
    const store = driveStore({ token: async () => 't', fetch: drive.fetcher, ...quick })
    await expect(store.create('a.sb', 'x')).rejects.toMatchObject({ failure: 'quota' })
    expect(drive.log).toHaveLength(1)
  })

  it('прочий отказ 403 это потеря входа, а 400 прочая ошибка без повторов', async () => {
    const drive = fakeDrive()
    drive.queue(
      () => json(403, 'forbidden'),
      () => json(400, 'badRequest'),
    )
    const store = driveStore({ token: async () => 't', fetch: drive.fetcher, ...quick })
    await expect(store.list()).rejects.toMatchObject({ failure: 'auth', status: 403 })
    await expect(store.list()).rejects.toMatchObject({ failure: 'other', status: 400 })
  })

  it('ошибка со не-JSON телом тоже разбирается', async () => {
    const drive = fakeDrive()
    drive.queue(() => new Response('<html>плохо</html>', { status: 418 }))
    const store = driveStore({ token: async () => 't', fetch: drive.fetcher, ...quick })
    await expect(store.list()).rejects.toBeInstanceOf(DriveError)
  })

  it('сбой получения токена доходит наверх как есть', async () => {
    const store = driveStore({
      token: async () => {
        throw new Error('нет токена')
      },
      fetch: fakeDrive().fetcher,
      ...quick,
    })
    await expect(store.list()).rejects.toThrow('нет токена')
  })
})
