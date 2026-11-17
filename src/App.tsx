import BottomNav from './BottomNav'
import Feed from './Feed'
import QuickEntry from './QuickEntry'
import { useHashRoute } from './useHashRoute'

export default function App() {
  const route = useHashRoute()
  return (
    <>
      {route === 'feed' ? <Feed /> : <QuickEntry />}
      <BottomNav route={route} />
    </>
  )
}
