import { describe, expect, it } from 'vitest'
import { VaultError } from '../crypto/vault'
import { DriveError } from './drive'
import { AuthError } from './google'
import {
  STRENGTH,
  describeError,
  lastAtText,
  statusText,
  visualLabel,
  visualState,
  visualTitle,
} from './messages'

describe('тексты состояния', () => {
  it('у каждого состояния свой понятный текст', () => {
    expect(statusText({ kind: 'off' })).toBe('Не подключено')
    expect(statusText({ kind: 'idle' })).toBe('Синхронизировано')
    expect(statusText({ kind: 'syncing' })).toBe('Идёт синхронизация…')
    expect(statusText({ kind: 'offline' })).toContain('Нет связи')
    expect(statusText({ kind: 'signin' })).toContain('войти в Google')
    expect(statusText({ kind: 'password', reason: 'locked' })).toBe('Введите пароль защиты')
    expect(statusText({ kind: 'password', reason: 'changed' })).toContain('создано заново')
    expect(statusText({ kind: 'error', message: 'Сломалось' })).toBe('Сломалось')
  })

  it('визуальное состояние для значка соответствует четырём состояниям ФТ-Синхронизация-08', () => {
    // 1. Синхронизировано / передано
    expect(visualState({ kind: 'idle' })).toBe('synced')
    expect(visualLabel('synced')).toBe('Синхронизировано')

    // 2. Идёт передача
    expect(visualState({ kind: 'syncing' })).toBe('syncing')
    expect(visualLabel('syncing')).toBe('Идёт синхронизация…')

    // 3. Нет связи / нет сети
    expect(visualState({ kind: 'offline' })).toBe('offline')
    expect(visualLabel('offline')).toBe('Нет связи')

    // 4. Ошибка (включая необходимость входа и ввода пароля)
    expect(visualState({ kind: 'error', message: 'Сбой' })).toBe('error')
    expect(visualState({ kind: 'signin' })).toBe('error')
    expect(visualState({ kind: 'password', reason: 'locked' })).toBe('error')
    expect(visualState({ kind: 'password', reason: 'changed' })).toBe('error')
    expect(visualLabel('error')).toBe('Ошибка')

    // Выключено
    expect(visualState({ kind: 'off' })).toBe('off')
    expect(visualLabel('off')).toBe('Не подключено')
  })

  it('подсказки (visualTitle) содержат понятные описания для пользователя', () => {
    expect(visualTitle({ kind: 'idle' })).toBe('Синхронизировано')
    expect(visualTitle({ kind: 'syncing' })).toContain('Идёт синхронизация')
    expect(visualTitle({ kind: 'offline' })).toContain('Нет связи')
    expect(visualTitle({ kind: 'signin' })).toContain('войти в Google')
    expect(visualTitle({ kind: 'password', reason: 'locked' })).toContain('пароль')
    expect(visualTitle({ kind: 'error', message: 'Сеть недоступна' })).toBe(
      'Ошибка: Сеть недоступна',
    )
    expect(visualTitle({ kind: 'off' })).toContain('не подключена')
  })

  it('время последнего круга: пусто или дата со временем', () => {
    expect(lastAtText(null)).toBe('')
    const text = lastAtText(new Date(2026, 10, 17, 14, 5).getTime())
    expect(text).toContain('17 ноября')
    expect(text).toContain('14:05')
  })

  it('оценка пароля имеет текст для каждого уровня', () => {
    expect(Object.keys(STRENGTH).sort()).toEqual(['good', 'normal', 'short', 'weak'])
    expect(STRENGTH.short).toContain('10')
  })
})

describe('тексты ошибок', () => {
  it('пароль, вход, Диск', () => {
    expect(describeError(new VaultError('wrong-password', 'x'))).toBe('Неверный пароль')
    expect(describeError(new VaultError('bad-meta', 'Файл повреждён'))).toBe('Файл повреждён')
    expect(describeError(new AuthError('denied', 'x'))).toContain('Доступ к папке')
    expect(describeError(new AuthError('closed', 'x'))).toBe('Окно входа закрыто')
    expect(describeError(new AuthError('blocked', 'Заблокировано'))).toBe('Заблокировано')
    expect(describeError(new DriveError('network', 'x'))).toBe('Нет связи с Диском')
    expect(describeError(new DriveError('quota', 'x'))).toBe('На Google Диске нет места')
    expect(describeError(new DriveError('other', 'Диск ответил 400'))).toBe('Диск ответил 400')
  })

  it('прочее: текст ошибки или общий текст', () => {
    expect(describeError(new Error('Свой текст'))).toBe('Свой текст')
    expect(describeError('строка')).toBe('Не получилось')
    expect(describeError(null)).toBe('Не получилось')
  })
})
