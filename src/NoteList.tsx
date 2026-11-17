import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { isApproximate } from './noteFormat'
import { findRanges, makeSnippet, splitByRanges } from './search'
import { describeEvent } from './storage'
import type { Note } from './storage'
import './NoteList.css'

// Текст записи. При поиске найденное подсвечивается, а у длинной записи виден кусок вокруг него.
function RowText({ text, words }: { text: string; words: string[] }) {
  if (words.length === 0) return <>{text}</>
  const snippet = makeSnippet(text, findRanges(text, words))
  return (
    <>
      {splitByRanges(snippet.text, snippet.ranges).map((part, i) =>
        part.mark ? <mark key={i}>{part.text}</mark> : part.text,
      )}
    </>
  )
}

export default function NoteList({
  notes,
  now,
  words = [],
}: {
  notes: Note[]
  now: Date
  words?: string[]
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)

  // Расстояние от верха страницы до списка нужно виртуальному списку для расчёта прокрутки.
  // Список появляется вместе с шапкой над ним, поэтому достаточно измерить один раз.
  useLayoutEffect(() => {
    setOffset(listRef.current ? listRef.current.getBoundingClientRect().top + window.scrollY : 0)
  }, [])

  // Высоты запоминаются по номеру записи, а не по её месту в списке: при поиске под тем же
  // местом оказывается другая запись, и чужая высота давала бы наложение строк
  const getItemKey = useCallback((index: number) => notes[index].id, [notes])

  // Виртуальный список: в странице только видимые записи, поэтому лента не тормозит на тысячах
  // React Compiler в проекте не используется, поэтому его предупреждение про эту библиотеку не нужно
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useWindowVirtualizer({
    count: notes.length,
    getItemKey,
    estimateSize: () => 76,
    overscan: 8,
    scrollMargin: offset,
  })

  return (
    <div ref={listRef} className="list" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const note = notes[item.index]
        return (
          <a
            key={note.id}
            href={`#/note/${encodeURIComponent(note.id)}`}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="row"
            style={{
              transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            <div className={words.length > 0 ? 'row-text searching' : 'row-text'}>
              <RowText text={note.text} words={words} />
            </div>
            <span className={isApproximate(note) ? 'when approx' : 'when'}>
              {describeEvent(note.event, now)}
            </span>
          </a>
        )
      })}
    </div>
  )
}
