import { useId, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject, TextareaHTMLAttributes } from 'react'
import { hasExactCard, matchCards } from './cardSearch'
import { applyMention, findMention, mentionRole } from './mentions'
import type { Picked } from './mentions'
import type { Card, CardKind } from './storage'
import './MentionTextarea.css'

type Option = { type: 'card'; card: Card } | { type: 'new'; kind: CardKind }

const MAX_MATCHES = 6

// Поле текста с подсказкой при вводе «@». Под полем появляются подходящие люди и места, а если такого имени
// ещё нет, можно создать нового человека или место, не выходя из записи. Выбор вставляет «@Имя» в текст.
export default function MentionTextarea({
  cards,
  value,
  onChange,
  onPick,
  inputRef,
  onKeyDown,
  ...rest
}: {
  cards: Card[]
  value: string
  onChange: (value: string) => void
  onPick: (picked: Picked) => void
  inputRef?: RefObject<HTMLTextAreaElement | null>
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const ownRef = useRef<HTMLTextAreaElement>(null)
  const ref = inputRef ?? ownRef
  const listId = useId()
  const [caret, setCaret] = useState(value.length)
  // Закрытое Escape упоминание узнаём по тексту до него: другое упоминание на том же месте подсказку откроет
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [active, setActive] = useState(0)

  const mention = findMention(value, caret)
  const name = mention?.query ?? ''
  const options: Option[] = mention
    ? [
        ...matchCards(cards, name)
          .slice(0, MAX_MATCHES)
          .map((card): Option => ({ type: 'card', card })),
        ...(name !== '' && !hasExactCard(cards, name)
          ? (['person', 'place'] as const).map((kind): Option => ({ type: 'new', kind }))
          : []),
      ]
    : []
  const mentionKey = mention ? value.slice(0, mention.start + 1) : null
  const visible = mention !== null && dismissed !== mentionKey && options.length > 0
  const current = Math.min(active, Math.max(options.length - 1, 0))

  // Курсор сдвинулся. Если упоминания под ним больше нет, закрытое Escape забывается:
  // следующее упоминание откроет подсказку, даже если оно на том же месте
  function moveCaret(nextValue: string, nextCaret: number) {
    setCaret(nextCaret)
    if (findMention(nextValue, nextCaret) === null) setDismissed(null)
  }

  function choose(option: Option) {
    if (!mention) return
    const chosen = option.type === 'card' ? option.card.name : name
    const result = applyMention(value, mention, caret, chosen)
    setCaret(result.caret)
    // Когда текст в поле уже обновился, ставим курсор сразу за вставленным именем
    window.setTimeout(() => ref.current?.setSelectionRange(result.caret, result.caret), 0)
    setActive(0)
    onChange(result.text)
    if (option.type === 'card') {
      onPick({ cardId: option.card.id, role: mentionRole(option.card.kind) })
    } else {
      onPick({ newCard: { kind: option.kind, name }, role: mentionRole(option.kind) })
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (visible && mention) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : options.length - 1
        setActive((current + step) % options.length)
        return
      }
      if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') {
        e.preventDefault()
        choose(options[current])
        return
      }
      if (e.key === 'Escape') {
        // Закрывает подсказку, а не весь экран
        e.preventDefault()
        e.stopPropagation()
        setDismissed(mentionKey)
        return
      }
    }
    onKeyDown?.(e)
  }

  return (
    <div className="mention-wrap">
      <textarea
        {...rest}
        ref={ref}
        value={value}
        onChange={(e) => {
          moveCaret(e.target.value, e.target.selectionStart)
          setActive(0)
          onChange(e.target.value)
        }}
        onSelect={(e) => moveCaret(value, e.currentTarget.selectionStart)}
        onKeyDown={handleKeyDown}
        aria-autocomplete="list"
        aria-controls={visible ? listId : undefined}
        aria-activedescendant={visible ? `${listId}-${current}` : undefined}
      />
      {visible && (
        <ul id={listId} className="mention-list" role="listbox" aria-label="Люди и места">
          {options.map((option, i) => {
            const title = option.type === 'card' ? option.card.name : name
            const sub =
              option.type === 'card'
                ? `${option.card.kind === 'person' ? 'Человек' : 'Место'}${
                    option.card.aliases.length > 0 ? `, ${option.card.aliases.join(', ')}` : ''
                  }`
                : option.kind === 'person'
                  ? 'Новый человек'
                  : 'Новое место'
            return (
              <li
                key={option.type === 'card' ? option.card.id : `new-${option.kind}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === current}
                className="mention-option"
                // Нажатие не должно отнимать фокус у поля, иначе курсор потеряется
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(option)
                }}
              >
                <span className="mention-title">{title}</span>
                <span className="mention-sub">{sub}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
