import { VaultError } from '../crypto/vault'
import { META_NAME, parseName, segmentName, snapshotName } from './format'
import { emptyMeta } from './types'
import type { Codec, LocalStore, RemoteFile, RemoteStore, SyncMeta, SyncObject } from './types'

// Круг синхронизации. Схема и причины в docs/sync-design.txt: на Диске файлы только создаются и удаляются,
// каждое устройство пишет свои сегменты, раз в какое-то время делается снимок. Сначала получаем, потом отправляем.

export const SEGMENT_SIZE = 500 // объектов в одном сегменте
export const SNAPSHOT_AFTER = 100 // сегментов, не охваченных снимком, после которых делаем снимок
export const SNAPSHOT_EVERY_DAYS = 30
export const KEEP_DAYS = 7 // сколько дней живут файлы, охваченные снимком
const DAY = 24 * 3600 * 1000

export interface SyncDeps {
  local: LocalStore
  remote: RemoteStore
  codec: Codec
  now?: () => number
  // Вызывается сразу после списка файлов. Если бросает ошибку, круг прерывается до чтения и записи.
  // Так хранилище, созданное заново или повреждённое, замечается до того, как мы что-то отправим.
  inspect?: (files: RemoteFile[]) => Promise<void>
}

export interface SyncResult {
  pulled: number // файлов разобрано
  applied: number // объектов принято
  conflicts: number // из них конфликтов
  pushed: number // объектов отправлено
  snapshot: boolean // сделан ли снимок
  removed: number // убрано старых файлов
  errors: SyncProblem[] // файлы, которые не удалось прочитать
}

export interface SyncProblem {
  file: string
  code: 'bad-file' | 'newer-version' | 'gap' | 'other'
  message: string
}

const chunks = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

export async function runSync(deps: SyncDeps): Promise<SyncResult> {
  const { local, remote, codec } = deps
  const now = deps.now ?? Date.now
  const own = await local.deviceId()
  const meta: SyncMeta = await local.loadMeta()
  const result: SyncResult = {
    pulled: 0,
    applied: 0,
    conflicts: 0,
    pushed: 0,
    snapshot: false,
    removed: 0,
    errors: [],
  }
  const save = () => local.saveMeta(meta)

  const files = await remote.list()
  await deps.inspect?.(files)
  const parsed = files.flatMap((file) => {
    const p = parseName(file.name)
    return p ? [{ file, ...p }] : []
  })
  const segments = parsed.filter((p) => p.kind === 'segment')
  const snapshots = parsed.filter((p) => p.kind === 'snapshot')

  // Если мы уже писали на Диск, а сохранить номер не успели, продолжаем с наибольшего
  const ownMax = Math.max(0, ...segments.filter((s) => s.deviceId === own).map((s) => s.seq))
  meta.counter = Math.max(meta.counter, ownMax)

  const problem = (file: string, error: unknown) => {
    const code =
      error instanceof VaultError && (error.code === 'bad-file' || error.code === 'newer-version')
        ? error.code
        : 'other'
    result.errors.push({
      file,
      code,
      message: error instanceof Error ? error.message : String(error),
    })
  }

  // ---------- 1. получить ----------
  // Снимки по времени, самый старый первым. Применение любого файла безопасно повторять.
  for (const snap of [...snapshots].sort((a, b) => a.seq - b.seq)) {
    if (meta.snapshots.includes(snap.file.name)) continue
    try {
      const payload = await codec.decode(snap.file.name, await remote.read(snap.file.id))
      const report = await local.applyRemote(payload.objects)
      result.applied += report.applied
      result.conflicts += report.conflicts
      result.pulled++
      meta.snapshots.push(snap.file.name)
      // самый новый из применённых снимков определяет, что уже охвачено
      if (payload.covers && snap.seq > meta.coversAt) {
        meta.covers = payload.covers
        meta.coversAt = snap.seq
      }
      await save()
    } catch (error) {
      problem(snap.file.name, error)
    }
  }

  // Чужие сегменты по возрастанию номера. Дальше первой ошибки у устройства не идём, чтобы не пропустить файл.
  const byDevice = new Map<string, typeof segments>()
  for (const s of segments) {
    if (s.deviceId === own) continue
    byDevice.set(s.deviceId, [...(byDevice.get(s.deviceId) ?? []), s])
  }
  for (const [device, list] of byDevice) {
    for (const seg of list.sort((a, b) => a.seq - b.seq)) {
      const cursor = meta.cursor[device] ?? 0
      if (seg.seq <= cursor) continue
      // Пропущенные номера допустимы, только если их охватил снимок (старые файлы убираются после снимка).
      // Иначе файл с меньшим номером ещё не виден или пропал: дальше не идём, чтобы его потом не пропустить.
      if (seg.seq > cursor + 1 && seg.seq - 1 > (meta.covers[device] ?? 0)) {
        result.errors.push({
          file: seg.file.name,
          code: 'gap',
          message: 'Перед этим файлом нет предыдущего, его ещё не видно или он пропал',
        })
        break
      }
      try {
        const payload = await codec.decode(seg.file.name, await remote.read(seg.file.id))
        const report = await local.applyRemote(payload.objects)
        result.applied += report.applied
        result.conflicts += report.conflicts
        result.pulled++
        meta.cursor[device] = seg.seq
        await save()
      } catch (error) {
        problem(seg.file.name, error)
        break
      }
    }
  }

  // ---------- 2. отправить ----------
  const remoteEmpty = segments.length === 0 && snapshots.length === 0
  const dirty = await local.collectDirty()
  if (remoteEmpty && dirty.length > 0) {
    // Первое подключение: Диск пуст, всё местное уходит одним снимком
    await uploadSnapshot(deps, meta, await local.allObjects(), now())
    result.pushed += dirty.length
    result.snapshot = true
  } else if (dirty.length > 0) {
    for (const part of chunks(dirty, SEGMENT_SIZE)) {
      const counter = meta.counter + 1
      const name = segmentName(own, counter)
      const content = await codec.encode(name, {
        kind: 'segment',
        deviceId: own,
        seq: counter,
        createdAt: now(),
        objects: part,
      })
      await remote.create(name, content)
      // Только после успешной загрузки: иначе при обрыве изменения потерялись бы
      await local.markSynced(part)
      meta.counter = counter
      await save()
      result.pushed += part.length
    }
  }

  // ---------- 3. снимок и уборка ----------
  const covered = (s: { deviceId: string; seq: number }) => s.seq <= (meta.covers[s.deviceId] ?? 0)
  const uncovered =
    segments.filter((s) => !covered(s)).length +
    (meta.counter - ownMax > 0 ? meta.counter - ownMax : 0)
  const lastSnapshot = Math.max(0, ...snapshots.map((s) => s.seq), meta.lastSnapshotAt ?? 0)
  const stale =
    lastSnapshot > 0 && now() - lastSnapshot > SNAPSHOT_EVERY_DAYS * DAY && uncovered > 0
  if (!result.snapshot && (uncovered > SNAPSHOT_AFTER || stale)) {
    await uploadSnapshot(deps, meta, await local.allObjects(), now())
    result.snapshot = true
  }
  result.removed = await cleanup(deps, meta, [...snapshots], now())

  meta.lastAt = now()
  await save()
  return result
}

