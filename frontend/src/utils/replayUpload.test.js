// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  MAX_REPLAY_FILE_BYTES,
  MAX_REPLAY_FILES,
  MAX_REPLAY_TOTAL_BYTES,
  formatReplaySize,
  isReplayFileName,
  validateReplaySelection
} from './replayUpload.js'

const MiB = 1024 * 1024

function replayFile(name, size) {
  return { name, size }
}

describe('replayUpload 共享 contract（BLOCKER 4）', () => {
  it('定义与后端一致的 magic numbers', () => {
    expect(MAX_REPLAY_FILES).toBe(100)
    expect(MAX_REPLAY_FILE_BYTES).toBe(20 * MiB)
    expect(MAX_REPLAY_TOTAL_BYTES).toBe(200 * MiB)
  })

  it('isReplayFileName 大小写不敏感且只认 .wotbreplay', () => {
    expect(isReplayFileName('a.WOTBREPLAY')).toBe(true)
    expect(isReplayFileName('a.wotbreplay')).toBe(true)
    expect(isReplayFileName('a.txt')).toBe(false)
    expect(isReplayFileName(null)).toBe(false)
  })

  it('formatReplaySize 输出稳定（B/KB/MB 一位小数）', () => {
    expect(formatReplaySize(0)).toBe('0 B')
    expect(formatReplaySize(1024)).toBe('1.0 KB')
    expect(formatReplaySize(20 * MiB)).toBe('20.0 MB')
    expect(formatReplaySize(Math.floor(27.4 * MiB))).toBe('27.4 MB')
  })

  it('100 个文件 accepted，101 个 rejected（count <= 100）', () => {
    const files100 = Array.from({ length: 100 }, (_, i) => replayFile(`r${i}.wotbreplay`, 1024))
    expect(validateReplaySelection(files100)).toMatchObject({ valid: true, count: 100 })

    const files101 = Array.from({ length: 101 }, (_, i) => replayFile(`r${i}.wotbreplay`, 1024))
    const result = validateReplaySelection(files101)
    expect(result.valid).toBe(false)
    expect(result.tooMany).toBe(true)
    expect(result.offending).toEqual([])
    expect(result.count).toBe(101)
  })

  it('exactly 20 MiB accepted，>20 MiB rejected（单文件上限）', () => {
    expect(validateReplaySelection([replayFile('a.wotbreplay', 20 * MiB)]).valid).toBe(true)
    const result = validateReplaySelection([replayFile('a.wotbreplay', 20 * MiB + 1)])
    expect(result.valid).toBe(false)
    expect(result.offending).toEqual([
      { file: replayFile('a.wotbreplay', 20 * MiB + 1), reason: 'FILE_TOO_LARGE' }
    ])
  })

  it('exactly 200 MiB accepted，>200 MiB rejected（总量上限）', () => {
    const exactly = Array.from({ length: 100 }, (_, i) => replayFile(`r${i}.wotbreplay`, 2 * MiB))
    expect(validateReplaySelection(exactly).valid).toBe(true)

    const over = [
      ...Array.from({ length: 95 }, (_, i) => replayFile(`r${i}.wotbreplay`, 2 * MiB)),
      replayFile('tail.wotbreplay', 10 * MiB + 1)
    ]
    const result = validateReplaySelection(over)
    expect(result.valid).toBe(false)
    expect(result.totalTooLarge).toBe(true)
  })

  it('54 files / 85 MiB + one 27.4 MiB → rejected，offending 列出具体文件与实际大小', () => {
    const files = Array.from({ length: 54 }, (_, i) => replayFile(`batch-${i}.wotbreplay`, 85 * MiB / 54))
    const oversized = replayFile('oversized.wotbreplay', Math.floor(27.4 * MiB))
    const result = validateReplaySelection([...files, oversized])

    expect(result.valid).toBe(false)
    expect(result.offending).toEqual([{ file: oversized, reason: 'FILE_TOO_LARGE' }])
    expect(formatReplaySize(result.offending[0].file.size)).toBe('27.4 MB')
  })

  it('multiple oversized files 全部列出', () => {
    const result = validateReplaySelection([
      replayFile('a.wotbreplay', 21 * MiB),
      replayFile('b.wotbreplay', 30 * MiB),
      replayFile('ok.wotbreplay', 1024),
      replayFile('c.wotbreplay', 40 * MiB)
    ])
    expect(result.valid).toBe(false)
    expect(result.offending.map(o => o.file.name)).toEqual(['a.wotbreplay', 'b.wotbreplay', 'c.wotbreplay'])
    expect(result.offending.every(o => o.reason === 'FILE_TOO_LARGE')).toBe(true)
  })

  it('非 .wotbreplay 文件 → INVALID_TYPE，且不计入 count/total', () => {
    const result = validateReplaySelection([
      replayFile('readme.txt', 1024),
      replayFile('a.wotbreplay', 1024)
    ])
    expect(result.valid).toBe(false)
    expect(result.offending).toEqual([{ file: replayFile('readme.txt', 1024), reason: 'INVALID_TYPE' }])
    expect(result.tooMany).toBe(false)
    expect(result.totalTooLarge).toBe(false)
    expect(result.count).toBe(1)
    expect(result.totalBytes).toBe(1024)
  })

  it('101 replay + 50 non-replay → count=101（非回放不计入 100 上限）', () => {
    const result = validateReplaySelection([
      ...Array.from({ length: 101 }, (_, i) => replayFile(`r${i}.wotbreplay`, 1024)),
      ...Array.from({ length: 50 }, (_, i) => replayFile(`aux-${i}.txt`, 1024))
    ])
    expect(result.count).toBe(101)
    expect(result.tooMany).toBe(true)
    expect(result.valid).toBe(false)
    expect(result.totalBytes).toBe(101 * 1024)
  })
})
