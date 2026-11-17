import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { buildCompletion, pruneMentions, splitMentions } from './mentions'
import type { Picked } from './mentions'
import MentionTextarea from './MentionTextarea'
import { isApproximate } from './noteFormat'
import {
  completeNote,
  describeEvent,
  eventAt,
  updateNote,
  watchCardsOfNote,
  watchNote,
} from './storage'
import type { CardOfNote, EventTime, Note } from './storage'
import TimeSheet from './TimeSheet'
import { useCards } from './useCards'
import { useNow } from './useNow'
import './NoteCard.css'

// Назад в то место, откуда пришли, а если пришли по прямой ссылке, то в ленту
function goBack(e: MouseEvent<HTMLAnchorElement>) {
  if (window.history.length > 1) {
    e.preventDefault()
    window.history.back()
  }
}

export default function NoteCard({ id, onDelete }: { id: string; onDelete: (id: string) => void }) {
  // null: ещё читаем, undefined: такой записи нет
  const [note, setNote] = useState<Note | undefined | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(false)
  const [timeOpen, setTimeOpen] = useState(false)
  const [linked, setLinked] = useState<CardOfNote[]>([])
  const [mentions, setMentions] = useState<Picked[]>([])
  const cards = useCards()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const now = useNow()

  useEffect(() => watchNote(id, setNote, () => setNote(undefined)), [id])
  useEffect(() => watchCardsOfNote(id, setLinked), [id])

  if (note === null) return null

  const back = (
    <a className="back" href="#/feed" onClick={goBack}>
      ‹ Лента
    </a>
  )

  if (note === undefined) {
    return (
      <main className="card">
        {back}
        <p className="empty">Запись не найдена</p>
      </main>
    )
  }

  function startEdit(current: Note) {
    setDraft(current.text)
    setMentions([])
    setError(false)
    setEditing(true)
  }

  async function saveEdit(current: Note) {
    const value = draft.trim()
    if (!value) return
    // Упоминания, которые из текста стёрли, не привязываем
    const picked = pruneMentions(draft, mentions, cards ?? [])
    if (value === current.text && picked.length === 0) {
      setEditing(false)
      return
    }
    try {
      if (picked.length === 0) {
        await updateNote(id, { text: value })
      } else {
        const base = linked.map((l) => ({ cardId: l.card.id, role: l.role }))
        await completeNote(id, { text: value, ...buildCompletion(base, picked) })
      }
      setEditing(false)
    } catch {
      setError(true)
    }
  }

  // Время меняется отдельным окном и сохраняется сразу, текст правится отдельно
  async function saveTime(event: EventTime) {
    setTimeOpen(false)
    try {
      await updateNote(id, { event })
      setError(false)
    } catch {
      setError(true)
    }
  }

  if (editing) {
    return (
      <main className="card">
        <div className="bar">
          <button type="button" className="link-button" onClick={() => setEditing(false)}>
            Отмена
          </button>
          <h1>Правка</h1>
          <button
            type="button"
            className="link-button strong"
            disabled={!draft.trim()}
            onClick={() => void saveEdit(note)}
          >
            Готово
          </button>
        </div>
        <label className="sr-only" htmlFor="note-draft">
          Текст записи
        </label>
        <MentionTextarea
          id="note-draft"
          cards={cards ?? []}
          value={draft}
          onChange={setDraft}
          onPick={(p) => setMentions((list) => [...list, p])}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false)
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void saveEdit(note)
            }
          }}
          autoFocus
        />
        {error && <p className="empty">Не удалось сохранить. Текст остался в поле.</p>}
      </main>
    )
  }

  return (
    <main className="card">
      {back}
      <h1>Запись</h1>
      <p className="card-text">
        {splitMentions(
          note.text,
          linked.map((l) => ({ id: l.card.id, name: l.card.name })),
        ).map((part, i) =>
          part.cardId ? (
            <a key={i} className="mention" href={`#/card/${encodeURIComponent(part.cardId)}`}>
              {part.text}
            </a>
          ) : (
            part.text
          ),
        )}
      </p>

      <span className={isApproximate(note) ? 'when approx' : 'when'}>
        {describeEvent(note.event, now)}
      </span>
      <p className="hint">
        {note.timeIsAuto && 'Время поставлено само. '}
        <button type="button" className="inline-link" onClick={() => setTimeOpen(true)}>
          Уточнить
        </button>
      </p>
      {error && <p className="empty">Не удалось сохранить время</p>}

      {linked.length > 0 && (
        <ul className="link-chips card-links" aria-label="Люди и места">
          {linked.map(({ card, role }) => (
            <li key={card.id}>
              <a className="link-chip" href={`#/card/${encodeURIComponent(card.id)}`}>
                <span className="link-chip-name">{card.name}</span>
                {card.kind === 'person' && role && (
                  <span className="link-chip-role-text">
                    {role === 'with' ? 'был со мной' : 'упомянут'}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}

      <p className="hint">Записано: {describeEvent(eventAt(new Date(note.createdAt)), now)}</p>

      <div className="actions">
        <a className="button primary" href={`#/complete/${encodeURIComponent(id)}`}>
          Дополнить
        </a>
        <button type="button" className="secondary" onClick={() => startEdit(note)}>
          Изменить
        </button>
        <button type="button" className="danger" onClick={() => dialogRef.current?.showModal()}>
          Удалить
        </button>
      </div>

      {timeOpen && (
        <TimeSheet
          event={note.event}
          now={now}
          onSave={(event) => void saveTime(event)}
          onClose={() => setTimeOpen(false)}
        />
      )}

      <dialog ref={dialogRef} className="confirm" aria-labelledby="confirm-title">
        <h2 id="confirm-title">Удалить запись?</h2>
        <p>Её можно будет вернуть сразу после удаления.</p>
        <div className="confirm-actions">
          <button type="button" onClick={() => dialogRef.current?.close()}>
            Отмена
          </button>
          <button
            type="button"
            className="danger-text"
            onClick={() => {
              dialogRef.current?.close()
              onDelete(id)
            }}
          >
            Удалить
          </button>
        </div>
      </dialog>
    </main>
  )
}
