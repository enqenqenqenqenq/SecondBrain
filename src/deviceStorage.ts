// Сведения о месте на устройстве и защита данных от очистки браузером

const UNITS = ['Б', 'КБ', 'МБ', 'ГБ']

// 1536 станет «1,5 КБ», 12 288 станет «12 КБ». Дробная часть только у малых значений.
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  let value = bytes
  let unit = 0
  // Округление не должно давать «1024 КБ»: такое значение уже считается следующей единицей
  while (Math.round(value) >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const shown = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${String(shown).replace('.', ',')} ${UNITS[unit]}`
}

export interface DeviceStorage {
  usage: number | null // сколько занято, байты
  persisted: boolean | null // защищены ли данные от очистки, пусто если браузер не умеет
}

export async function readDeviceStorage(): Promise<DeviceStorage> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
  const [estimate, persisted] = await Promise.all([
    storage?.estimate?.().catch(() => undefined),
    storage?.persisted?.().catch(() => undefined),
  ])
  return { usage: estimate?.usage ?? null, persisted: persisted ?? null }
}

// Просит браузер не стирать данные сайта самому. Ответ браузера может быть отказом.
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
