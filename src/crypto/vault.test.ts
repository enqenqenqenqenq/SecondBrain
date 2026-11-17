import { describe, expect, it } from 'vitest'
import {
  ITERATIONS,
  MAX_ITERATIONS,
  VaultError,
  checkMeta,
  createVault,
  fromBase64,
  openEnvelope,
  openVault,
  passwordStrength,
  seal,
  toBase64,
} from './vault'

// Для проверок берём малое число кругов, чтобы набор шёл быстро. Нижняя граница настоящая проверяется отдельно.
const FAST = 1000
const create = (password: string) => createVault(password, FAST)
const open = (meta: unknown, password: string) => openVault(meta, password, FAST)
const code = async (p: Promise<unknown>) => {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof VaultError ? e.code : `другая ошибка: ${String(e)}`
  }
}
const bytes = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array) => new TextDecoder().decode(b)

describe('base64', () => {
  it('круг для коротких и больших данных, пустых тоже', () => {
    for (const size of [0, 1, 2, 3, 100, 70_000, 300_000]) {
      const data = new Uint8Array(size).map((_, i) => (i * 31) % 256)
      expect(fromBase64(toBase64(data))).toEqual(data)
    }
  })
})

describe('шифрование и расшифровка', () => {
  it('круг: текст, эмодзи, пустое, большое', async () => {
    const { key } = await create('верный пароль')
    for (const sample of ['запись', 'эмодзи 🙂 日本語', '', 'слово '.repeat(200_000)]) {
      const sealed = await seal(key, bytes(sample), 'sb1|segment|dev|1')
      expect(text(await openEnvelope(key, sealed, 'sb1|segment|dev|1'))).toBe(sample)
    }
  })

  it('шифр длиннее текста ровно на 16 байт', async () => {
    const { key } = await create('пароль для проверки')
    const sealed = await seal(key, bytes('двадцать байт текста'), 'a')
    expect(fromBase64(sealed.data).length).toBe(bytes('двадцать байт текста').length + 16)
  })

  it('на каждый раз новый вектор и новый шифр', async () => {
    const { key } = await create('пароль для проверки')
    const a = await seal(key, bytes('один и тот же'), 'a')
    const b = await seal(key, bytes('один и тот же'), 'a')
    expect(a.iv).not.toBe(b.iv)
    expect(a.data).not.toBe(b.data)
  })

  it('другие дополнительные данные ломают расшифровку: нельзя подменить номер или вид файла', async () => {
    const { key } = await create('пароль для проверки')
    const sealed = await seal(key, bytes('секрет'), 'sb1|segment|dev|7')
    expect(await code(openEnvelope(key, sealed, 'sb1|segment|dev|8'))).toBe('bad-file')
    expect(await code(openEnvelope(key, sealed, 'sb1|snapshot|dev|7'))).toBe('bad-file')
    expect(await code(openEnvelope(key, sealed, 'sb1|segment|other|7'))).toBe('bad-file')
    expect(await code(openEnvelope(key, sealed, 'sb1|segment|dev|7'))).toBe('ok')
  })

  it('испорченный байт, укороченный шифр и подменённый вектор ломают расшифровку', async () => {
    const { key } = await create('пароль для проверки')
    const sealed = await seal(key, bytes('секрет'), 'a')
    const data = fromBase64(sealed.data)
    data[2] ^= 1
    expect(await code(openEnvelope(key, { ...sealed, data: toBase64(data) }, 'a'))).toBe('bad-file')
    expect(
      await code(openEnvelope(key, { ...sealed, data: toBase64(data.slice(0, 8)) }, 'a')),
    ).toBe('bad-file')
    const iv = fromBase64(sealed.iv)
    iv[0] ^= 1
    expect(await code(openEnvelope(key, { ...sealed, iv: toBase64(iv) }, 'a'))).toBe('bad-file')
  })

  it('чужой ключ не расшифровывает', async () => {
    const one = await create('первый пароль')
    const two = await create('второй пароль')
    const sealed = await seal(one.key, bytes('секрет'), 'a')
    expect(await code(openEnvelope(two.key, sealed, 'a'))).toBe('bad-file')
  })

  it('мусор вместо оболочки: повреждённый файл, а версия новее отдельно', async () => {
    const { key } = await create('пароль для проверки')
    for (const junk of [
      null,
      undefined,
      'строка',
      5,
      {},
      { v: 1 },
      { v: 1, iv: 5, data: 'x' },
      [],
    ]) {
      expect(await code(openEnvelope(key, junk, 'a'))).toBe('bad-file')
    }
    expect(await code(openEnvelope(key, { v: 2, iv: 'x', data: 'y' }, 'a'))).toBe('newer-version')
  })

  it('ключ неизвлекаемый', async () => {
    const { key } = await create('пароль для проверки')
    expect(key.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow()
  })
})

describe('хранилище и пароль', () => {
  it('созданное хранилище открывается тем же паролем и шифрует одним ключом', async () => {
    const { meta, key } = await create('верный пароль')
    const reopened = await open(meta, 'верный пароль')
    const sealed = await seal(key, bytes('данные'), 'a')
    expect(text(await openEnvelope(reopened, sealed, 'a'))).toBe('данные')
  })

  it('неверный пароль и опечатка отклоняются, пустой тоже', async () => {
    const { meta } = await create('верный пароль')
    for (const bad of ['другой пароль', 'верный парол', 'Верный пароль', '', ' верный пароль']) {
      expect(await code(open(meta, bad))).toBe('wrong-password')
    }
  })

  it('проверочная строка чужого хранилища (другая соль) не открывается тем же паролем', async () => {
    const one = await create('один пароль')
    const two = await create('один пароль')
    expect(one.meta.salt).not.toBe(two.meta.salt)
    const swapped = { ...one.meta, check: two.meta.check }
    expect(await code(open(swapped, 'один пароль'))).toBe('wrong-password')
  })

  it('открытый файл не содержит ни пароля, ни ключа', async () => {
    const { meta } = await create('очень секретный пароль')
    const raw = JSON.stringify(meta)
    expect(raw).not.toContain('секретный')
    expect(Object.keys(meta).sort()).toEqual(['check', 'cipher', 'iterations', 'kdf', 'salt', 'v'])
    expect(fromBase64(meta.salt)).toHaveLength(16)
  })

  it('пароль с эмодзи и юникодом работает', async () => {
    const { meta } = await create('пароль 🙂 日本語 ñ')
    expect(await code(open(meta, 'пароль 🙂 日本語 ñ'))).toBe('ok')
  })

  it('настоящая нижняя граница 600 000 кругов: меньше отклоняется, ровно столько принимается', async () => {
    expect(ITERATIONS).toBe(600_000)
    const weak = await createVault('пароль для проверки', 599_999)
    expect(await code(openVault(weak.meta, 'пароль для проверки'))).toBe('bad-meta')
    const strong = await createVault('пароль для проверки', 600_000)
    expect(await code(openVault(strong.meta, 'пароль для проверки'))).toBe('ok')
  }, 30_000)
})

describe('проверка открытого файла хранилища', () => {
  it('слишком мало и слишком много кругов, пропущенные и испорченные поля', async () => {
    const { meta } = await create('пароль для проверки')
    expect(() => checkMeta({ ...meta, iterations: 1 }, 1000)).toThrow(VaultError)
    expect(() => checkMeta({ ...meta, iterations: MAX_ITERATIONS + 1 }, 1000)).toThrow(VaultError)
    expect(() => checkMeta({ ...meta, iterations: 1500.5 }, 1000)).toThrow(VaultError)
    expect(() => checkMeta({ ...meta, iterations: '1000' }, 1000)).toThrow(VaultError)
    for (const field of ['kdf', 'cipher', 'salt', 'check', 'iterations', 'v']) {
      const copy: Record<string, unknown> = { ...meta }
      delete copy[field]
      expect(() => checkMeta(copy, 1000), field).toThrow(VaultError)
    }
    expect(() => checkMeta({ ...meta, kdf: 'md5' }, 1000)).toThrow(VaultError)
    expect(() => checkMeta({ ...meta, cipher: 'rot13' }, 1000)).toThrow(VaultError)
    expect(() => checkMeta({ ...meta, salt: 'не base64!!' }, 1000)).toThrow(VaultError)
    expect(() => checkMeta({ ...meta, salt: toBase64(new Uint8Array(8)) }, 1000)).toThrow(
      VaultError,
    )
    for (const junk of [null, undefined, 'x', 5, [], {}])
      expect(() => checkMeta(junk, 1000)).toThrow(VaultError)
  })

  it('версия новее известной', async () => {
    const { meta } = await create('пароль для проверки')
    expect(await code(open({ ...meta, v: 2 }, 'пароль для проверки'))).toBe('newer-version')
  })

  it('исправный файл принимается', async () => {
    const { meta } = await create('пароль для проверки')
    expect(checkMeta(meta, FAST)).toEqual(meta)
  })
})

describe('оценка пароля', () => {
  it('короткий, слабый, нормальный, хороший', () => {
    expect(passwordStrength('')).toBe('short')
    expect(passwordStrength('abc123')).toBe('short')
    expect(passwordStrength('aaaaaaaaaaaa')).toBe('weak')
    expect(passwordStrength('password12')).toBe('normal')
    expect(passwordStrength('Горькая вишня 2026!')).toBe('good')
    expect(passwordStrength('четыре случайных слова вместе')).toBe('good')
  })

  it('эмодзи считается одним знаком', () => {
    expect(passwordStrength('🙂🙂🙂🙂🙂🙂🙂🙂🙂')).toBe('short')
  })
})
