import { useEffect, useState } from 'react'

export type Route =
  | { name: 'entry' }
  | { name: 'feed' }
  | { name: 'note'; id: string }
  | { name: 'complete'; id: string }
  | { name: 'settings' }
  | { name: 'dossier' }
  | { name: 'card'; id: string }
  | { name: 'dev' }

const read = (): Route => {
  const hash = window.location.hash
  if (hash === '#/feed') return { name: 'feed' }
  if (hash === '#/settings') return { name: 'settings' }
  if (hash === '#/dossier') return { name: 'dossier' }
  const card = /^#\/card\/(.+)$/.exec(hash)
  if (card) return { name: 'card', id: decodeURIComponent(card[1]) }
  // Служебная страница есть только при разработке
  if (hash === '#/dev' && import.meta.env.DEV) return { name: 'dev' }
  const complete = /^#\/complete\/(.+)$/.exec(hash)
  if (complete) return { name: 'complete', id: decodeURIComponent(complete[1]) }
  const note = /^#\/note\/(.+)$/.exec(hash)
  if (note) return { name: 'note', id: decodeURIComponent(note[1]) }
  return { name: 'entry' }
}

// Простая маршрутизация по части адреса после решётки, работает на GitHub Pages без настроек
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(read)
  useEffect(() => {
    const onChange = () => setRoute(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
