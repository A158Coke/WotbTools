
interface LoadItem {
  loaded: number
  total: number
  done: boolean
}

export interface LoadProgressSnapshot {
  fraction: number | null
  done: number
  total: number
}

export type LoadProgressOnChange = (snapshot: LoadProgressSnapshot) => void

function itemFraction(item: LoadItem): number {
  if (item.done) return 1
  if (item.total > 0) return Math.min(1, Math.max(0, item.loaded / item.total))
  return 0
}

export interface LoadProgressTracker {
  expect(key: string): void
  update(key: string, loaded: number, total: number): void
  complete(key: string): void
  reset(): void
  snapshot(): LoadProgressSnapshot
}

export function createLoadProgress(onChange?: LoadProgressOnChange): LoadProgressTracker {
  const items = new Map<string, LoadItem>()
  let last = 0

  function snapshot() {
    if (!items.size) return { fraction: null, done: 0, total: 0 }
    let sum = 0
    let done = 0
    for (const item of items.values()) {
      sum += itemFraction(item)
      if (item.done) done += 1
    }
    last = Math.max(last, sum / items.size)
    return { fraction: last, done, total: items.size }
  }

  const emit = () => {
    const snap = snapshot()
    onChange?.(snap)
  }

  return {
    expect(key: string) {
      if (!items.has(key)) items.set(key, { loaded: 0, total: 0, done: false })
      emit()
    },
    update(key: string, loaded: number, total: number) {
      const item = items.get(key)
      if (!item) return
      item.loaded = Number(loaded) || 0
      item.total = Number(total) || 0
      emit()
    },
    complete(key: string) {
      const item = items.get(key)
      if (!item) return
      item.done = true
      emit()
    },
    reset() {
      items.clear()
      last = 0
      emit()
    },
    snapshot,
  }
}

export function progressPercent(fraction: number | null | undefined): number | null {
  if (fraction == null || !Number.isFinite(fraction)) return null
  return Math.round(Math.min(1, Math.max(0, fraction)) * 100)
}
