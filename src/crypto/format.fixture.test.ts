import { describe, expect, it } from 'vitest'
import { makeCodec } from '../sync/format'
import { VaultError, openVault } from './vault'

// Образец, зашифрованный 2026-11-17 версией приложения, в которой формат был принят. Он обязан читаться
// и дальше: если эта проверка упала, формат изменили так, что уже выложенные на Диск файлы перестанут
// открываться. Менять образец нельзя, при смене формата нужна новая версия формата и миграция.
const PASSWORD = 'пример пароля для проверки формата'
const META = {
  v: 1,
  kdf: 'pbkdf2-sha256',
  iterations: 600000,
  salt: 'QfiqAUauDVqAxW9ZKTNc8w==',
  cipher: 'aes-256-gcm',
  check: { v: 1, iv: 'aQDXx8HBF1a5Nctw', data: 'Hl55P+5JSAoIuhguWJ9+Xe075prTp2IsWwO3QQfY0etXBfT7' },
}
const FILE =
  '{"v":1,"iv":"jjh17yNhjwdenlPe","data":"GMUqNhm744CGfuxPFsVclV+lNFw76fXsGrXKmMUGG325UEyqXHy4qFfNbBnWoBTOYyFY5a8gaYn0j8W7Gs9pfZtk3rMEapk0sDeg4nJlwJy0NckSsq1BLrTUHjYd5PYk7L7/BjAH/1rW3awxuYO4hX410vyef5Iou8YkMdHZRfbuB+ev6oqDyAUErOqJfQCsr49f0IhonYgLnr+mfSiCDip87k3jTM6bSNR7wcbECzueJiTuUCdflqyZ0DKaz0rZABm/B306PbYXkuZHfJo+if5quOvaaOQieGWbz7DVPRWOiDop5Bh8B5GHe4wYoTml5ud/AA5LCyRU6xMxd6ZR+LqkZkkqyrMZ2mFtECm4IR3b4wEnhu7KUCg8gv9oaI4WbKaBnontYGOZX/iE2JkVodyTieScEtPfImmeLTw4f8Y4tk9HWBAnpQ==","z":1}'
const NAME = 'seg-образец-000001.sb'

describe('образец формата файлов на Диске', () => {
  it('хранилище открывается паролем, а файл расшифровывается и читается', async () => {
    const key = await openVault(META, PASSWORD)
    const payload = await makeCodec(key).decode(NAME, FILE)
    expect(payload).toMatchObject({ kind: 'segment', deviceId: 'образец', seq: 1, invalid: 0 })
    expect(payload.objects).toHaveLength(1)
    const note = payload.objects[0].data
    expect(payload.objects[0].entity).toBe('note')
    expect('text' in note && note.text).toBe('Образец записи для проверки формата 🙂')
    expect(note.clock).toEqual({ образец: 1 })
  }, 15_000)

  it('другой пароль не открывает хранилище', async () => {
    await expect(openVault(META, 'другой пароль')).rejects.toMatchObject({ code: 'wrong-password' })
  }, 15_000)

  it('файл под другим именем (другой номер) не открывается', async () => {
    const key = await openVault(META, PASSWORD)
    await expect(makeCodec(key).decode('seg-образец-000002.sb', FILE)).rejects.toBeInstanceOf(
      VaultError,
    )
  }, 15_000)
})
