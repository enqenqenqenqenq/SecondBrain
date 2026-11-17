import type { Route } from './useHashRoute'
import './BottomNav.css'

const TABS: { route: Route; href: string; label: string }[] = [
  { route: 'entry', href: '#/', label: 'Запись' },
  { route: 'feed', href: '#/feed', label: 'Лента' },
]

export default function BottomNav({ route }: { route: Route }) {
  return (
    <nav className="nav" aria-label="Разделы">
      {TABS.map((tab) => (
        <a key={tab.route} href={tab.href} aria-current={tab.route === route ? 'page' : undefined}>
          <span className="nav-dot" />
          <span>{tab.label}</span>
        </a>
      ))}
    </nav>
  )
}
