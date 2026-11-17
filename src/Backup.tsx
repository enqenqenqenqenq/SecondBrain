import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { download } from './download'
import { addedTotal, backupFileName, describeAdded, previewLines } from './backupText'
import { exportData, exportText, importData, parseExport, serializeExport } from './storage'
import type { ImportReport, ParsedExport } from './storage'

// Файл больше этого размера не читаем: настоящая копия на двадцать тысяч записей около десяти мегабайт
const MAX_FILE_BYTES = 100 * 1024 * 1024

type Message = { kind: 'ok' | 'error'; text: string } | null
interface Pending {
  data: ParsedExport
  report: ImportReport
}

export default function Backup() {
  const [message, setMessage] = useState<Message>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pickerRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (pending && !dialogRef.current?.open) dialogRef.current?.showModal()
  }, [pending])

  async function save(kind: 'json' | 'txt') {
    setBusy(true)
    setMessage(null)
    try {
      const now = new Date()
      const file = await exportData(now)
      if (file.notes.length === 0 && file.cards.length === 0) {
        setMessage({ kind: 'ok', text: 'Пока нечего сохранять' })
        return
      }
      if (kind === 'json') {
        download(serializeExport(file), backupFileName(now, 'json'), 'application/json')
      } else {
        download(exportText(file), backupFileName(now, 'txt'), 'text/plain;charset=utf-8')
      }
      setMessage({ kind: 'ok', text: 'Файл сохранён' })
    } catch {
      setMessage({ kind: 'error', text: 'Не удалось сохранить файл' })
    } finally {
      setBusy(false)
    }
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // чтобы тот же файл можно было выбрать ещё раз
    if (!file) return
    setMessage(null)
    if (file.size > MAX_FILE_BYTES) {
      setMessage({ kind: 'error', text: 'Файл слишком большой для копии данных' })
      return
    }
    setBusy(true)
    try {
      const parsed = parseExport(await file.text())
      if (!parsed.ok) {
        setMessage({ kind: 'error', text: parsed.error })
        return
      }
      const report = await importData(parsed.data, { commit: false })
      if (addedTotal(report) === 0) {
        setMessage({ kind: 'ok', text: 'В файле нет ничего нового' })
        return
      }
      setPending({ data: parsed.data, report })
    } catch {
      setMessage({ kind: 'error', text: 'Не удалось прочитать файл' })
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!pending) return
    const { data } = pending
    dialogRef.current?.close()
    setPending(null)
    setBusy(true)
    try {
      setMessage({ kind: 'ok', text: describeAdded(await importData(data, { commit: true })) })
    } catch {
      setMessage({ kind: 'error', text: 'Не удалось загрузить данные, ничего не изменилось' })
    } finally {
      setBusy(false)
    }
  }

  function cancel() {
    dialogRef.current?.close()
    setPending(null)
  }

  return (
    <section aria-labelledby="settings-backup">
      <h2 id="settings-backup">Копия данных</h2>
      <div className="settings-buttons">
        <button
          type="button"
          className="settings-button"
          disabled={busy}
          onClick={() => void save('json')}
        >
          Сохранить копию
        </button>
        <button
          type="button"
          className="settings-button secondary"
          disabled={busy}
          onClick={() => void save('txt')}
        >
          Сохранить как текст
        </button>
        <button
          type="button"
          className="settings-button secondary"
          disabled={busy}
          onClick={() => pickerRef.current?.click()}
        >
          Загрузить из файла
        </button>
      </div>
      <input
        ref={pickerRef}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Файл копии данных"
        onChange={(e) => void onPick(e)}
      />
      <p className="hint">Файл не зашифрован. Храните его так, чтобы его не увидели чужие.</p>
      <div role="status" aria-live="polite">
        {message && (
          <p className={message.kind === 'error' ? 'settings-error' : 'hint'}>{message.text}</p>
        )}
      </div>

      <dialog ref={dialogRef} className="confirm" aria-labelledby="import-title" onCancel={cancel}>
        <h2 id="import-title">Загрузить данные из файла?</h2>
        <div className="backup-lines">
          {pending && previewLines(pending.report).map((line) => <p key={line}>{line}</p>)}
        </div>
        <div className="confirm-actions">
          <button type="button" onClick={cancel}>
            Отмена
          </button>
          <button type="button" className="accent-text" onClick={() => void confirm()}>
            Загрузить
          </button>
        </div>
      </dialog>
    </section>
  )
}
