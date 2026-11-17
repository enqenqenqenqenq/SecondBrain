import { useEffect } from 'react'
import './Toast.css'

export type ToastState = { kind: 'deleted'; id: string } | { kind: 'error' } | null

// Сообщение над нижним меню. Гаснет само через шесть секунд.
export default function Toast({
  toast,
  onUndo,
  onClose,
}: {
  toast: ToastState
  onUndo: (id: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(onClose, 6000)
    return () => clearTimeout(timer)
  }, [toast, onClose])

  return (
    <div className="toast-area" role="status" aria-live="polite">
      {toast?.kind === 'deleted' && (
        <div className="toast">
          <span>Запись удалена</span>
          <button type="button" onClick={() => onUndo(toast.id)}>
            Отменить
          </button>
        </div>
      )}
      {toast?.kind === 'error' && (
        <div className="toast">
          <span>Не удалось выполнить действие</span>
        </div>
      )}
    </div>
  )
}
