import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import { formatBirthday } from './noteFormat'
import NoteList from './NoteList'
import { watchCard } from './storage'
import type { Card } from './storage'
import { useCardFeed } from './useCards'
import { useNow } from './useNow'
import './NoteCard.css'
import './Dossier.css'

// Назад в то место, откуда пришли, а если пришли по прямой ссылке, то в досье
function goBack(e: MouseEvent<HTMLAnchorElement>) {
  if (window.history.length > 1) {
    e.preventDefault()
    window.history.back()
  }
}

// Досье человека или места: данные карточки и лента записей, где он встречается. Лента собирается сама
// из связей, ничего вести вручную не нужно.
export default function CardPage({ id }: { id: string }) {
  // null: ещё читаем, undefined: такой карточки нет
  const [card, setCard] = useState<Card | undefined | null>(null)
  const feed = useCardFeed(id)
  const now = useNow()

  useEffect(() => watchCard(id, setCard, () => setCard(undefined)), [id])

  const notes = useMemo(() => feed?.map((e) => e.note) ?? [], [feed])
  const roles = useMemo(() => new Map(feed?.map((e) => [e.note.id, e.role]) ?? []), [feed])

  if (card === null) return null

  const back = (
    <a className="back" href="#/dossier" onClick={goBack}>
      ‹ Досье
    </a>
  )

  if (card === undefined) {
    return (
      <main className="card">
        {back}
        <p className="empty">Карточка не найдена</p>
      </main>
    )
  }

  const details: [string, string][] = [
    ...(card.birthday
      ? [['День рождения', formatBirthday(card.birthday)] as [string, string]]
      : []),
    ...(card.address ? [['Адрес', card.address] as [string, string]] : []),
    ...card.facts.map((f) => [f.label, f.value] as [string, string]),
  ]

  return (
    <main className="card dossier-card">
      {back}
      <p className="kind">{card.kind === 'person' ? 'Человек' : 'Место'}</p>
      <h1 className="dossier-name">{card.name}</h1>
      {card.aliases.length > 0 && <p className="aliases">{card.aliases.join(', ')}</p>}
      {card.description && <p className="description">{card.description}</p>}

      {details.length > 0 && (
        <dl className="details">
          {details.map(([label, value], i) => (
            <div key={`${i}-${label}`}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <h2 className="field-title">
        Записи <span className="count-badge">{feed?.length ?? 0}</span>
      </h2>
      {feed && feed.length > 0 && (
        <NoteList notes={notes} now={now} roles={card.kind === 'person' ? roles : undefined} />
      )}
      {feed?.length === 0 && <p className="empty">Пока пусто</p>}
    </main>
  )
}
