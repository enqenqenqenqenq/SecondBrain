// Номер сборки и дата подставляются при выкладке (см. .github/workflows/deploy.yml).
// При разработке их нет, тогда показываем «разработка».

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]

// Дата вида 2026-11-17 превращается в «17 ноября 2026». Всё, что на дату не похоже, возвращается как есть.
export function formatBuildDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date
  const month = MONTHS[Number(match[2]) - 1]
  return month ? `${Number(match[3])} ${month} ${match[1]}` : date
}

export function describeBuild(id: string | undefined, date: string | undefined): string {
  if (!id) return 'разработка'
  return date ? `${id}, ${formatBuildDate(date)}` : id
}

export const BUILD: string = describeBuild(
  import.meta.env.VITE_BUILD_ID,
  import.meta.env.VITE_BUILD_DATE,
)
