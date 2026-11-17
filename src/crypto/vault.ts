// Шифрование данных, которые уходят на Диск. Параметры и причины в docs/encryption-design.txt и решении 12.
// Всё делает встроенный Web Crypto, сторонних библиотек нет.

export const ITERATIONS = 600_000
export const MIN_ITERATIONS = 600_000
export const MAX_ITERATIONS = 10_000_000
export const CHECK_PHRASE = 'secondbrain-check-v1'

export type VaultErrorCode =
  | 'wrong-password' // пароль не подошёл к проверочной строке
  | 'bad-meta' // meta.json повреждён или небезопасен
  | 'newer-version' // файл сделан более новой версией приложения
  | 'bad-file' // файл не расшифровался: повреждён, подменён или другой ключ
  | 'unsupported' // в этой среде нет Web Crypto

export class VaultError extends Error {
  code: VaultErrorCode
  constructor(code: VaultErrorCode, message: string) {
    super(message)
    this.name = 'VaultError'
    this.code = code
  }
}

export interface Envelope {
  v: 1
  iv: string
  data: string
}

// Открытый файл хранилища: соль, число кругов и проверочная строка. Секретов в нём нет.
export interface VaultMeta {
  v: 1
  kdf: 'pbkdf2-sha256'
  iterations: number
  salt: string
  cipher: 'aes-256-gcm'
  check: Envelope
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function requireCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new VaultError('unsupported', 'В этой среде нет Web Crypto')
  return subtle
}

// Ключ из пароля. Неизвлекаемый: скрипт может им шифровать, но получить его байты не может.
async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const subtle = requireCrypto()
  const base = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function seal(key: CryptoKey, bytes: Uint8Array, aad: string): Promise<Envelope> {
  const subtle = requireCrypto()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
      key,
      bytes as BufferSource,
    ),
  )
  return { v: 1, iv: toBase64(iv), data: toBase64(data) }
}

const isEnvelope = (value: unknown): value is Envelope =>
  typeof value === 'object' &&
  value !== null &&
  (value as Envelope).v === 1 &&
  typeof (value as Envelope).iv === 'string' &&
  typeof (value as Envelope).data === 'string'

// Расшифровка. Ошибка здесь обычное событие (неверный пароль, повреждённый или подменённый файл).
export async function openEnvelope(
  key: CryptoKey,
  envelope: unknown,
  aad: string,
): Promise<Uint8Array> {
  const subtle = requireCrypto()
  if (typeof envelope === 'object' && envelope !== null && (envelope as { v?: unknown }).v !== 1) {
    const v = (envelope as { v?: unknown }).v
    if (typeof v === 'number' && v > 1) {
      throw new VaultError('newer-version', 'Файл сделан более новой версией приложения')
    }
  }
  if (!isEnvelope(envelope)) throw new VaultError('bad-file', 'Файл повреждён')
  try {
    const plain = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(envelope.iv) as BufferSource,
        additionalData: encoder.encode(aad),
      },
      key,
      fromBase64(envelope.data) as BufferSource,
    )
    return new Uint8Array(plain)
  } catch {
    throw new VaultError('bad-file', 'Файл не расшифровался')
  }
}

// Новое хранилище: соль, ключ и открытый файл с проверочной строкой
export async function createVault(
  password: string,
  iterations: number = ITERATIONS,
): Promise<{ meta: VaultMeta; key: CryptoKey }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(password, salt, iterations)
  const check = await seal(key, encoder.encode(CHECK_PHRASE), 'sb1|check')
  return {
    meta: {
      v: 1,
      kdf: 'pbkdf2-sha256',
      iterations,
      salt: toBase64(salt),
      cipher: 'aes-256-gcm',
      check,
    },
    key,
  }
}

// Проверка открытого файла хранилища. Чужой файл не должен ослабить ключ: число кругов не меньше нижней
// границы и не больше верхней (иначе вход зависнет).
export function checkMeta(meta: unknown, minIterations: number = MIN_ITERATIONS): VaultMeta {
  if (typeof meta !== 'object' || meta === null)
    throw new VaultError('bad-meta', 'Файл хранилища повреждён')
  const m = meta as Partial<VaultMeta>
  if (typeof m.v === 'number' && m.v > 1) {
    throw new VaultError('newer-version', 'Хранилище создано более новой версией приложения')
  }
  if (
    m.v !== 1 ||
    m.kdf !== 'pbkdf2-sha256' ||
    m.cipher !== 'aes-256-gcm' ||
    typeof m.salt !== 'string' ||
    !isEnvelope(m.check) ||
    typeof m.iterations !== 'number' ||
    !Number.isInteger(m.iterations)
  ) {
    throw new VaultError('bad-meta', 'Файл хранилища повреждён')
  }
  if (m.iterations < minIterations) {
    throw new VaultError('bad-meta', 'В файле хранилища слишком мало кругов, он небезопасен')
  }
  if (m.iterations > MAX_ITERATIONS) {
    throw new VaultError('bad-meta', 'В файле хранилища слишком много кругов')
  }
  try {
    if (fromBase64(m.salt).length !== 16) throw new Error('длина')
  } catch {
    throw new VaultError('bad-meta', 'Файл хранилища повреждён')
  }
  return m as VaultMeta
}

// Открывает хранилище паролем. Неверный пароль определяется по проверочной строке, до чтения данных.
export async function openVault(
  meta: unknown,
  password: string,
  minIterations: number = MIN_ITERATIONS,
): Promise<CryptoKey> {
  const checked = checkMeta(meta, minIterations)
  const key = await deriveKey(password, fromBase64(checked.salt), checked.iterations)
  try {
    const phrase = decoder.decode(await openEnvelope(key, checked.check, 'sb1|check'))
    if (phrase !== CHECK_PHRASE) throw new Error('фраза')
  } catch {
    throw new VaultError('wrong-password', 'Неверный пароль')
  }
  return key
}

// Грубая оценка пароля по длине и разнообразию. Слабый не запрещается, только предупреждается.
export type PasswordStrength = 'short' | 'weak' | 'normal' | 'good'

export function passwordStrength(password: string): PasswordStrength {
  const length = [...password].length
  if (length < 10) return 'short'
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}]/u].filter((r) =>
    r.test(password),
  ).length
  const unique = new Set(password).size
  if (length >= 16 || (length >= 12 && classes >= 3)) return unique >= 8 ? 'good' : 'normal'
  return classes >= 2 && unique >= 6 ? 'normal' : 'weak'
}
