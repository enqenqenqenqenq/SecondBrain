import BottomNav from './BottomNav'
import Feed from './Feed'
import QuickEntry from './QuickEntry'
import Unreviewed from './Unreviewed'
import { useHashRoute } from './useHashRoute'

export default function App() {
  const route = useHashRoute()
  return (
    <>
      {route === 'feed' && <Feed />}
      {route === 'unreviewed' && <Unreviewed />}
      {route === 'entry' && <QuickEntry />}
      <BottomNav route={route} />
    </>
  )
}
