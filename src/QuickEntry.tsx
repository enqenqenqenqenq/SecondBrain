import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createNote, deleteNote } from './storage'
import { useNow } from './useNow'
import './QuickEntry.css'

type Notice = { kind: 'saved'; id: string; text: string } | { kind: 'error' } | null

const clock = (d: Date) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

export default function QuickEntry() {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const now = useNow()

  // Сообщение «Записано» гаснет само
  useEffect(() => {
    if (notice?.kind !== 'saved') return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  async function save() {
    const value = text.trim()
    if (!value || saving) return
    setSaving(true)
    // Поле очищается сразу: то, что человек успеет набрать дальше, не потеряется
    setText('')
    try {
      const note = await createNote(value)
      setNotice({ kind: 'saved', id: note.id, text: note.text })
    } catch {
      setText((current) => (current.trim() ? `${value}\n${current}` : value))
      setNotice({ kind: 'error' })
    } finally {
      setSaving(false)
      inputRef.current?.focus()
    }
  }

  // Отмена: запись удаляется, а текст возвращается в поле, чтобы мысль не пропала
  async function undo() {
    if (notice?.kind !== 'saved') return
    const { id, text: saved } = notice
    await deleteNote(id)
    setText((current) => (current.trim() ? `${saved}\n${current}` : saved))
    setNotice(null)
    inputRef.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void save()
    }
  }

  return (
    <main className="quick">
      <h1>Быстрая запись</h1>

      <label className="sr-only" htmlFor="quick-text">
        Текст заметки
      </label>
      <textarea
        id="quick-text"
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Заметка"
        autoFocus
      />

      <div className="chip">Сегодня, {clock(now)}</div>

      <button
        type="button"
        className="save"
        onClick={() => void save()}
        disabled={!text.trim() || saving}
        title="Ctrl+Enter"
      >
        Сохранить
      </button>

      <div className="notice" role="status" aria-live="polite">
        {notice?.kind === 'saved' && (
          <>
            <span>Записано</span>
            <button type="button" onClick={() => void undo()}>
              Отменить
            </button>
          </>
        )}
        {notice?.kind === 'error' && <span>Не удалось сохранить. Текст остался в поле.</span>}
      </div>
    </main>
  )
}
