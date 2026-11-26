// 渲染设置整页重载前，暂存「当前回放输入」并在重载后取回（一次性）。
//
// 为什么需要：Render 类设置（画质 / Log Depth / 动态分辨率 / 接地阴影）要重建 WebGL
// 上下文，播放中只能 location.replace() 整页重载。回放文件是用户在本机选择的 File，
// 只存在于内存，页面重载后无法自行恢复——若不暂存，用户会回到空工作台。
//
// 存储分工：
//   · IndexedDB 存 File 本身（结构化克隆支持 File/Blob，不复制字节到内存字符串）；
//   · sessionStorage 只存「本次重载有一次待恢复」的标记，避免普通进入工作台时访问 IDB。
// 标记是一次性的：takeReloadReplay() 无论成败都先消费标记，重载恢复失败不会反复重试。
// 官方示例不存 File（重载后 WeakSet 身份会丢失，updateDemoFile 会拒绝），只存 kind=demo，
// 重载后重新下载并按 manifest 校验，避免绕过官方示例的完整性检查。
const DB_NAME = 'wotb-replay-reload'
const DB_VERSION = 1
const STORE_NAME = 'replays'
const RECORD_KEY = 'current'
export const RELOAD_PENDING_KEY = 'wotb-replay-reload-pending'

export type StagedReplay = { kind: 'demo' } | { kind: 'file', file: File }

interface StoredReplay { kind: 'demo' | 'file', file?: File }

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

function writeRecord(db: IDBDatabase, record: StoredReplay): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(record, RECORD_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

function deleteRecord(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(RECORD_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'))
  })
}

function takeRecord(db: IDBDatabase): Promise<StoredReplay | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    let value: StoredReplay | null = null
    const read = store.get(RECORD_KEY)
    read.onsuccess = () => { value = (read.result as StoredReplay | undefined) ?? null }
    store.delete(RECORD_KEY)
    tx.oncomplete = () => resolve(value)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB read aborted'))
  })
}

/**
 * 重载前暂存当前回放。失败会抛出，由调用方中止重载并提示用户；
 * 绝不能先重载再发现没存上（那正是这个 P2 要修的数据丢失）。
 */
export async function stageReplayForReload(file: File, { demo = false }: { demo?: boolean } = {}): Promise<void> {
  if (typeof sessionStorage === 'undefined') throw new Error('sessionStorage unavailable')
  const db = await openDb()
  try {
    await writeRecord(db, demo ? { kind: 'demo' } : { kind: 'file', file })
    try {
      sessionStorage.setItem(RELOAD_PENDING_KEY, '1')
    } catch (error) {
      try { await deleteRecord(db) } catch { /* 保留原始失败原因 */ }
      throw error
    }
  } finally {
    db.close()
  }
}

/**
 * 取回并消费上一次重载暂存的回放。没有待恢复标记时直接返回 null，不访问 IndexedDB。
 * 标记在读取前就被清掉：恢复失败只报一次，不会让后续每次进入工作台都重试。
 */
export async function takeReloadReplay(): Promise<StagedReplay | null> {
  if (typeof sessionStorage === 'undefined') return null
  let pending = null
  try { pending = sessionStorage.getItem(RELOAD_PENDING_KEY) } catch { return null }
  if (pending !== '1') return null
  try { sessionStorage.removeItem(RELOAD_PENDING_KEY) } catch { /* 标记清理失败也不能重复恢复 */ }

  const db = await openDb()
  try {
    const record = await takeRecord(db)
    if (!record) return null
    if (record.kind === 'demo') return { kind: 'demo' }
    if (record.kind === 'file' && record.file && typeof File !== 'undefined' && record.file instanceof File) {
      return { kind: 'file', file: record.file }
    }
    return null
  } finally {
    db.close()
  }
}