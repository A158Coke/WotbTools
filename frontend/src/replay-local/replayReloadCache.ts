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
      try { await deleteRecord(db, id) } catch { }
      throw error
    }
  } finally {
    db.close()
  }
  return id
}

export async function takeReloadReplay(): Promise<StagedReload | null> {
  if (typeof sessionStorage === 'undefined') return null
  let id: string | null = null
  try { id = sessionStorage.getItem(RELOAD_PENDING_KEY) } catch { return null }
  if (!id) return null
  try { sessionStorage.removeItem(RELOAD_PENDING_KEY) } catch { }

  const db = await openDb()
  try {
    const record = await takeRecord(db, id)
    if (!record || !validReplay(record.replay)) return null
    return { id, replay: { ...record.replay, contactShadows: record.replay.contactShadows === true } }
  } finally {
    db.close()
  }
}

export async function discardReloadReplay(id: string): Promise<void> {
  try {
    const db = await openDb()
    try { await deleteRecord(db, id) } finally { db.close() }
  } catch { }
  try { if (sessionStorage.getItem(RELOAD_PENDING_KEY) === id) sessionStorage.removeItem(RELOAD_PENDING_KEY) } catch { }
}
