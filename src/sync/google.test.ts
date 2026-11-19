import { afterEach, describe, expect, it } from 'vitest'
import { AuthError, googleAuth, isNativeApp } from './google'

const setNative = (value: boolean | undefined) => {
  const w = globalThis as unknown as { Capacitor?: unknown }
  if (value === undefined) delete w.Capacitor
  else w.Capacitor = { isNativePlatform: () => value }
}

afterEach(() => setNative(undefined))

describe('вход Google в установленном приложении Android', () => {
  it('в браузере приложение не считается установленным файлом', () => {
    expect(isNativeApp()).toBe(false)
    setNative(false)
    expect(isNativeApp()).toBe(false)
  })

  it('в установленном файле определяется по Capacitor', () => {
    setNative(true)
    expect(isNativeApp()).toBe(true)
  })

  it('окно входа не открывается, пользователь получает понятное объяснение', async () => {
    setNative(true)
    const auth = googleAuth('тестовый-клиент')
    for (const call of [() => auth.token(true), () => auth.token(false), () => auth.refresh()]) {
      const error = await call().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(AuthError)
      expect((error as AuthError).failure).toBe('blocked')
      expect((error as AuthError).message).toContain('Android')
    }
    expect(auth.hasToken()).toBe(false)
  })
})
