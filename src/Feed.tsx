import { useDeferredValue, useMemo, useState } from 'react'
import CardFilterSheet from './CardFilterSheet'
import { filterNotes } from './feedFilters'
import NoteList from './NoteList'
import { foldedFor, parseQuery } from './search'
import { describeEvent, isUnreviewed, yearEvent } from './storage'
import type { Card, EventTime } from './storage'
import TimeSheet from './TimeSheet'
import { useCardFeed, useCards } from './useCards'
import { useNotes } from './useNotes'
import { useNow } from './useNow'
import './Feed.css'

// Поиск и фильтры помнятся, пока приложение открыто: после карточки записи лента возвращается
// к тому же виду
const saved: {
  query: string
  unreviewed: boolean
  period: EventTime | null
  personId: string | null
  placeId: string | null
} = {
  query: '',
  unreviewed: false,
  period: null,
  personId: null,
  placeId: null,
}

// Кнопка фильтра с крестиком сброса
function Filter({
  label,
  active,
  onOpen,
  onClear,
  clearLabel,
}: {
  label: string
  active: boolean
  onOpen: () => void
  onClear: () => void
  clearLabel: string
}) {
  return (
    <span className="filter-group">
      <button type="button" className="filter" aria-pressed={active} onClick={onOpen}>
        {label}
      </button>
      {active && (
        <button type="button" className="filter-clear" aria-label={clearLabel} onClick={onClear}>
          ×
        </button>
      )}
    </span>
  )
}

export default function Feed() {
  const { notes, failed } = useNotes()
  const now = useNow()
  const [query, setQuery] = useState(saved.query)
  const [unreviewed, setUnreviewed] = useState(saved.unreviewed)
  const [period, setPeriod] = useState(saved.period)
  const [periodOpen, setPeriodOpen] = useState(false)
  const [chosenPerson, setPersonId] = useState(saved.personId)
  const [chosenPlace, setPlaceId] = useState(saved.placeId)
  const [chooser, setChooser] = useState<'person' | 'place' | null>(null)
  const cards = useCards()
  // Если выбранную карточку удалили, фильтр по ней не действует
  const exists = (id: string | null) =>
    id && cards?.some((c) => c.id === id) !== false ? id : null
  const personId = exists(chosenPerson)
  const placeId = exists(chosenPlace)
  const personFeed = useCardFeed(personId)
  const placeFeed = useCardFeed(placeId)
  // Поле реагирует сразу, а список пересчитывается без задержки ввода
  const deferred = useDeferredValue(query)
  const words = useMemo(() => parseQuery(deferred), [deferred])

  const unreviewedTotal = useMemo(() => notes?.filter(isUnreviewed).length ?? 0, [notes])
  // Записи выбранных людей и мест. Пока они читаются, список не показываем, чтобы он не мигал неотфильтрованным.
  const linkedReady =
    (personId === null || personFeed !== null) && (placeId === null || placeFeed !== null)
  const linked = useMemo(
    () =>
      [personFeed, placeFeed]
        .filter((feed) => feed !== null)
        .map((feed) => new Set(feed.map((e) => e.note.id))),
    [personFeed, placeFeed],
  )
  const filters = useMemo(
    () => ({ words, unreviewed, period, linked }),
    [words, unreviewed, period, linked],
  )
  const shown = useMemo(
    () =>
      notes && linkedReady
        ? filterNotes(notes, filters, (n) => foldedFor(n.id, n.rev, n.text))
        : null,
    [notes, filters, linkedReady],
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
  function changePerson(value: string | null) {
    saved.personId = value
    setPersonId(value)
  }
  function changePlace(value: string | null) {
    saved.placeId = value
    setPlaceId(value)
  }
  const nameOf = (id: string | null, fallback: string) =>
    (id && cards?.find((c) => c.id === id)?.name) || fallback

  const nothingFound = notes && notes.length > 0 && shown?.length === 0
  const onlyUnreviewed =
    unreviewed && !period && words.length === 0 && linked.length === 0 && unreviewedTotal === 0

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
            <Filter
              label={period ? describeEvent(period, now) : 'Период'}
              active={period !== null}
              onOpen={() => setPeriodOpen(true)}
              onClear={() => changePeriod(null)}
              clearLabel="Сбросить период"
            />
            <Filter
              label={nameOf(personId, 'Человек')}
              active={personId !== null}
              onOpen={() => setChooser('person')}
              onClear={() => changePerson(null)}
              clearLabel="Сбросить человека"
            />
            <Filter
              label={nameOf(placeId, 'Место')}
              active={placeId !== null}
              onOpen={() => setChooser('place')}
              onClear={() => changePlace(null)}
              clearLabel="Сбросить место"
            />
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

      {chooser && cards && (
        <CardFilterSheet
          title={chooser === 'person' ? 'Человек' : 'Место'}
          cards={cards.filter((c: Card) => c.kind === chooser)}
          selectedId={chooser === 'person' ? personId : placeId}
          onSelect={(card) => {
            if (chooser === 'person') changePerson(card?.id ?? null)
            else changePlace(card?.id ?? null)
            setChooser(null)
          }}
          onClose={() => setChooser(null)}
        />
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
