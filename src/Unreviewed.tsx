import { useMemo } from 'react'
import NoteList from './NoteList'
import { isUnreviewed } from './storage'
import { useNotes } from './useNotes'
import { useNow } from './useNow'
import './Feed.css'

// Быстрые записи, которые ещё не дополнены: их дома разбирают и привязывают к людям и местам
export default function Unreviewed() {
  const { notes, failed } = useNotes()
  const now = useNow()
  const list = useMemo(() => notes?.filter(isUnreviewed) ?? null, [notes])

  return (
    <main className="feed">
      <a className="back" href="#/feed">
        ‹ Лента
      </a>
      <h1>Неразобранные {list && <span className="badge">{list.length}</span>}</h1>

      {failed && <p className="empty">Не удалось прочитать записи</p>}
      {list?.length === 0 && <p className="empty">Неразобранных нет</p>}
      {list && <NoteList notes={list} now={now} />}
    </main>
  )
}
