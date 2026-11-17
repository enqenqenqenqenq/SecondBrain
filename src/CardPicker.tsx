import { useEffect, useRef, useState } from 'react'
import { hasExactCard, matchCards } from './cardSearch'
import type { Picked } from './mentions'
import type { Card, CardKind, LinkRole } from './storage'
import './CardPicker.css'

export type { Picked } from './mentions'

const ROLES: { role: LinkRole; label: string }[] = [
  { role: 'with', label: 'Был со мной' },
  { role: 'mentioned', label: 'Упомянут' },
]

// Кнопки выбора: у человека две роли, у места одна кнопка
function Actions({
  kind,
  label,
  onPick,
}: {
  kind: CardKind
  label: string
  onPick: (role: LinkRole | null) => void
}) {
  return (
    <div className="picker-actions" role="group" aria-label={label}>
      {kind === 'person' ? (
        ROLES.map(({ role, label: text }) => (
          <button key={role} type="button" className="choice" onClick={() => onPick(role)}>
            {text}
          </button>
        ))
      ) : (
        <button type="button" className="choice" onClick={() => onPick(null)}>
          Добавить
        </button>
      )}
    </div>
  )
}

// Окно выбора человека или места. Можно найти существующего или завести нового, не выходя из записи.
export default function CardPicker({
  cards,
  onPick,
  onClose,
}: {
  cards: Card[] // карточки, которые ещё не добавлены к записи
  onPick: (picked: Picked) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  const found = matchCards(cards, query)
  const name = query.trim()
  // Новую карточку предлагаем, когда с таким именем её ещё нет (среди всех, кроме уже добавленных)
  const canCreate = name !== '' && !hasExactCard(cards, name)

  return (
    <dialog
      ref={ref}
      className="sheet picker"
      aria-labelledby="picker-title"
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
        <h2 id="picker-title">Люди и места</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <input
        type="search"
        className="picker-search"
        placeholder="Имя человека или места"
        aria-label="Имя человека или места"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      <ul className="picker-list">
        {found.map((card) => (
          <li key={card.id} className="picker-row">
            <div>
              <div className="picker-name">{card.name}</div>
              <div className="picker-sub">
                {card.kind === 'person' ? 'Человек' : 'Место'}
                {card.aliases.length > 0 && `, ${card.aliases.join(', ')}`}
              </div>
            </div>
            <Actions
              kind={card.kind}
              label={`Добавить: ${card.name}`}
              onPick={(role) => onPick({ cardId: card.id, role })}
            />
          </li>
        ))}
        {canCreate &&
          (['person', 'place'] as const).map((kind) => (
            <li key={kind} className="picker-row">
              <div>
                <div className="picker-name">{name}</div>
                <div className="picker-sub">
                  {kind === 'person' ? 'Новый человек' : 'Новое место'}
                </div>
              </div>
              <Actions
                kind={kind}
                label={`Создать: ${name}`}
                onPick={(role) => onPick({ newCard: { kind, name }, role })}
              />
            </li>
          ))}
      </ul>
      {found.length === 0 && !canCreate && <p className="empty">Пока пусто</p>}
    </dialog>
  )
}
