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
  markReviewed,
  resolveConflict,
  unmarkReviewed,
  updateNote,
  watchCardsOfNote,
  watchConflictCopies,
  watchNote,
} from './storage'
import type { CardOfNote, ConflictChoice, EventTime, Note } from './storage'
import TimeSheet from './TimeSheet'
import { useCards } from './useCards'
import { useNow } from './useNow'
import './NoteCard.css'

// Начало текста для сравнения версий
const snippet = (text: string) => (text.length > 160 ? `${text.slice(0, 160)}…` : text)

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
  const [markError, setMarkError] = useState(false)
  const [linked, setLinked] = useState<CardOfNote[]>([])
  const [mentions, setMentions] = useState<Picked[]>([])
  // Если запись это копия при конфликте, здесь запись, из которой она получилась. И копии этой записи.
  const [original, setOriginal] = useState<Note | undefined>(undefined)
  const [copies, setCopies] = useState<Note[]>([])
  const cards = useCards()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const now = useNow()

  useEffect(() => watchNote(id, setNote, () => setNote(undefined)), [id])
  useEffect(() => watchCardsOfNote(id, setLinked), [id])
  useEffect(() => watchConflictCopies(id, setCopies), [id])
  const conflictOf = note?.conflictOf ?? null
  useEffect(() => {
    if (!conflictOf) return
    return watchNote(conflictOf, setOriginal)
  }, [conflictOf])

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

  async function resolve(choice: ConflictChoice) {
    try {
      const { keptId } = await resolveConflict(id, choice)
      // Если эта копия убрана, переходим на оставшуюся запись
      if (keptId !== id) window.location.hash = `#/note/${encodeURIComponent(keptId)}`
    } catch {
      setError(true)
    }
  }

  function startEdit(current: Note) {
    setDraft(current.text)
    setMentions([])
    setError(false)
    setEditing(true)
  }

  // Отметка «дополнено» ставится и снимается сразу
  async function toggleReviewed(current: Note) {
    try {
      if (current.reviewedAt === null) await markReviewed(id)
      else await unmarkReviewed(id)
      setMarkError(false)
    } catch {
      setMarkError(true)
    }
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
      {note.conflictOf && (
        <section className="conflict" aria-labelledby="conflict-title">
          <h2 id="conflict-title">Копия при конфликте</h2>
          <p>Запись изменили на двух устройствах. Это одна из версий, ничего не потеряно.</p>
          {original && (
            <>
              <p className="conflict-label">Другая версия:</p>
              <a className="conflict-quote" href={`#/note/${encodeURIComponent(original.id)}`}>
                {snippet(original.text)}
              </a>
            </>
          )}
          <div className="conflict-actions">
            <button type="button" onClick={() => void resolve('copy')}>
              Оставить эту
            </button>
            {original && (
              <button type="button" onClick={() => void resolve('original')}>
                Оставить другую
              </button>
            )}
            <button type="button" onClick={() => void resolve('both')}>
              Оставить обе
            </button>
          </div>
        </section>
      )}
      {copies.length > 0 && (
        <section className="conflict" aria-labelledby="copies-title">
          <h2 id="copies-title">Есть копия при конфликте</h2>
          <p>Запись изменили на двух устройствах. Другая версия сохранена отдельно.</p>
          {copies.map((copy) => (
            <a
              key={copy.id}
              className="conflict-quote"
              href={`#/note/${encodeURIComponent(copy.id)}`}
            >
              {snippet(copy.text)}
            </a>
          ))}
        </section>
      )}
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
      {note.reviewedAt !== null && (
        <p className="hint reviewed">
          Дополнено: {describeEvent(eventAt(new Date(note.reviewedAt)), now)}
        </p>
      )}
      {markError && <p className="empty">Не удалось сохранить отметку</p>}

      <div className="actions">
        <a className="button primary" href={`#/complete/${encodeURIComponent(id)}`}>
          Дополнить
        </a>
        <button type="button" className="secondary" onClick={() => void toggleReviewed(note)}>
          {note.reviewedAt === null ? 'Отметить дополненной' : 'Снять отметку'}
        </button>
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