// Полный снимок состояния. covers записывает, до каких номеров сегментов он всё учитывает.
async function uploadSnapshot(deps: SyncDeps, meta: SyncMeta, objects: SyncObject[], time: number) {
  const own = await deps.local.deviceId()
  const name = snapshotName(time, own)
  const covers = { ...meta.cursor, [own]: meta.counter }
  const content = await deps.codec.encode(name, {
    kind: 'snapshot',
    deviceId: own,
    seq: time,
    createdAt: time,
    objects,
    covers,
  })
  await deps.remote.create(name, content)
  await deps.local.markSynced(objects)
  meta.snapshots.push(name)
  meta.covers = covers
  meta.coversAt = time
  meta.lastSnapshotAt = time
  await deps.local.saveMeta(meta)
}

// Старые файлы убираются не раньше, чем через KEEP_DAYS после снимка, который их охватывает: за неделю
// остальные устройства успевают забрать снимок, а одновременные снимки не теряют друг друга.
async function cleanup(
  deps: SyncDeps,
  meta: SyncMeta,
  snapshots: { file: RemoteFile; seq: number }[],
  time: number,
): Promise<number> {
  const old = snapshots
    .filter((s) => time - s.seq >= KEEP_DAYS * DAY)
    .sort((a, b) => b.seq - a.seq)[0]
  if (!old || old.file.name === meta.cleanedWith) return 0
  let covers: Record<string, number>
  try {
    const payload = await deps.codec.decode(old.file.name, await deps.remote.read(old.file.id))
    covers = payload.covers ?? {}
  } catch {
    return 0
  }
  let removed = 0
  const files = await deps.remote.list()
  for (const file of files) {
    const p = parseName(file.name)
    if (!p || file.name === META_NAME) continue
    const doomed = p.kind === 'segment' ? p.seq <= (covers[p.deviceId] ?? 0) : p.seq < old.seq
    if (!doomed) continue
    await deps.remote.delete(file.id)
    removed++
  }
  meta.cleanedWith = old.file.name
  await deps.local.saveMeta(meta)
  return removed
}

// «Отправить всё заново»: снимок из всех местных данных. Нужен, если файлы на Диске удалили или повредили.
export async function resendAll(deps: SyncDeps): Promise<void> {
  const meta = await deps.local.loadMeta()
  const files = await deps.remote.list()
  const own = await deps.local.deviceId()
  const ownMax = Math.max(
    0,
    ...files.flatMap((f) => {
      const p = parseName(f.name)
      return p && p.kind === 'segment' && p.deviceId === own ? [p.seq] : []
    }),
  )
  meta.counter = Math.max(meta.counter, ownMax)
  await uploadSnapshot(deps, meta, await deps.local.allObjects(), (deps.now ?? Date.now)())
}

export { emptyMeta }
