import { describe, it, expect } from 'vitest'
import { pointsAt } from './supremacyPoints.ts'
import { playbackSceneSource } from './__tests__/sceneSource.ts'
import { COLOR_UNKNOWN, COLOR_FRIENDLY, COLOR_ENEMY, TRACER_FRIENDLY, TRACER_ENEMY, teamColorOf } from './playback/palette.ts'
import { PLAYBACK_ROLES } from '../data/mapTeamColors.js'

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
  const src = playbackSceneSource()
  const tick = src.slice(src.indexOf('function tick()'), src.indexOf('function tick()') + 4000)

  it('teardown 显式归零 HUD 点数字段（clearBases 释放行为见 playback/bases.tracers.behavior.test.ts）', () => {
    // pointsFriend/pointsEnemy 的归零闭合在 teardownSession 闭包，无可注入 seam（保留源码守卫）
    const td = src.slice(src.indexOf('function teardownSession'))
    expect(td).toMatch(/store\.pointsFriend = null; store\.pointsEnemy = null;/)
  })
})

describe('中立 / 未知阵营色（Playback SSOT 角色）', () => {
  const numeric = (hex) => parseInt(hex.slice(1), 16)

  it('3D 数值常量由共享角色派生，不是 renderer 私有声明', () => {
    expect(COLOR_FRIENDLY).toBe(numeric(PLAYBACK_ROLES.friendly.vehicle))
    expect(COLOR_ENEMY).toBe(numeric(PLAYBACK_ROLES.enemy.vehicle))
    expect(COLOR_UNKNOWN).toBe(numeric(PLAYBACK_ROLES.neutral.vehicle))
    expect(TRACER_FRIENDLY).toBe(numeric(PLAYBACK_ROLES.friendly.tracer))
    expect(TRACER_ENEMY).toBe(numeric(PLAYBACK_ROLES.enemy.tracer))
  })

  it('未知队伍 / 未知视角一律 neutral，绝不落入敌方', () => {
    const neutral = numeric(PLAYBACK_ROLES.neutral.vehicle)
    expect(teamColorOf(3, 1)).toBe(neutral)
    expect(teamColorOf(0, 1)).toBe(neutral)
    expect(teamColorOf(1, null)).toBe(neutral)
    expect(teamColorOf(1, 2)).toBe(numeric(PLAYBACK_ROLES.enemy.vehicle))
  })
})
