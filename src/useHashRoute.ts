import { useEffect, useState } from 'react'

export type Route = 'entry' | 'feed'

const read = (): Route => (window.location.hash === '#/feed' ? 'feed' : 'entry')

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
