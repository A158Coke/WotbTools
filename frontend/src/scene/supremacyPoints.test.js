import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { pointsAt } from './supremacyPoints.js'

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

  it('点数每 tick 无条件写入（不再包在"有采样"的 if 里）', () => {
    expect(tick).toMatch(/const pts = pointsAt\(DATA\.supremacy_points, T, DATA\.meta\.friendly_team\);/)
    expect(tick).toMatch(/store\.pointsFriend = pts\.friend; store\.pointsEnemy = pts\.enemy;/)
    // 旧写法：整个赋值块被 if (DATA.supremacy_points && ...) 包住
    expect(tick).not.toMatch(/if \(DATA\.supremacy_points && DATA\.supremacy_points\.length\) \{/)
    // 计算与赋值相邻，且所在块不得是 if 分支（裸块 = 无条件执行）
    const block = tick.slice(tick.indexOf('const pts = pointsAt'))
    expect(block.slice(0, 300)).toMatch(/store\.pointsFriend = pts\.friend; store\.pointsEnemy = pts\.enemy;/)
    expect(tick).not.toMatch(/if \([^\n]*\)\s*\{\s*const pts = pointsAt/)
  })

  it('teardown 显式归零 HUD 派生字段（切换会话不留残值）', () => {
    const td = src.slice(src.indexOf('function teardownSession'))
    expect(td).toMatch(/store\.pointsFriend = null; store\.pointsEnemy = null;/)
    // 基地视图模型随贴地标记一起清空（clearBases 内 store.baseViews = []）
    expect(td).toMatch(/clearBases\(\);/)
    expect(src.slice(src.indexOf('function clearBases'))).toMatch(/store\.baseViews = \[\];/)
  })
})

describe('中立 / 未知阵营色（PR #411 非阻塞：green / red / white）', () => {
  const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')

  it('中立与阵营未知收敛到 white（不再用灰）', () => {
    // 基地中立色走阵营 token --color-team-neutral，兜底同为白色
    expect(src).toMatch(/neutral: '#f5f5f5'/)
    expect(src).toMatch(/--color-team-neutral/)
    expect(src).toMatch(/if \(t === 0 \|\| f === 0\) return COLOR_UNKNOWN;/)
    expect(src).not.toMatch(/BASE_NEUTRAL = 0x9aa5b1/)
    expect(src).not.toMatch(/return 0x8a94a3;/)
  })

  it('调色常量只有一处声明（唯一事实源，避免 TDZ 与漂移）', () => {
    expect(src.match(/const COLOR_UNKNOWN = 0xf5f5f5;/g)?.length).toBe(1)
    // 深色板（2026-10-05 加深，炮线与车辆 tint 共用）：亮色 0x2ecc71/0xef4444 已弃用
    expect(src.match(/const COLOR_FRIENDLY = 0x26794a;/g)?.length).toBe(1)
    expect(src.match(/const COLOR_ENEMY = 0x98322a;/g)?.length).toBe(1)
    expect(src).not.toContain('0x2ecc71')
    expect(src).not.toContain('0xef4444')
  })
})
