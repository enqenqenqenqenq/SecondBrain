import { useLayoutEffect, useRef, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { isApproximate } from './noteFormat'
import { describeEvent } from './storage'
import type { Note } from './storage'
import './NoteList.css'

export default function NoteList({ notes, now }: { notes: Note[]; now: Date }) {
  const listRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)

  // Расстояние от верха страницы до списка нужно виртуальному списку для расчёта прокрутки.
  // Список появляется вместе с шапкой над ним, поэтому достаточно измерить один раз.
  useLayoutEffect(() => {
    setOffset(listRef.current ? listRef.current.getBoundingClientRect().top + window.scrollY : 0)
  }, [])

  // Виртуальный список: в странице только видимые записи, поэтому лента не тормозит на тысячах
  // React Compiler в проекте не используется, поэтому его предупреждение про эту библиотеку не нужно
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useWindowVirtualizer({
    count: notes.length,
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
            <div className="row-text">{note.text}</div>
            <span className={isApproximate(note) ? 'when approx' : 'when'}>
              {describeEvent(note.event, now)}
            </span>
          </a>
        )
      })}
    </div>
  )
}
