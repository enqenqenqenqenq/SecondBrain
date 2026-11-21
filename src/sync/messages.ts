import { VaultError, passwordStrength } from '../crypto/vault'
import type { Status } from './controller'
import { DriveError } from './drive'
import { AuthError } from './google'

// Тексты для экрана синхронизации

export const STRENGTH: Record<ReturnType<typeof passwordStrength>, string> = {
  short: 'Слишком короткий: нужно не меньше 10 знаков',
  weak: 'Слабый. Лучше фраза из нескольких слов',
  normal: 'Нормальный',
  good: 'Хороший',
}

export function statusText(status: Status): string {
  switch (status.kind) {
    case 'off':
      return 'Не подключено'
    case 'idle':
      return 'Синхронизировано'
    case 'syncing':
      return 'Идёт синхронизация…'
    case 'offline':
      return 'Нет связи. Изменения отправятся, когда сеть вернётся'
    case 'signin':
      return 'Нужно войти в Google'
    case 'password':
      return status.reason === 'changed'
        ? 'Хранилище на Диске создано заново или изменено. Введите пароль'
        : 'Введите пароль защиты'
    case 'error':
      return status.message
  }
}

// Визуальное состояние для понятного значка: синхронизировано, идёт, ошибка, нет связи, выключено
export type SyncVisualState = 'synced' | 'syncing' | 'offline' | 'error' | 'off'

export function visualState(status: Status): SyncVisualState {
  switch (status.kind) {
    case 'off':
      return 'off'
    case 'idle':
      return 'synced'
    case 'syncing':
      return 'syncing'
    case 'offline':
      return 'offline'
    case 'signin':
    case 'password':
    case 'error':
      return 'error'
  }
}

export function visualLabel(state: SyncVisualState): string {
  switch (state) {
    case 'synced':
      return 'Синхронизировано'
    case 'syncing':
      return 'Идёт синхронизация…'
    case 'offline':
      return 'Нет связи'
    case 'error':
      return 'Ошибка'
    case 'off':
      return 'Не подключено'
  }
}

export function visualTitle(status: Status): string {
  switch (status.kind) {
    case 'off':
      return 'Синхронизация не подключена'
    case 'idle':
      return 'Синхронизировано'
    case 'syncing':
      return 'Идёт синхронизация…'
    case 'offline':
      return 'Нет связи. Изменения отправятся, когда сеть вернётся'
    case 'signin':
      return 'Нужно войти в Google'
    case 'password':
      return status.reason === 'changed'
        ? 'Хранилище изменено. Введите пароль'
        : 'Введите пароль защиты'
    case 'error':
      return status.message ? `Ошибка: ${status.message}` : 'Ошибка синхронизации'
  }
}

export function describeError(error: unknown): string {
  if (error instanceof VaultError) {
    if (error.code === 'wrong-password') return 'Неверный пароль'
    return error.message
  }
  if (error instanceof AuthError) {
    if (error.failure === 'denied')
      return 'Доступ к папке приложения не выдан. Разрешите его при входе'
    if (error.failure === 'closed') return 'Окно входа закрыто'
    return error.message
  }
  if (error instanceof DriveError) {
    if (error.failure === 'network') return 'Нет связи с Диском'
    if (error.failure === 'quota') return 'На Google Диске нет места'
    return error.message
  }
  return error instanceof Error ? error.message : 'Не получилось'
}

export const lastAtText = (time: number | null) =>
  time === null
    ? ''
    : new Date(time).toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      })
