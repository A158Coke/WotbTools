import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { hpAtSeries, hpPercentText, projectRoster, ROSTER_GROUPS, buildRosterRows } from './rosterState.js'

const vehicle = (eid, team, opts = {}) => ({
  def: {
    eid,
    team,
    nickname: opts.nickname ?? `p${eid}`,
    tank_name: opts.tank_name ?? `tank${eid}`,
    tank_id: opts.tank_id ?? eid,
    is_author: !!opts.is_author,
    max_hp: opts.max_hp ?? 2000,
    hp: opts.hp ?? [[0, 2000]],
    death_t: opts.death_t ?? null,
  },
})

describe('rosterState · HP 时间序列', () => {
  it('取 clock ≤ t 的最后一条；早于首条 → 满血；空序列 → 满血', () => {
    const hp = [[10, 1800], [30, 900], [50, 0]]
    expect(hpAtSeries(hp, 2000, 0)).toBe(2000)
    expect(hpAtSeries(hp, 2000, 10)).toBe(1800)
    expect(hpAtSeries(hp, 2000, 29.999)).toBe(1800)
    expect(hpAtSeries(hp, 2000, 50)).toBe(0)
    expect(hpAtSeries(null, 2000, 99)).toBe(2000)
  })
})

describe('rosterState · 百分比', () => {
  it('按上限计算并夹在 0..100', () => {
    expect(hpPercentText(1950, 1950)).toBe(100)
    expect(hpPercentText(824, 1950)).toBe(42)
    expect(hpPercentText(-50, 1000)).toBe(0)
    expect(hpPercentText(1200, 1000)).toBe(100)
  })

  it('没有可信上限 → null（不是 0：不得把"未知"上屏成"空血"）', () => {
    expect(hpPercentText(100, 0)).toBeNull()
    expect(hpPercentText(100, undefined)).toBeNull()
    expect(hpPercentText(100, Number.NaN)).toBeNull()
    expect(hpPercentText(Number.NaN, 1000)).toBeNull()
  })

  it('取整到整数百分比（4.2 折的 824/1950 读作 42%，不四舍五入到 43）', () => {
    expect(hpPercentText(1, 1000)).toBe(0)
    expect(hpPercentText(999, 1000)).toBe(100)
  })
})

describe('rosterState · 状态在时刻投影', () => {
  const V = [
    vehicle(1, 1, { hp: [[0, 2000], [10, 1000], [20, 0]], death_t: 20 }),
    vehicle(2, 2, { hp: [[0, 2000], [15, 1500]] }),
    vehicle(3, 0, { hp: [[0, 800]], max_hp: 800 }),
  ]

  it('每台车按 t 求 HP 与阵亡，未知阵营照常投影（≠ 不显示）', () => {
    const at5 = projectRoster(V, 5)
    expect(at5.get(1)).toEqual({ hp: 2000, maxHp: 2000, dead: false })
    expect(at5.get(3)).toEqual({ hp: 800, maxHp: 800, dead: false })

    const at25 = projectRoster(V, 25)
    expect(at25.get(1)).toEqual({ hp: 0, maxHp: 2000, dead: true })
    expect(at25.get(2)).toEqual({ hp: 1500, maxHp: 2000, dead: false })
  })

  it('seek 确定性：T=5 → T=120 → 回到 T=5，逐字段完全一致（无递减式状态）', () => {
    const before = projectRoster(V, 5)
    projectRoster(V, 120)
    const after = projectRoster(V, 5)
    expect([...after.entries()]).toEqual([...before.entries()])
    for (const [eid, row] of before) expect(after.get(eid)).toEqual(row)
  })

  it('阵亡判定走权威 death_t，而不是 hp === 0', () => {
    // 残骸：HP 已归零但 death_t 缺失 → 不得当阵亡；HP 非零但 death_t 已过 → 必须当阵亡
    const odd = [
      vehicle(1, 1, { hp: [[0, 0]], death_t: null }),
      vehicle(2, 2, { hp: [[0, 2000]], death_t: 30 }),
    ]
    const at40 = projectRoster(odd, 40)
    expect(at40.get(1).dead).toBe(false)
    expect(at40.get(2).dead).toBe(true)
  })

  it('eid 缺失的条目跳过，不产生 undefined 行', () => {
    const g = projectRoster([{ def: {} }, vehicle(7, 1)], 1)
    expect([...g.keys()]).toEqual([7])
  })
})

describe('rosterState · 物理队伍分组', () => {
  it('Team 1 → team1、Team 2 → team2、其它（含 0/null）→ unknown（unknown ≠ enemy）', () => {
    const rows = buildRosterRows([
      vehicle(1, 1), vehicle(2, 2), vehicle(3, 0), vehicle(4, undefined), vehicle(5, 3),
    ])
    expect(rows.team1.map((r) => r.eid)).toEqual([1])
    expect(rows.team2.map((r) => r.eid)).toEqual([2])
    expect(rows.unknown.map((r) => r.eid)).toEqual([3, 4, 5])
    // team 字段本身也只保留物理身份，未知一律 null（呈现层据此取中性 token）
    expect(rows.unknown.every((r) => r.team === null)).toBe(true)
    expect(rows.team1[0].team).toBe(1)
    expect(rows.team2[0].team).toBe(2)
  })

  it('作者车昵称带 ★ 前缀；缺昵称/车型名有兜底', () => {
    const rows = buildRosterRows([
      vehicle(1, 1, { is_author: true, nickname: 'Why' }),
      { def: { eid: 9, team: 2, nickname: null, tank_name: '', tank_id: 42 } },
    ])
    expect(rows.team1[0].nick).toBe('★ Why')
    expect(rows.team2[0].nick).toBe('Unknown')
    expect(rows.team2[0].tank).toBe('tank_42')
  })

  it('分组键与 store 的 roster 形状一致', () => {
    expect(ROSTER_GROUPS).toEqual(['team1', 'team2', 'unknown'])
  })
})

// 名册血量**必须在暂停 / 拖动进度条时也更新**：tick() 在非 busy 时会提前返回，
// seekTo 必须自己补一次 updateRoster。源码级守卫（场景内核依赖 WebGL，无法实例化）。
describe('rosterState · seek 投影接线守卫', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8').replace(/\/\/[^\n]*/g, '')

  it('seekTo 在 tick() 之后显式重跑 updateRoster', () => {
    const at = src.indexOf('function seekTo(t)')
    expect(at).toBeGreaterThan(-1)
    const body = src.slice(at, at + 1600)
    const tickAt = body.indexOf('tick();')
    const rosterAt = body.indexOf('updateRoster();')
    const hudAt = body.indexOf('writeHud(true);')
    expect(tickAt).toBeGreaterThan(-1)
    expect(rosterAt).toBeGreaterThan(tickAt)
    expect(rosterAt).toBeLessThan(hudAt)
  })

  it('名册运行时状态由 projectRoster(V, T) 投影，不再由 hpAt/deathAt 在中途改写', () => {
    const at = src.indexOf('function updateRoster()')
    const body = src.slice(at, at + 900)
    expect(body).toMatch(/projectRoster\(V, T\)/)
    expect(body).not.toMatch(/rosterEntry/)
  })

  it('teardown 清空名册与 eid → 行 索引（会话切换不留旧行）', () => {
    expect(src).toMatch(/rosterRowsByEid\.clear\(\)/)
  })
})
