import { useEffect, useState } from 'react'
import { watchNotes } from './storage'
import type { Note } from './storage'

// Все записи из хранилища. Список обновляется сам, когда записи меняются.
export function useNotes() {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => watchNotes(setNotes, () => setFailed(true)), [])
  return { notes, failed }
}
