export const MAX_REPLAY_FILES = 100
export const MAX_REPLAY_FILE_BYTES = 20 * 1024 * 1024
export const MAX_REPLAY_TOTAL_BYTES = 200 * 1024 * 1024

export function isReplayFileName(name: unknown): name is string {
  return typeof name === 'string' && name.toLowerCase().endsWith('.wotbreplay')
}

export function formatReplaySize(bytes: number | null | undefined) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return v.toFixed(i === 0 ? 0 : 1) + ' ' + units[i]
}

export function validateReplaySelection<T extends { name?: unknown; size?: number }>(files: Iterable<T> | ArrayLike<T> | null | undefined) {
  const candidate = Array.from(files || [])
  const offending: Array<{ file: T; reason: 'INVALID_TYPE' | 'FILE_TOO_LARGE' }> = []
  const typeValid: T[] = []
  let totalBytes = 0
  for (const f of candidate) {
    if (!isReplayFileName(f?.name)) {
      offending.push({ file: f, reason: 'INVALID_TYPE' })
      continue
    }
    typeValid.push(f)
    totalBytes += f.size || 0
    if (f.size! > MAX_REPLAY_FILE_BYTES) {
      offending.push({ file: f, reason: 'FILE_TOO_LARGE' })
    }
  }
  const tooMany = typeValid.length > MAX_REPLAY_FILES
  const totalTooLarge = totalBytes > MAX_REPLAY_TOTAL_BYTES
  return {
    valid: offending.length === 0 && !tooMany && !totalTooLarge,
    offending,
    tooMany,
    totalTooLarge,
    count: typeValid.length,
    totalBytes
  }
}
