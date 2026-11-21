import { useSync, sync } from './sync'
import { visualLabel, visualState, visualTitle } from './sync/messages'
import SyncIcon from './SyncIcon'
import './SyncIndicator.css'

export default function SyncIndicator() {
  const { status, pending } = useSync()

  // Если синхронизация не подключена, не загромождаем экран
  if (status.kind === 'off') {
    return null
  }

  const vState = visualState(status)
  const label = visualLabel(vState)
  const title = visualTitle(status)

  const handleClick = () => {
    if (vState === 'error') {
      window.location.hash = '#/settings'
    } else {
      void sync.syncNow('indicator-click')
    }
  }

  return (
    <button
      type="button"
      className={`sync-indicator sync-indicator-${vState}`}
      onClick={handleClick}
      title={title}
      aria-label={`${label}${pending > 0 ? `, ждёт отправки: ${pending}` : ''}`}
      role="status"
    >
      <SyncIcon state={vState} size={16} />
      <span className="sync-indicator-label">{label}</span>
      {pending > 0 && <span className="sync-indicator-badge">{pending}</span>}
    </button>
  )
}
