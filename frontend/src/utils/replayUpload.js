/**
 * 共享 Replay 上传 contract（BLOCKER 4）：FileUploader（选择文件/文件夹/Add/drag-drop）、
 * ReconstructionPage 独立 AI/Playback 选择器统一走同一个 validator，magic number 不散落
 * 在 Vue component。与后端 ReplayUploadValidator / application.yml multipart 限制一致：
 * 单文件 20 MiB、总量 200 MiB（后端保持 hard limit，前端 preflight 提供精确错误）。
 */
export const MAX_REPLAY_FILES = 100
export const MAX_REPLAY_FILE_BYTES = 20 * 1024 * 1024
export const MAX_REPLAY_TOTAL_BYTES = 200 * 1024 * 1024

/** 候选文件是否 .wotbreplay（大小写不敏感）。 */
export function isReplayFileName(name) {
  return typeof name === 'string' && name.toLowerCase().endsWith('.wotbreplay')
}

/** 人类可读文件大小（B/KB/MB/GB，与旧 formatBytes 输出一致：34.0 KB / 1.8 MB / 27.4 MB）。 */
export function formatReplaySize(bytes) {
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

/**
 * 校验「prospective selection」（现有 selection + 本次新增合并后的完整候选集合）：
 * 1. .wotbreplay；2. count ≤ 100；3. 每个文件 ≤ 20 MiB；4. 总量 ≤ 200 MiB。
 *
 * 返回结构（纯函数，无 i18n/无 DOM）：
 * - {@code valid}：整体是否可接受（任一违规即 false）；
 * - {@code offending}：逐文件违规（INVALID_TYPE / FILE_TOO_LARGE，一次展示全部）；
 * - {@code tooMany} / {@code totalTooLarge}：集合级违规；
 * - {@code count}：类型合法的回放文件数（非 .wotbreplay 不计入 100 上限）；
 * - {@code totalBytes}：类型合法文件的累计大小。
 */
export function validateReplaySelection(files) {
  const candidate = Array.from(files || [])
  const offending = []
  const typeValid = []
  let totalBytes = 0
  for (const f of candidate) {
    if (!isReplayFileName(f?.name)) {
      offending.push({ file: f, reason: 'INVALID_TYPE' })
      continue
    }
    typeValid.push(f)
    totalBytes += f.size || 0
    if (f.size > MAX_REPLAY_FILE_BYTES) {
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
