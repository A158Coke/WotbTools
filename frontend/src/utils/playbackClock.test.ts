import { describe, expect, it } from 'vitest'
import { advancePlaybackTime, formatShotBattleClock } from './playbackClock.js'

it('advances in battle-relative seconds', () => {
  expect(advancePlaybackTime(10, 60, 500, 2)).toBe(11)
})

describe('formatShotBattleClock', () => {
  it('减去开战原始时钟：原始 02:20 + 开战前 14s → 02:06（射击分析与装甲查看器一致）', () => {
    expect(formatShotBattleClock(140, 14)).toBe('02:06')
  })
  it('开战前射击钳到 00:00，非法开战时钟按 0 处理', () => {
    expect(formatShotBattleClock(5, 14)).toBe('00:00')
    expect(formatShotBattleClock(140, Number.NaN)).toBe('02:20')
    expect(formatShotBattleClock(140, 0)).toBe('02:20')
  })
})
