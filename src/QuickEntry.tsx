import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { buildCompletion, pruneMentions } from './mentions'
import type { Picked } from './mentions'
import MentionTextarea from './MentionTextarea'
import { completeNote, createNote, deleteNote } from './storage'
import { useCards } from './useCards'
import { useNow } from './useNow'
import './QuickEntry.css'

type Notice =
  | { kind: 'saved'; id: string; text: string; picked: Picked[]; unlinked: boolean }
  | { kind: 'error' }
  | null

const clock = (d: Date) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

export default function QuickEntry() {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [picked, setPicked] = useState<Picked[]>([])
  const cards = useCards()
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
    // Упоминания, которые из текста стёрли, не привязываем
    const mentions = pruneMentions(text, picked, cards ?? [])
    setText('')
    setPicked([])
    try {
      const note = await createNote(value)
      let unlinked = false
      if (mentions.length > 0) {
        try {
          await completeNote(note.id, buildCompletion([], mentions))
        } catch {
          unlinked = true
        }
      }
      setNotice({ kind: 'saved', id: note.id, text: note.text, picked: mentions, unlinked })
    } catch {
      setText((current) => (current.trim() ? `${value}\n${current}` : value))
      setPicked((current) => [...mentions, ...current])
      setNotice({ kind: 'error' })
    } finally {
      setSaving(false)
      inputRef.current?.focus()
    }
  }

  // Отмена: запись удаляется, а текст возвращается в поле, чтобы мысль не пропала
  async function undo() {
    if (notice?.kind !== 'saved') return
    const { id, text: saved, picked: savedPicked } = notice
    await deleteNote(id)
    setText((current) => (current.trim() ? `${saved}\n${current}` : saved))
    setPicked((current) => [...savedPicked, ...current])
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
      <MentionTextarea
        id="quick-text"
        inputRef={inputRef}
        cards={cards ?? []}
        value={text}
        onChange={setText}
        onPick={(p) => setPicked((list) => [...list, p])}
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
            <span>{notice.unlinked ? 'Записано, но упоминания не привязались' : 'Записано'}</span>
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
