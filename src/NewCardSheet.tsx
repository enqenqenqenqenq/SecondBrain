import { useEffect, useRef, useState } from 'react'
import { createCard } from './storage'
import type { CardKind } from './storage'
import './CardPicker.css'
import './Dossier.css'

// Окно новой карточки: вид, имя, «Создать». Всё остальное добавляется потом.
export default function NewCardSheet({
  initialKind,
  onClose,
}: {
  initialKind: CardKind
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [kind, setKind] = useState(initialKind)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  async function create() {
    const value = name.trim()
    if (!value || saving) return
    setSaving(true)
    setError(false)
    try {
      const card = await createCard({ kind, name: value })
      onClose()
      window.location.hash = `#/card/${encodeURIComponent(card.id)}`
    } catch {
      setError(true)
      setSaving(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="new-card-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target !== ref.current) return
        const box = ref.current?.getBoundingClientRect()
        if (!box) return
        const outside =
          e.clientX < box.left ||
          e.clientX > box.right ||
          e.clientY < box.top ||
          e.clientY > box.bottom
        if (outside) onClose()
      }}
    >
      <div className="sheet-head">
        <h2 id="new-card-title">Новая карточка</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <div className="segmented" role="group" aria-label="Вид карточки">
        {(['person', 'place'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === 'person' ? 'Человек' : 'Место'}
          </button>
        ))}
      </div>
      <input
        className="picker-search new-card-name"
        placeholder="Имя"
        aria-label="Имя"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void create()}
        autoFocus
      />
      <p className="hint">Остальное можно добавить позже.</p>
      {error && <p className="empty">Не удалось создать карточку</p>}
      <button
        type="button"
        className="settings-button"
        disabled={!name.trim() || saving}
        onClick={() => void create()}
      >
        Создать
      </button>
    </dialog>
  )
}
