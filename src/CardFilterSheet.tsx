import { useEffect, useRef, useState } from 'react'
import { matchCards } from './cardSearch'
import type { Card } from './storage'
import './CardPicker.css'

// Окно выбора одного человека или одного места для фильтра ленты
export default function CardFilterSheet({
  title,
  cards,
  selectedId,
  onSelect,
  onClose,
}: {
  title: string
  cards: Card[]
  selectedId: string | null
  onSelect: (card: Card | null) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  const found = matchCards(cards, query)

  return (
    <dialog
      ref={ref}
      className="sheet picker"
      aria-labelledby="filter-sheet-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target !== ref.current) return
        const box = ref.current?.getBoundingClientRect()
        if (!box) return
        const outside =
          e.clientX < box.left ||
          e.clientX > box.right ||
          e.clientY < box.top ||
          e.clientY > box.bottom
        if (outside) onClose()
      }}
    >
      <div className="sheet-head">
        <h2 id="filter-sheet-title">{title}</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <input
        type="search"
        className="picker-search"
        placeholder="Имя или прозвище"
        aria-label="Имя или прозвище"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <ul className="picker-list">
        {found.map((card) => (
          <li key={card.id}>
            <button
              type="button"
              className="picker-choice"
              aria-pressed={card.id === selectedId}
              onClick={() => onSelect(card)}
            >
              <span className="picker-name">{card.name}</span>
              {card.aliases.length > 0 && (
                <span className="picker-sub">{card.aliases.join(', ')}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {found.length === 0 && <p className="empty">Пока пусто</p>}
      {selectedId && (
        <button type="button" className="settings-button secondary" onClick={() => onSelect(null)}>
          Сбросить
        </button>
      )}
    </dialog>
  )
}
