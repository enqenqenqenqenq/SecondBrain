import { useEffect, useState } from 'react'

export type Route =
  { name: 'entry' } | { name: 'feed' } | { name: 'unreviewed' } | { name: 'note'; id: string }

const read = (): Route => {
  const hash = window.location.hash
  if (hash === '#/feed') return { name: 'feed' }
  if (hash === '#/unreviewed') return { name: 'unreviewed' }
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
