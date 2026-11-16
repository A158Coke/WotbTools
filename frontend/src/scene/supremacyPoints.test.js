import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { pointsAt } from './supremacyPoints.ts'

const here = dirname(fileURLToPath(import.meta.url))

describe('pointsAt（争霸点数的阵营映射）', () => {
  const samples = [
    { clock: 10, team: 1, points: 300 },
    { clock: 10, team: 2, points: 200 },
    { clock: 20, team: 1, points: 720 },
    { clock: 20, team: 2, points: 540 },
    { clock: 30, team: 1, points: 900 },
  ]

  it('按 friendly_team 拆分 friend / enemy，取 ≤t 的最后值', () => {
    expect(pointsAt(samples, 25, 1)).toEqual({ friend: 720, enemy: 540 })
    expect(pointsAt(samples, 5, 1)).toEqual({ friend: null, enemy: null })
    expect(pointsAt(samples, 99, 1)).toEqual({ friend: 900, enemy: 540 })
  })

  it('friendly_team=2 时映射翻转', () => {
    expect(pointsAt(samples, 25, 2)).toEqual({ friend: 540, enemy: 720 })
  })

  it('回归：friendly_team 未知（0 / null / undefined）时一律 null，绝不猜成敌方', () => {
    for (const ft of [0, null, undefined, 3]) {
      expect(pointsAt(samples, 25, ft)).toEqual({ friend: null, enemy: null })
    }
  })

  it('team=0 等未知阵营的采样不参与统计', () => {
    const mixed = [{ clock: 10, team: 0, points: 500 }, { clock: 20, team: 1, points: 42 }]
    expect(pointsAt(mixed, 25, 1)).toEqual({ friend: 42, enemy: null })
    expect(pointsAt([{ clock: 10, team: 0, points: 500 }], 25, 1)).toEqual({ friend: null, enemy: null })
  })

  it('回归：无采样（普通战）也返回结果对象——调用方无条件写入，不留上一场残值', () => {
    expect(pointsAt(undefined, 25, 1)).toEqual({ friend: null, enemy: null })
    expect(pointsAt([], 25, 1)).toEqual({ friend: null, enemy: null })
    // Supremacy → Regular 会话切换：同一调用形态必须得到 null，而不是上一场的 720/540
    const supremacy = pointsAt(samples, 25, 1)
    const regular = pointsAt(undefined, 25, 1)
    expect(supremacy.friend).toBe(720)
    expect(regular).toEqual({ friend: null, enemy: null })
  })
})

describe('playbackScene 的 HUD 状态接线（防回归）', () => {
  const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')
  const tick = src.slice(src.indexOf('function tick()'), src.indexOf('function tick()') + 4000)

  it('teardown 显式归零 HUD 点数字段（clearBases 释放行为见 playback/bases.tracers.behavior.test.ts）', () => {
    // pointsFriend/pointsEnemy 的归零闭合在 teardownSession 闭包，无可注入 seam（保留源码守卫）
    const td = src.slice(src.indexOf('function teardownSession'))
    expect(td).toMatch(/store\.pointsFriend = null; store\.pointsEnemy = null;/)
  })
})

describe('中立 / 未知阵营色（PR #411 非阻塞：green / red / white）', () => {
  const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')

  it('调色常量只有一处声明（唯一事实源，避免 TDZ 与漂移）', () => {
    expect(src.match(/const COLOR_UNKNOWN = 0xf5f5f5;/g)?.length).toBe(1)
    // 深色板（2026-10-05 加深，车辆 tint 共用）：亮色 0x2ecc71/0xef4444 已弃用
    expect(src.match(/const COLOR_FRIENDLY = 0x26794a;/g)?.length).toBe(1)
    expect(src.match(/const COLOR_ENEMY = 0x98322a;/g)?.length).toBe(1)
    expect(src).not.toContain('0x2ecc71')
    expect(src).not.toContain('0xef4444')
  })

})
