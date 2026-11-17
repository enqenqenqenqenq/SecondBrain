import { useEffect, useState } from 'react'

// Текущее время для подписей. Обновляется в начале каждой минуты и при возврате на вкладку,
// чтобы плашка совпадала со временем, которое получит запись.
export function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const untilNextMinute = () => 60_000 - (Date.now() % 60_000) + 50
    const tick = () => {
      setNow(new Date())
      timer = setTimeout(tick, untilNextMinute())
    }
    timer = setTimeout(tick, untilNextMinute())
    const onVisible = () => {
      if (!document.hidden) setNow(new Date())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return now
}
