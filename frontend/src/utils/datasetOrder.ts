
export interface DatasetOrderEntry {
  id: string
  variant?: string | null
}

export function datasetVersionKey(id: string): number[] {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:_(\d+))?(?:-r(\d+))?$/.exec(id)
  if (!match) return []
  return [match[1], match[2], match[3], match[4], match[5], match[6]].map(
    part => (part == null ? 0 : Number(part)),
  )
}

export function compareDatasetVersionDesc(
  a: DatasetOrderEntry,
  b: DatasetOrderEntry,
): number {
  const ka = datasetVersionKey(a.id)
  const kb = datasetVersionKey(b.id)
  const len = Math.max(ka.length, kb.length)
  for (let i = 0; i < len; i++) {
    const diff = (kb[i] ?? 0) - (ka[i] ?? 0)
    if (diff) return diff
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function isRelease(entry: DatasetOrderEntry): boolean {
  return !entry.variant
}

export function orderDatasetsForDisplay<T extends DatasetOrderEntry>(entries: readonly T[]): T[] {
  const sorted = [...entries].sort(compareDatasetVersionDesc)
  const latestSupertest = sorted.find(entry => Boolean(entry.variant)) ?? null
  const latestRelease = sorted.find(isRelease) ?? null
  const picked = new Set<DatasetOrderEntry>()
  const out: T[] = []
  for (const head of [latestSupertest, latestRelease]) {
    if (head && !picked.has(head)) {
      picked.add(head)
      out.push(head)
    }
  }
  for (const entry of sorted) {
    if (!picked.has(entry)) out.push(entry)
  }
  return out
}
