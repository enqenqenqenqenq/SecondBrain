import { useMemo } from 'react'
import NoteList from './NoteList'
import { isUnreviewed } from './storage'
import { useNotes } from './useNotes'
import { useNow } from './useNow'
import './Feed.css'

export default function Feed() {
  const { notes, failed } = useNotes()
  const now = useNow()
  const unreviewed = useMemo(() => notes?.filter(isUnreviewed).length ?? 0, [notes])

  return (
    <main className="feed">
      <h1>Лента</h1>

      {notes && (
        <a className="chip-link" href="#/unreviewed">
          Неразобранные <span className="badge">{unreviewed}</span>
        </a>
      )}

      {failed && <p className="empty">Не удалось прочитать записи</p>}
      {notes?.length === 0 && <p className="empty">Пока пусто</p>}
      {notes && <NoteList notes={notes} now={now} />}
    </main>
  )
}
