import { useDeferredValue, useMemo, useState } from 'react'
import NoteList from './NoteList'
import { foldedFor, matches, parseQuery } from './search'
import { isUnreviewed } from './storage'
import { useNotes } from './useNotes'
import { useNow } from './useNow'
import './Feed.css'

// Запрос помнится, пока приложение открыто: после карточки записи лента возвращается к тому же поиску
let lastQuery = ''

export default function Feed() {
  const { notes, failed } = useNotes()
  const now = useNow()
  const [query, setQuery] = useState(lastQuery)
  // Поле реагирует сразу, а список пересчитывается без задержки ввода
  const deferred = useDeferredValue(query)
  const words = useMemo(() => parseQuery(deferred), [deferred])

  const unreviewed = useMemo(() => notes?.filter(isUnreviewed).length ?? 0, [notes])
  const shown = useMemo(
    () =>
      words.length === 0
        ? notes
        : (notes?.filter((n) => matches(foldedFor(n.id, n.rev, n.text), words)) ?? null),
    [notes, words],
  )

  function change(value: string) {
    lastQuery = value
    setQuery(value)
  }

  return (
    <main className="feed">
      <h1>Лента</h1>

      <div className="search">
        <svg className="search-icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <line x1="12.7" y1="12.7" x2="17" y2="17" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && change('')}
          placeholder="Поиск"
          aria-label="Поиск по записям"
          enterKeyHint="search"
          autoComplete="off"
        />
      </div>

      {notes && (
        <a className="chip-link" href="#/unreviewed">
          Неразобранные <span className="badge">{unreviewed}</span>
        </a>
      )}

      {shown && <NoteList notes={shown} now={now} words={words} />}

      {failed && <p className="empty">Не удалось прочитать записи</p>}
      {notes?.length === 0 && <p className="empty">Пока пусто</p>}
      {notes && notes.length > 0 && shown?.length === 0 && (
        <p className="empty">Ничего не найдено</p>
      )}
    </main>
  )
}
