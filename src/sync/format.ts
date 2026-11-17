import { openEnvelope, seal, VaultError } from '../crypto/vault'
import type { Envelope } from '../crypto/vault'
import { readRemoteCard, readRemoteLink, readRemoteNote } from '../storage'
import type { Codec, FileKind, Payload, SyncObject } from './types'

// Имена файлов на Диске. По имени видно, чьё это и какой номер, не читая содержимое.
export const META_NAME = 'meta.json'

const pad = (n: number, width: number) => String(n).padStart(width, '0')

export const segmentName = (deviceId: string, counter: number) =>
  `seg-${deviceId}-${pad(counter, 6)}.sb`
export const snapshotName = (time: number, deviceId: string) =>
  `snap-${pad(time, 13)}-${deviceId}.sb`

export type ParsedName =
  | { kind: 'segment'; deviceId: string; seq: number }
  | { kind: 'snapshot'; deviceId: string; seq: number }

export function parseName(name: string): ParsedName | null {
  const seg = /^seg-(.+)-(\d{6,})\.sb$/.exec(name)
  if (seg) return { kind: 'segment', deviceId: seg[1], seq: Number(seg[2]) }
  const snap = /^snap-(\d{13})-(.+)\.sb$/.exec(name)
  if (snap) return { kind: 'snapshot', deviceId: snap[2], seq: Number(snap[1]) }
  return null
}

// Дополнительные данные шифра: файл нельзя выдать за другой, подменив имя, номер или признак сжатия
export const aadFor = (kind: FileKind, deviceId: string, seq: number, compressed: boolean) =>
  `sb1|${kind}|${deviceId}|${seq}${compressed ? '|z' : ''}`

// ---------- сжатие ----------

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter()
  // Ошибку (например, данные не gzip) возвращает чтение результата ниже. Отказы записи и закрытия сами по себе
  // ничего не добавляют, но без обработки они остались бы необработанными и шумели бы в консоли.
  writer.write(bytes as BufferSource).catch(() => {})
  writer.close().catch(() => {})
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

const hasCompression = () =>
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'

export const compress = (bytes: Uint8Array) => pipe(bytes, new CompressionStream('gzip'))
export const decompress = (bytes: Uint8Array) => pipe(bytes, new DecompressionStream('gzip'))

// ---------- полезная нагрузка ----------

interface Wire {
  v: 1
  kind: FileKind
  deviceId: string
  seq: number
  createdAt: number
  objects: { entity: string; data: unknown }[]
  covers?: Record<string, number>
}

function readObject(item: { entity: string; data: unknown }): SyncObject | null {
  if (item.entity === 'note') {
    const data = readRemoteNote(item.data)
    return data && { entity: 'note', data }
  }
  if (item.entity === 'card') {
    const data = readRemoteCard(item.data)
    return data && { entity: 'card', data }
  }
  if (item.entity === 'link') {
    const data = readRemoteLink(item.data)
    return data && { entity: 'link', data }
  }
  return null
}

const isCounterMap = (v: unknown): v is Record<string, number> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.entries(v).every(
    ([k, n]) => k.length > 0 && k.length <= 100 && Number.isInteger(n) && n >= 0,
  )

// Разбор расшифрованного текста. Повреждённые объекты пропускаются и считаются, остальные читаются.
export function parsePayload(
  text: string,
  expected: { kind: FileKind; deviceId: string; seq: number },
): Payload {
  let wire: unknown
  try {
    wire = JSON.parse(text)
  } catch {
    throw new VaultError('bad-file', 'Файл повреждён')
  }
  const w = wire as Partial<Wire>
  if (typeof w !== 'object' || w === null) throw new VaultError('bad-file', 'Файл повреждён')
  if (typeof w.v === 'number' && w.v > 1)
    throw new VaultError('newer-version', 'Файл сделан более новой версией приложения')
  // Содержимое должно совпадать с именем файла, иначе файл подменили
  if (
    w.v !== 1 ||
    w.kind !== expected.kind ||
    w.deviceId !== expected.deviceId ||
    w.seq !== expected.seq ||
    typeof w.createdAt !== 'number' ||
    !Array.isArray(w.objects)
  ) {
    throw new VaultError('bad-file', 'Файл не соответствует своему имени')
  }
  if (w.covers !== undefined && !isCounterMap(w.covers))
    throw new VaultError('bad-file', 'Файл повреждён')
  const objects: SyncObject[] = []
  let invalid = 0
  for (const item of w.objects) {
    const object = typeof item === 'object' && item !== null ? readObject(item) : null
    if (object) objects.push(object)
    else invalid++
  }
  return {
    kind: w.kind,
    deviceId: w.deviceId,
    seq: w.seq,
    createdAt: w.createdAt,
    objects,
    covers: w.covers,
    invalid,
  }
}

// ---------- шифр файлов ----------

// Файл на Диске: JSON с оболочкой шифра и признаком сжатия. Сначала сжимаем, потом шифруем.
export function makeCodec(key: CryptoKey): Codec {
  return {
    async encode(name, payload) {
      const parsed = parseName(name)
      if (!parsed) throw new Error(`Неизвестное имя файла: ${name}`)
      const wire: Wire = {
        v: 1,
        kind: payload.kind,
        deviceId: payload.deviceId,
        seq: payload.seq,
        createdAt: payload.createdAt,
        objects: payload.objects.map((o) => ({ entity: o.entity, data: o.data })),
        ...(payload.covers && { covers: payload.covers }),
      }
      const raw = new TextEncoder().encode(JSON.stringify(wire))
      const compressed = hasCompression()
      const bytes = compressed ? await compress(raw) : raw
      const envelope = await seal(
        key,
        bytes,
        aadFor(payload.kind, payload.deviceId, payload.seq, compressed),
      )
      return JSON.stringify(compressed ? { ...envelope, z: 1 } : envelope)
    },

    async decode(name, content) {
      const parsed = parseName(name)
      if (!parsed) throw new VaultError('bad-file', 'Неизвестное имя файла')
      let envelope: unknown
      try {
        envelope = JSON.parse(content)
      } catch {
        throw new VaultError('bad-file', 'Файл повреждён')
      }
      const compressed = (envelope as { z?: unknown } | null)?.z === 1
      if (compressed && !hasCompression())
        throw new VaultError('unsupported', 'Сжатие не поддерживается этим браузером')
      const bytes = await openEnvelope(
        key,
        envelope as Envelope,
        aadFor(parsed.kind, parsed.deviceId, parsed.seq, compressed),
      )
      const plain = compressed ? await decompress(bytes) : bytes
      return parsePayload(new TextDecoder().decode(plain), parsed)
    },
  }
}
