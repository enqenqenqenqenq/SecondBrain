import { useState } from 'react'
import { countNotes, removeSeededNotes, seedNotes } from './storage'

// Служебная страница с тестовыми данными. Открывается только при npm run dev, по адресу #/dev.
export default function Dev() {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<string>) {
    setBusy(true)
    const started = performance.now()
    try {
      const result = await action()
      const seconds = ((performance.now() - started) / 1000).toFixed(1)
      setMessage(`${result}. Теперь записей: ${await countNotes()}. Заняло ${seconds} с.`)
    } catch {
      setMessage('Не получилось')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="card">
      <h1>Тестовые данные</h1>
      <div className="actions">
        {[500, 5000].map((count) => (
          <button
            key={count}
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void run(async () => `Добавлено ${await seedNotes(count)}`)}
          >
            Добавить {count}
          </button>
        ))}
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => void run(async () => `Убрано ${await removeSeededNotes()}`)}
        >
          Убрать тестовые
        </button>
      </div>
      <p className="hint" role="status">
        {message}
      </p>
    </main>
  )
}
