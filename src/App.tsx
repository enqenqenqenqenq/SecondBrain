import { useCallback, useState } from 'react'
import BottomNav from './BottomNav'
import Dev from './Dev'
import Feed from './Feed'
import NoteCard from './NoteCard'
import QuickEntry from './QuickEntry'
import Toast from './Toast'
import type { ToastState } from './Toast'
import Unreviewed from './Unreviewed'
import { deleteNote, restoreNote } from './storage'
import { useHashRoute } from './useHashRoute'

export default function App() {
  const route = useHashRoute()
  const [toast, setToast] = useState<ToastState>(null)
  const closeToast = useCallback(() => setToast(null), [])

  // Сначала уходим в ленту, потом удаляем: карточка не успевает показать «запись не найдена»
  async function remove(id: string) {
    window.location.hash = '#/feed'
    try {
      await deleteNote(id)
      setToast({ kind: 'deleted', id })
    } catch {
      setToast({ kind: 'error' })
    }
  }

  async function undoRemove(id: string) {
    setToast(null)
    try {
      await restoreNote(id)
    } catch {
      setToast({ kind: 'error' })
    }
  }

  return (
    <>
      {route.name === 'feed' && <Feed />}
      {route.name === 'unreviewed' && <Unreviewed />}
      {route.name === 'note' && <NoteCard id={route.id} onDelete={(id) => void remove(id)} />}
      {route.name === 'entry' && <QuickEntry />}
      {import.meta.env.DEV && route.name === 'dev' && <Dev />}
      <Toast toast={toast} onUndo={(id) => void undoRemove(id)} onClose={closeToast} />
      <BottomNav route={route} />
    </>
  )
}
