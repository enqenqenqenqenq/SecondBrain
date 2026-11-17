// Служебные команды для разработки. Подключаются только при запуске npm run dev,
// в выложенное приложение не попадают.
import { removeSeededNotes, seedNotes } from './storage'

declare global {
  interface Window {
    seedNotes: (count?: number) => Promise<number>
    removeSeededNotes: () => Promise<number>
  }
}

window.seedNotes = (count = 5000) => seedNotes(count)
window.removeSeededNotes = removeSeededNotes

console.info(
  'SecondBrain, разработка: await seedNotes(5000) добавляет тестовые записи, ' +
    'await removeSeededNotes() убирает их. Страница с кнопками: #/dev',
)
