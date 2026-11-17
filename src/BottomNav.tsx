import type { Route } from './useHashRoute'
import './BottomNav.css'

const TABS: { route: 'entry' | 'feed'; href: string; label: string }[] = [
  { route: 'entry', href: '#/', label: 'Запись' },
  { route: 'feed', href: '#/feed', label: 'Лента' },
]

export default function BottomNav({ route }: { route: Route }) {
  // Неразобранные записи открываются из ленты, поэтому подсвечиваем вкладку «Лента»
  const tab = route === 'unreviewed' ? 'feed' : route
  return (
    <nav className="nav" aria-label="Разделы">
      {TABS.map((item) => (
        <a key={item.route} href={item.href} aria-current={item.route === tab ? 'page' : undefined}>
          <span className="nav-dot" />
          <span>{item.label}</span>
        </a>
      ))}
    </nav>
  )
}
