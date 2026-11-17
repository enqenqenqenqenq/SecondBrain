import { useEffect, useState } from 'react'

export type Route = 'entry' | 'feed' | 'unreviewed'

const read = (): Route => {
  if (window.location.hash === '#/feed') return 'feed'
  if (window.location.hash === '#/unreviewed') return 'unreviewed'
  return 'entry'
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
