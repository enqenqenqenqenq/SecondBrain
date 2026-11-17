import { useEffect, useState } from 'react'
import { BUILD } from './buildInfo'
import { formatBytes, readDeviceStorage, requestPersistence } from './deviceStorage'
import type { DeviceStorage } from './deviceStorage'
import { countNotes } from './storage'
import './Settings.css'

const SOURCE_URL = 'https://github.com/enqenqenqenqenq/SecondBrain'

export default function Settings() {
  const [count, setCount] = useState<number | null>(null)
  const [device, setDevice] = useState<DeviceStorage | null>(null)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    let alive = true
    countNotes()
      .then((n) => alive && setCount(n))
      .catch(() => {})
    void readDeviceStorage().then((info) => alive && setDevice(info))
    return () => {
      alive = false
    }
  }, [])

  async function protect() {
    const ok = await requestPersistence()
    setDenied(!ok)
    setDevice((current) => (current ? { ...current, persisted: ok } : current))
  }

  return (
    <main className="settings">
      <h1>Настройки</h1>

      <section aria-labelledby="settings-data">
        <h2 id="settings-data">Данные на этом устройстве</h2>
        <dl>
          <div>
            <dt>Записей</dt>
            <dd>{count ?? '…'}</dd>
          </div>
          {device !== null && device.usage !== null && (
            <div>
              <dt>Занято места</dt>
              <dd>{formatBytes(device.usage)}</dd>
            </div>
          )}
          {device !== null && device.persisted !== null && (
            <div>
              <dt>Защита от очистки</dt>
              <dd>{device.persisted ? 'Включена' : 'Выключена'}</dd>
            </div>
          )}
        </dl>
        {device?.persisted === false && (
          <button type="button" className="settings-button" onClick={() => void protect()}>
            Защитить данные от очистки
          </button>
        )}
        {denied && (
          <p className="hint">Браузер отказал. У установленного приложения он чаще соглашается.</p>
        )}
        <p className="hint">Записи хранятся только на этом устройстве.</p>
      </section>

      <section aria-labelledby="settings-about">
        <h2 id="settings-about">О приложении</h2>
        <dl>
          <div>
            <dt>Сборка</dt>
            <dd>{BUILD}</dd>
          </div>
          <div>
            <dt>Лицензия</dt>
            <dd>AGPL-3.0</dd>
          </div>
          <div>
            <dt>Исходный код</dt>
            <dd>
              <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
            </dd>
          </div>
        </dl>
      </section>
    </main>
  )
}
