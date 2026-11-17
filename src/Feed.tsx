import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { describeEvent, watchNotes } from './storage'
import type { Note } from './storage'
import { useNow } from './useNow'
import './Feed.css'

// Сплошная плашка для точного времени, пунктирная для приблизительного
const isApproximate = (note: Note) =>
  note.event.precision !== 'minute' && note.event.precision !== 'day'

export default function Feed() {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [offset, setOffset] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const now = useNow()

  // Список обновляется сам, когда записи меняются
  useEffect(() => watchNotes(setNotes, () => setFailed(true)), [])

  // Высота шапки над списком нужна виртуальному списку, она известна, когда список появился
  const loaded = notes !== null
  useLayoutEffect(() => {
    setOffset(listRef.current?.offsetTop ?? 0)
  }, [loaded])

  // Виртуальный список: в странице только видимые записи, поэтому лента не тормозит на тысячах
  // React Compiler в проекте не используется, поэтому его предупреждение про эту библиотеку не нужно
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useWindowVirtualizer({
    count: notes?.length ?? 0,
    estimateSize: () => 76,
    overscan: 8,
    scrollMargin: offset,
  })

  return (
    <main className="feed">
      <h1>Лента</h1>

      {failed && <p className="empty">Не удалось прочитать записи</p>}
      {notes?.length === 0 && <p className="empty">Пока пусто</p>}

      <div ref={listRef} className="list" style={{ height: virtualizer.getTotalSize() }}>
        {notes &&
          virtualizer.getVirtualItems().map((item) => {
            const note = notes[item.index]
            return (
              <div
                key={note.id}
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
              </div>
            )
          })}
      </div>
    </main>
  )
}
