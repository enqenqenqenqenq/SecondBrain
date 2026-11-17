import { useDeferredValue, useMemo, useState } from 'react'
import { filterNotes } from './feedFilters'
import NoteList from './NoteList'
import { foldedFor, parseQuery } from './search'
import { describeEvent, isUnreviewed, yearEvent } from './storage'
import type { EventTime } from './storage'
import TimeSheet from './TimeSheet'
import { useNotes } from './useNotes'
import { useNow } from './useNow'
import './Feed.css'

// Поиск и фильтры помнятся, пока приложение открыто: после карточки записи лента возвращается
// к тому же виду
const saved: { query: string; unreviewed: boolean; period: EventTime | null } = {
  query: '',
  unreviewed: false,
  period: null,
}

export default function Feed() {
  const { notes, failed } = useNotes()
  const now = useNow()
  const [query, setQuery] = useState(saved.query)
  const [unreviewed, setUnreviewed] = useState(saved.unreviewed)
  const [period, setPeriod] = useState(saved.period)
  const [periodOpen, setPeriodOpen] = useState(false)
  // Поле реагирует сразу, а список пересчитывается без задержки ввода
  const deferred = useDeferredValue(query)
  const words = useMemo(() => parseQuery(deferred), [deferred])

  const unreviewedTotal = useMemo(() => notes?.filter(isUnreviewed).length ?? 0, [notes])
  const filters = useMemo(() => ({ words, unreviewed, period }), [words, unreviewed, period])
  const shown = useMemo(
    () => (notes ? filterNotes(notes, filters, (n) => foldedFor(n.id, n.rev, n.text)) : null),
    [notes, filters],
  )

  function changeQuery(value: string) {
    saved.query = value
    setQuery(value)
  }
  function changeUnreviewed(value: boolean) {
    saved.unreviewed = value
    setUnreviewed(value)
  }
  function changePeriod(value: EventTime | null) {
    saved.period = value
    setPeriod(value)
  }

  const nothingFound = notes && notes.length > 0 && shown?.length === 0
  const onlyUnreviewed = unreviewed && !period && words.length === 0 && unreviewedTotal === 0

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
          onChange={(e) => changeQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && changeQuery('')}
          placeholder="Поиск"
          aria-label="Поиск по записям"
          enterKeyHint="search"
          autoComplete="off"
        />
      </div>

      {notes && (
        <>
          <div className="filters">
            <span className="filter-group">
              <button
                type="button"
                className="filter"
                aria-pressed={period !== null}
                onClick={() => setPeriodOpen(true)}
              >
                {period ? describeEvent(period, now) : 'Период'}
              </button>
              {period && (
                <button
                  type="button"
                  className="filter-clear"
                  aria-label="Сбросить период"
                  onClick={() => changePeriod(null)}
                >
                  ×
                </button>
              )}
            </span>
            <button
              type="button"
              className="filter"
              aria-pressed={unreviewed}
              onClick={() => changeUnreviewed(!unreviewed)}
            >
              Неразобранные <span className="badge">{unreviewedTotal}</span>
            </button>
          </div>
          <p className="count" role="status">
            Записей: {shown?.length ?? 0}
          </p>
        </>
      )}

      {shown && <NoteList notes={shown} now={now} words={words} />}

      {failed && <p className="empty">Не удалось прочитать записи</p>}
      {notes?.length === 0 && <p className="empty">Пока пусто</p>}
      {nothingFound && (
        <p className="empty">{onlyUnreviewed ? 'Неразобранных нет' : 'Ничего не найдено'}</p>
      )}

      {periodOpen && (
        <TimeSheet
          title="Период"
          precisions={['day', 'month', 'season', 'year', 'range']}
          event={period ?? yearEvent(now.getFullYear())}
          now={now}
          onSave={(event) => {
            changePeriod(event)
            setPeriodOpen(false)
          }}
          onClose={() => setPeriodOpen(false)}
        />
      )}
    </main>
  )
}
