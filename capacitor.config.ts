import type { CapacitorConfig } from '@capacitor/cli'

// Android-оболочка вокруг готового веб-приложения. Собранные файлы (dist) кладутся внутрь приложения,
// поэтому оно открывается и без интернета.
const config: CapacitorConfig = {
  appId: 'app.secondbrain.notes',
  appName: 'SecondBrain',
  webDir: 'dist',
  android: {
    // Подключение к нашему адресу по https, чтобы работали шифрование и хранилище
    allowMixedContent: false,
  },
}

export default config
