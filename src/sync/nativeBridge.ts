import type { NativeBridge } from './googleNative'

// Настоящее устройство: системный браузер, возврат по ссылке и запросы мимо ограничений браузера.
// Подключаются только когда приложение работает как установленный файл Android, в обычной сборке для сайта
// эти части не загружаются.
export function capacitorBridge(): NativeBridge {
  return {
    async open(url) {
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url })
    },
    async close() {
      const { Browser } = await import('@capacitor/browser')
      await Browser.close()
    },
    async onUrl(callback) {
      const { App } = await import('@capacitor/app')
      const handle = await App.addListener('appUrlOpen', (event) => callback(event.url))
      return () => void handle.remove()
    },
    async onBrowserClosed(callback) {
      const { Browser } = await import('@capacitor/browser')
      const handle = await Browser.addListener('browserFinished', () => callback())
      return () => void handle.remove()
    },
    async post(url, form) {
      const { CapacitorHttp } = await import('@capacitor/core')
      const response = await CapacitorHttp.post({
        url,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: form,
      })
      return { status: response.status, data: response.data }
    },
  }
}
