import { useEffect, useMemo, useState } from 'react'
import { matchCards } from './cardSearch'
import NewCardSheet from './NewCardSheet'
import { formatBirthday } from './noteFormat'
import { withUnit } from './plural'
import { describeEvent, watchCardStats } from './storage'
import type { Card, CardKind, CardStats } from './storage'
import { useCards } from './useCards'
import { useNow } from './useNow'
import './Dossier.css'

const NOTES: [string, string, string] = ['запись', 'записи', 'записей']

// Вкладка и поиск помнятся, пока приложение открыто: после карточки список возвращается в тот же вид
const saved: { kind: CardKind; query: string } = { kind: 'person', query: '' }

function useCardStats(): Map<string, CardStats> | null {
  const [stats, setStats] = useState<Map<string, CardStats> | null>(null)
  useEffect(() => watchCardStats(setStats), [])
  return stats
}

// Список досье: люди и места отдельными вкладками, поиск по имени и прозвищу
export default function DossierList() {
  const cards = useCards()
  const stats = useCardStats()
  const now = useNow()
  const [kind, setKind] = useState(saved.kind)
  const [query, setQuery] = useState(saved.query)
  const [creating, setCreating] = useState(false)

  const shown = useMemo(
    () =>
      cards
        ? matchCards(
            cards.filter((c) => c.kind === kind),
            query,
          )
        : null,
    [cards, kind, query],
  )

  function changeKind(value: CardKind) {
    saved.kind = value
    setKind(value)
  }
  function changeQuery(value: string) {
    saved.query = value
    setQuery(value)
  }

  const sub = (card: Card) => {
    const s = stats?.get(card.id)
    if (!stats) return ''
    if (!s) return 'Записей нет'
    return `${withUnit(s.count, NOTES)}, последняя ${s.last ? describeEvent(s.last, now) : ''}`
  }

  return (
    <main className="dossier">
      <h1>Досье</h1>

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
          aria-label="Поиск по именам и прозвищам"
          autoComplete="off"
        />
      </div>

      <div className="segmented" role="group" aria-label="Вид карточек">
        {(['person', 'place'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => changeKind(k)}>
            {k === 'person' ? 'Люди' : 'Места'}
          </button>
        ))}
      </div>

      <ul className="dossier-list">
        {shown?.map((card) => (
          <li key={card.id}>
            <a href={`#/card/${encodeURIComponent(card.id)}`} className="dossier-row">
              <span className="dossier-row-main">
                <span className="dossier-row-name">{card.name}</span>
                <span className="dossier-row-sub">{sub(card)}</span>
              </span>
              {card.birthday && (
                <span className="birthday-chip">
                  ДР {formatBirthday({ ...card.birthday, year: undefined })}
                </span>
              )}
              <span className="dossier-row-arrow" aria-hidden="true">
                ›
              </span>
            </a>
          </li>
        ))}
      </ul>
      {shown?.length === 0 && (
        <p className="empty">
          {cards && cards.some((c) => c.kind === kind) ? 'Ничего не найдено' : 'Пока пусто'}
        </p>
      )}

      <button
        type="button"
        className="fab"
        aria-label="Новая карточка"
        onClick={() => setCreating(true)}
      >
        +
      </button>
      {creating && <NewCardSheet initialKind={kind} onClose={() => setCreating(false)} />}
    </main>
  )
}
