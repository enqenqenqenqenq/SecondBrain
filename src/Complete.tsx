import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import CardPicker from './CardPicker'
import type { Picked } from './CardPicker'
import { isApproximate } from './noteFormat'
import { completeNote, describeEvent, getNote, listCards, listCardsOfNote } from './storage'
import type { Card, CardKind, EventTime, LinkRole, Note } from './storage'
import TimeSheet from './TimeSheet'
import { useNow } from './useNow'
import './NoteCard.css'
import './Complete.css'

// Привязка в черновике: существующая карточка или новая, которая создастся при сохранении
interface Item {
  key: string
  cardId?: string
  newCard?: { kind: CardKind; name: string }
  role: LinkRole | null
}

const ROLE_LABEL: Record<LinkRole, string> = { with: 'был со мной', mentioned: 'упомянут' }
// Роль по кругу: не указана, был со мной, упомянут
const NEXT_ROLE: Record<string, LinkRole | null> = {
  none: 'with',
  with: 'mentioned',
  mentioned: null,
}

// Назад в то место, откуда пришли, а по прямой ссылке в карточку записи
function leave(id: string) {
  if (window.history.length > 1) window.history.back()
  else window.location.hash = `#/note/${encodeURIComponent(id)}`
}

export default function Complete({ id }: { id: string }) {
  const [phase, setPhase] = useState<'loading' | 'missing' | 'ready'>('loading')
  const [note, setNote] = useState<Note | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [text, setText] = useState('')
  const [event, setEvent] = useState<EventTime | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [timeOpen, setTimeOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const now = useNow()

  useEffect(() => {
    let alive = true
    void (async () => {
      const found = await getNote(id)
      if (!alive) return
      if (!found) {
        setPhase('missing')
        return
      }
      const [attached, all] = await Promise.all([listCardsOfNote(id), listCards()])
      if (!alive) return
      setNote(found)
      setText(found.text)
      setEvent(found.event)
      setItems(attached.map((a) => ({ key: a.card.id, cardId: a.card.id, role: a.role })))
      setCards(all)
      setPhase('ready')
    })().catch(() => alive && setPhase('missing'))
    return () => {
      alive = false
    }
  }, [id])

  const back = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    leave(id)
  }

  if (phase === 'loading') return null
  if (phase === 'missing' || !note || !event) {
    return (
      <main className="card">
        <a className="back" href="#/feed" onClick={back}>
          ‹ Лента
        </a>
        <p className="empty">Запись не найдена</p>
      </main>
    )
  }

  const byId = new Map(cards.map((c) => [c.id, c]))
  const describe = (item: Item) => {
    const card = item.cardId ? byId.get(item.cardId) : undefined
    return {
      name: card?.name ?? item.newCard?.name ?? '',
      kind: card?.kind ?? item.newCard?.kind ?? 'person',
    }
  }
  const attachedIds = new Set(items.map((i) => i.cardId))
  const free = cards.filter((c) => !attachedIds.has(c.id))

  function pick(picked: Picked) {
    setPickerOpen(false)
    if ('newCard' in picked) {
      const { kind, name } = picked.newCard
      // Одну и ту же новую карточку дважды не создаём
      if (items.some((i) => i.newCard?.kind === kind && i.newCard.name === name)) return
      setItems((list) => [
        ...list,
        { key: crypto.randomUUID(), newCard: picked.newCard, role: picked.role },
      ])
    } else {
      setItems((list) => [
        ...list,
        { key: picked.cardId, cardId: picked.cardId, role: picked.role },
      ])
    }
  }

  const cycleRole = (key: string) =>
    setItems((list) =>
      list.map((i) => (i.key === key ? { ...i, role: NEXT_ROLE[i.role ?? 'none'] } : i)),
    )

  async function save() {
    if (saving || !text.trim() || !event) return
    setSaving(true)
    setError(false)
    const fresh = items.filter((i) => i.newCard)
    try {
      await completeNote(id, {
        text,
        event,
        newCards: fresh.map((i) => i.newCard!),
        links: items.map((i) =>
          i.cardId
            ? { cardId: i.cardId, role: i.role }
            : { newCard: fresh.indexOf(i), role: i.role },
        ),
      })
      leave(id)
    } catch {
      setError(true)
      setSaving(false)
    }
  }

  const approx = isApproximate({ ...note, event })

  return (
    <main className="card complete">
      <div className="bar">
        <button type="button" className="link-button" onClick={() => leave(id)}>
          Отмена
        </button>
        <h1>Дополнение</h1>
        <button
          type="button"
          className="link-button strong"
          disabled={saving || !text.trim()}
          onClick={() => void save()}
        >
          Готово
        </button>
      </div>

      <label className="sr-only" htmlFor="complete-text">
        Текст записи
      </label>
      <textarea
        id="complete-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void save()
          }
        }}
      />

      <h2 className="field-title">Время</h2>
      <span className={approx ? 'when approx' : 'when'}>{describeEvent(event, now)}</span>
      <p className="hint">
        {note.timeIsAuto && event === note.event && 'Время поставлено само. '}
        <button type="button" className="inline-link" onClick={() => setTimeOpen(true)}>
          Уточнить
        </button>
      </p>

      <h2 className="field-title">Люди и места</h2>
      <ul className="link-chips">
        {items.map((item) => {
          const { name, kind } = describe(item)
          return (
            <li key={item.key} className={`link-chip ${kind}`}>
              <span className="link-chip-name">{name}</span>
              {kind === 'person' && (
                <button
                  type="button"
                  className="link-chip-role"
                  aria-label={`Роль: ${item.role ? ROLE_LABEL[item.role] : 'не указана'}. Нажмите, чтобы изменить`}
                  onClick={() => cycleRole(item.key)}
                >
                  {item.role ? ROLE_LABEL[item.role] : 'роль'}
                </button>
              )}
              <button
                type="button"
                className="link-chip-remove"
                aria-label={`Убрать: ${name}`}
                onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}
              >
                ×
              </button>
            </li>
          )
        })}
        <li>
          <button type="button" className="link-chip add" onClick={() => setPickerOpen(true)}>
            + Добавить
          </button>
        </li>
      </ul>

      {error && <p className="empty">Не удалось сохранить. Всё введённое осталось на экране.</p>}

      {timeOpen && (
        <TimeSheet
          event={event}
          now={now}
          onSave={(next) => {
            setEvent(next)
            setTimeOpen(false)
          }}
          onClose={() => setTimeOpen(false)}
        />
      )}
      {pickerOpen && <CardPicker cards={free} onPick={pick} onClose={() => setPickerOpen(false)} />}
    </main>
  )
}
