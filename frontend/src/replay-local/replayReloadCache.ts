// 渲染设置整页重载前，暂存「当前回放输入」并在重载后取回（一次性）。
//
// 为什么需要：Render 类设置（画质 / Log Depth / 动态分辨率 / 接地阴影）要重建 WebGL
// 上下文，播放中只能 location.replace() 整页重载。回放文件是用户在本机选择的 File，
// 只存在于内存，页面重载后无法自行恢复——若不暂存，用户会回到空工作台。
//
// 存储分工：
//   · IndexedDB 按**每次重载独立的 id** 存完整选择（多选批次 + 当前场次下标）；
//   · sessionStorage 只存本次标签页的待恢复 id，避免普通进入工作台时访问 IDB，也让
//     两个标签页各自重载时不会互相覆盖 / 消费对方的记录；
//   · 官方示例不存 File（重载后 WeakSet 身份会丢失，updateDemoFile 会拒绝），只存
//     kind=demo，重载后重新下载并按 manifest 校验，避免绕过完整性检查。
// 标记是一次性的：takeReloadReplay() 无论成败都先消费标记，恢复失败不会反复重试。
const DB_NAME = 'wotb-replay-reload'
const DB_VERSION = 1
const STORE_NAME = 'replays'
export const RELOAD_PENDING_KEY = 'wotb-replay-reload-pending'

export type StagedReplay =
  | { kind: 'demo', contactShadows: boolean }
  | { kind: 'files', files: File[], currentIndex: number, contactShadows: boolean }

export interface StagedReload { id: string, replay: StagedReplay }
export interface StageReplayInput {
  files: readonly File[]
  currentIndex: number
  demo?: boolean
  contactShadows?: boolean
}

interface StoredReload { replay: StagedReplay }

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'))
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
}

function writeRecord(db: IDBDatabase, id: string, record: StoredReload): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(record, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

function deleteRecord(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'))
  })
}

function takeRecord(db: IDBDatabase, id: string): Promise<StoredReload | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    let value: StoredReload | null = null
    const read = store.get(id)
    read.onsuccess = () => { value = (read.result as StoredReload | undefined) ?? null }
    store.delete(id)
    tx.oncomplete = () => resolve(value)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB read aborted'))
  })
}

function reloadId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ?? `reload-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isFileList(value: unknown): value is File[] {
  return Array.isArray(value) && value.length > 0
    && value.every(file => typeof File !== 'undefined' && file instanceof File)
}

function validReplay(value: unknown): value is StagedReplay {
  if (!value || typeof value !== 'object') return false
  const replay = value as StagedReplay
  if (replay.kind === 'demo') return true
  if (replay.kind !== 'files' || !isFileList(replay.files)) return false
  return Number.isInteger(replay.currentIndex)
    && replay.currentIndex >= 0 && replay.currentIndex < replay.files.length
}

/**
 * 重载前暂存完整回放选择。失败会抛出，由调用方中止重载并提示用户；
 * 绝不能先重载再发现没存上（那正是这个 P2 要修的数据丢失）。
 * @returns 本次暂存的 id；调用方在异步写入后若发现选择已变，用它只清理自己的记录。
 */
export async function stageReplayForReload(input: StageReplayInput): Promise<string> {
  if (typeof sessionStorage === 'undefined') throw new Error('sessionStorage unavailable')
  const demo = !!input.demo
  const files = demo ? [] : input.files.slice()
  if (!demo && files.length === 0) throw new Error('No replay files to stage')
  const currentIndex = demo ? 0 : Math.min(Math.max(0, Math.trunc(input.currentIndex)), files.length - 1)
  const contactShadows = input.contactShadows === true
  const replay: StagedReplay = demo
    ? { kind: 'demo', contactShadows }
    : { kind: 'files', files, currentIndex, contactShadows }
  const id = reloadId()
  const db = await openDb()
  try {
    await writeRecord(db, id, { replay })
    try {
      sessionStorage.setItem(RELOAD_PENDING_KEY, id)
    } catch (error) {
      try { await deleteRecord(db, id) } catch { /* 保留原始失败原因 */ }
      throw error
    }
  } finally {
    db.close()
  }
  return id
}

/**
 * 取回并消费上一次重载暂存的回放。没有待恢复 id 时直接返回 null，不访问 IndexedDB。
 * 每个标签页只读自己 sessionStorage 里的 id，因此多标签页重载不会互相覆盖。
 */
export async function takeReloadReplay(): Promise<StagedReload | null> {
  if (typeof sessionStorage === 'undefined') return null
  let id: string | null = null
  try { id = sessionStorage.getItem(RELOAD_PENDING_KEY) } catch { return null }
  if (!id) return null
  try { sessionStorage.removeItem(RELOAD_PENDING_KEY) } catch { /* 标记清理失败也不能重复恢复 */ }

  const db = await openDb()
  try {
    const record = await takeRecord(db, id)
    if (!record || !validReplay(record.replay)) return null
    return { id, replay: { ...record.replay, contactShadows: record.replay.contactShadows === true } }
  } finally {
    db.close()
  }
}

/** 暂存后又发现选择已变：只清理本次 id 对应的记录 / 标记，不影响其他标签页。 */
export async function discardReloadReplay(id: string): Promise<void> {
  try {
    const db = await openDb()
    try { await deleteRecord(db, id) } finally { db.close() }
  } catch { /* 清理失败不能掩盖原始中止原因 */ }
  try { if (sessionStorage.getItem(RELOAD_PENDING_KEY) === id) sessionStorage.removeItem(RELOAD_PENDING_KEY) } catch { /* ignore */ }
}
