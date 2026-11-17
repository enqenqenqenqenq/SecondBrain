import { useEffect, useRef, useState } from 'react'
import { passwordStrength } from './crypto/vault'
import { download } from './download'
import { backupFileName } from './backupText'
import { exportData, serializeExport } from './storage'
import { sync, useSync } from './sync'
import { STRENGTH, describeError, lastAtText, statusText } from './sync/messages'
import './SyncSection.css'

type Dialog = 'create' | 'enter' | 'restart' | 'disconnect' | null

// Раздел «Синхронизация» на экране настроек
export default function SyncSection() {
  const state = useSync()
  const { status } = state
  const [dialog, setDialog] = useState<Dialog>(null)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (dialog && !el.open) el.showModal()
    if (!dialog && el.open) el.close()
  }, [dialog])

  const reset = () => {
    setPassword('')
    setRepeat('')
    setError('')
    setSaved(false)
  }

  // Копия данных на случай, если пароль забудется: она остаётся у человека и не зашифрована
  const saveCopy = () =>
    run(async () => {
      const now = new Date()
      download(
        serializeExport(await exportData(now)),
        backupFileName(now, 'json'),
        'application/json',
      )
      setSaved(true)
    })

  async function changeRemember(value: boolean) {
    setError('')
    const result = await sync.setRemember(value)
    if (result === 'unsupported')
      setError('Браузер не позволил запомнить пароль на этом устройстве')
    if (result === 'needs-password') setError('Введите пароль, чтобы запомнить его')
  }
  const close = () => {
    setDialog(null)
    reset()
  }

  async function run(action: () => Promise<void>, onDone?: () => void) {
    setBusy(true)
    setError('')
    try {
      await action()
      onDone?.()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  const begin = () =>
    run(async () => {
      const step = await sync.beginConnect()
      reset()
      setDialog(step.needs === 'create' ? 'create' : 'enter')
    })

  const needsNew = dialog === 'create' || dialog === 'restart'
  const strength = passwordStrength(password)
  const canSubmit =
    !busy && password !== '' && (!needsNew || (strength !== 'short' && password === repeat))

  const submit = () => {
    if (!canSubmit) return
    if (dialog === 'create' || dialog === 'enter') {
      void run(() => sync.finishConnect(password, remember), close)
    } else if (dialog === 'restart') {
      void run(() => sync.restartVault(password, remember), close)
    }
  }

  const connected = status.kind !== 'off'

  return (
    <section aria-labelledby="settings-sync">
      <h2 id="settings-sync">Синхронизация</h2>

      <dl>
        <div>
          <dt>Google Диск</dt>
          <dd role="status">{statusText(status)}</dd>
        </div>
        {connected && state.lastAt !== null && (
          <div>
            <dt>Последний раз</dt>
            <dd>{lastAtText(state.lastAt)}</dd>
          </div>
        )}
        {connected && (
          <div>
            <dt>Ждёт отправки</dt>
            <dd>{state.pending}</dd>
          </div>
        )}
        {state.problems.length > 0 && (
          <div>
            <dt>Не прочитано файлов</dt>
            <dd>{state.problems.length}</dd>
          </div>
        )}
      </dl>

      {!connected && (
        <>
          <button
            type="button"
            className="settings-button"
            disabled={busy}
            onClick={() => void begin()}
          >
            Подключить Google Диск
          </button>
          <p className="hint">
            Данные шифруются на этом устройстве, на Диск уходит только шифр. Нужен пароль защиты.
          </p>
        </>
      )}

      {status.kind === 'signin' && (
        <button
          type="button"
          className="settings-button"
          disabled={busy}
          onClick={() => void run(() => sync.signIn())}
        >
          Войти в Google
        </button>
      )}

      {status.kind === 'password' && (
        <form
          className="sync-unlock"
          onSubmit={(e) => {
            e.preventDefault()
            if (password) void run(() => sync.unlock(password, remember), reset)
          }}
        >
          <input
            type="password"
            className="sync-input"
            autoComplete="current-password"
            placeholder="Пароль защиты"
            aria-label="Пароль защиты"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label className="sync-check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Запомнить на этом устройстве
          </label>
          <button type="submit" className="settings-button" disabled={busy || !password}>
            Открыть
          </button>
        </form>
      )}

      {connected && status.kind !== 'password' && (
        <label className="sync-check sync-remember">
          <input
            type="checkbox"
            checked={state.remember}
            onChange={(e) => void changeRemember(e.target.checked)}
          />
          Запоминать пароль на этом устройстве
        </label>
      )}

      {connected && status.kind !== 'password' && (
        <div className="settings-buttons">
          <button
            type="button"
            className="settings-button secondary"
            disabled={busy || status.kind === 'syncing'}
            onClick={() => void run(() => sync.syncNow('manual'))}
          >
            Синхронизировать
          </button>
          <details className="sync-more">
            <summary>Дополнительно</summary>
            <p className="hint">
              «Отправить всё заново» нужно, если файлы на Диске удалили. «Начать хранилище заново»
              удаляет файлы приложения на Диске и создаёт хранилище с новым паролем из данных этого
              устройства.
            </p>
            <button
              type="button"
              className="settings-button secondary"
              disabled={busy}
              onClick={() => void run(() => sync.resend())}
            >
              Отправить всё заново
            </button>
            <button
              type="button"
              className="settings-button secondary"
              disabled={busy}
              onClick={() => {
                reset()
                setDialog('restart')
              }}
            >
              Начать хранилище заново
            </button>
          </details>
          <button
            type="button"
            className="settings-button danger-outline"
            disabled={busy}
            onClick={() => setDialog('disconnect')}
          >
            Отключить
          </button>
        </div>
      )}

      {connected && status.kind === 'password' && (
        <div className="settings-buttons">
          <p className="hint">
            Забыли пароль? Восстановить его нельзя, но данные не потеряны, пока они есть на этом или
            на другом устройстве: можно начать хранилище заново с новым паролем.
          </p>
          <button
            type="button"
            className="settings-button secondary"
            disabled={busy}
            onClick={() => {
              reset()
              setDialog('restart')
            }}
          >
            Забыли пароль? Начать хранилище заново
          </button>
          <button
            type="button"
            className="settings-button danger-outline"
            disabled={busy}
            onClick={() => setDialog('disconnect')}
          >
            Отключить
          </button>
        </div>
      )}

      {error && dialog === null && <p className="settings-error">{error}</p>}

      <dialog
        ref={dialogRef}
        className="confirm sync-dialog"
        aria-labelledby="sync-dialog-title"
        onCancel={(e) => {
          e.preventDefault()
          if (!busy) close()
        }}
      >
        {dialog === 'disconnect' ? (
          <>
            <h2 id="sync-dialog-title">Отключить синхронизацию?</h2>
            <p>
              Данные на этом устройстве и файлы на Диске останутся. Новые записи перестанут уходить
              на Диск.
            </p>
            <div className="confirm-actions">
              <button type="button" onClick={close}>
                Отмена
              </button>
              <button
                type="button"
                className="danger-text"
                onClick={() => void run(() => sync.disconnect(), close)}
              >
                Отключить
              </button>
            </div>
          </>
        ) : (
          dialog && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <h2 id="sync-dialog-title">
                {dialog === 'create'
                  ? 'Придумайте пароль защиты'
                  : dialog === 'restart'
                    ? 'Новое хранилище'
                    : 'Введите пароль защиты'}
              </h2>
              <div className="sync-body">
                {dialog === 'create' && (
                  <>
                    <p>
                      Пароль шифрует данные. Забытый пароль восстановить нельзя, а без него данные
                      на Диске не прочитать.
                    </p>
                    <button
                      type="button"
                      className="sync-copy"
                      disabled={busy}
                      onClick={() => void saveCopy()}
                    >
                      {saved ? 'Копия сохранена' : 'Сохранить копию данных на всякий случай'}
                    </button>
                  </>
                )}
                {dialog === 'restart' && (
                  <p>
                    Файлы приложения на Диске будут удалены. Из данных этого устройства создастся
                    новое хранилище. Другим устройствам понадобится новый пароль.
                  </p>
                )}
                {dialog === 'enter' && (
                  <p>На Диске уже есть хранилище. Введите пароль, который задали при создании.</p>
                )}
                <input
                  type="password"
                  className="sync-input"
                  autoComplete={needsNew ? 'new-password' : 'current-password'}
                  placeholder="Пароль"
                  aria-label="Пароль"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
                {needsNew && (
                  <>
                    <input
                      type="password"
                      className="sync-input"
                      autoComplete="new-password"
                      placeholder="Пароль ещё раз"
                      aria-label="Пароль ещё раз"
                      value={repeat}
                      onChange={(e) => setRepeat(e.target.value)}
                    />
                    {password !== '' && <p className="sync-strength">{STRENGTH[strength]}</p>}
                    {repeat !== '' && password !== repeat && (
                      <p className="settings-error">Пароли не совпадают</p>
                    )}
                  </>
                )}
                <label className="sync-check">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  Запомнить на этом устройстве
                </label>
                {error && <p className="settings-error">{error}</p>}
              </div>
              <div className="confirm-actions">
                <button type="button" onClick={close} disabled={busy}>
                  Отмена
                </button>
                <button type="submit" className="accent-text" disabled={!canSubmit}>
                  {dialog === 'create'
                    ? 'Создать'
                    : dialog === 'restart'
                      ? 'Начать заново'
                      : 'Подключить'}
                </button>
              </div>
            </form>
          )
        )}
      </dialog>
    </section>
  )
}
