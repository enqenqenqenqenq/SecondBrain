// Идентификатор из ключа: один и тот же ключ даёт один и тот же id на любом устройстве.
// Нужен объектам с правилом уникальности (связь), чтобы два устройства не создали дубль.
export async function idFromKey(key: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)),
  ).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50 // версия 5, вид UUID
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
