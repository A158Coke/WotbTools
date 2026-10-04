import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { hpAtSeries, hpPercentText, hpPresentationFor, projectRoster, ROSTER_GROUPS, buildRosterRows, rosterLanesFor } from './rosterState.js'

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

// 名册在 seek（含暂停时）与播放中都必须对 Vue 可见地更新、且随 HUD 节拍而非逐帧写入：
// 这两条由 playbackScene.test.js 真实驱动场景内核锁定。这里只保留源码级接线守卫。
describe('rosterState · 投影接线守卫', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8').replace(/\/\/[^\n]*/g, '')

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

/**
 * HP 呈现模型：名册与名牌共用同一份判定，渲染层不自己猜。
 * 契约核心是「exact 不重复百分比 / relative 不伪造数值 / unknown ≠ 0% / destroyed 归零」。
 */
describe('rosterState · HP 呈现模型（exact / relative / unknown / destroyed）', () => {
  it('exact：有权威 current + max → 只写 `current / max`，不重复百分比', () => {
    const hp = hpPresentationFor({ currentHp: 742, maxHp: 1995 })
    expect(hp.mode).toBe('exact')
    expect(hp.text).toBe('742 / 1995')
    expect(hp.text).not.toContain('%')
    expect(hp.pct).toBe(37)
    expect(hp.fill).toBeCloseTo(742 / 1995, 6)
  })

  it('exact 满血也只是数值，不写 100%', () => {
    const hp = hpPresentationFor({ currentHp: 1995, maxHp: 1995 })
    expect(hp.text).toBe('1995 / 1995')
    expect(hp.fill).toBe(1)
  })

  it('relative：只有相对证据时显示 pct%，绝不造 current/max', () => {
    const full = hpPresentationFor({ currentHp: null, maxHp: null, relativeFull: true })
    expect(full.mode).toBe('relative')
    expect(full.text).toBe('100%')
    expect(full.currentHp).toBeNull()
    expect(full.maxHp).toBeNull()

    const hurt = hpPresentationFor({ currentHp: null, maxHp: null, pct: 52 })
    expect(hurt.mode).toBe('relative')
    expect(hurt.text).toBe('52%')
    expect(hurt.fill).toBeCloseTo(0.52, 6)
  })

  it('relative 即使带 knowledge 也不升级成 exact（不伪造数值）', () => {
    const hp = hpPresentationFor({ currentHp: null, maxHp: null, pct: 76, knowledge: 'CURRENT' })
    expect(hp.mode).toBe('relative')
    expect(hp.text).toBe('76%')
  })

  it('unknown：— 且 fill 为 0（unknown ≠ 0%，不画满绿）', () => {
    for (const input of [null, {}, { currentHp: null, maxHp: null }, { currentHp: 800, maxHp: 0 }]) {
      const hp = hpPresentationFor(input)
      expect(hp.mode).toBe('unknown')
      expect(hp.text).toBe('—')
      expect(hp.fill).toBe(0)
      expect(hp.pct).toBeNull()
    }
  })

  it('destroyed：有量程写 `0 / max`，无量程退回 `0%`，fill 归零', () => {
    const withMax = hpPresentationFor({ currentHp: 0, maxHp: 2600 }, true)
    expect(withMax.mode).toBe('destroyed')
    expect(withMax.text).toBe('0 / 2600')
    expect(withMax.fill).toBe(0)

    const bare = hpPresentationFor({ currentHp: null, maxHp: null }, true)
    expect(bare.mode).toBe('destroyed')
    expect(bare.text).toBe('0%')
    expect(bare.fill).toBe(0)
  })

  it('destroyed 优先于 relative：阵亡不被读成「相对满血」', () => {
    const hp = hpPresentationFor({ currentHp: null, maxHp: null, relativeFull: true }, true)
    expect(hp.mode).toBe('destroyed')
    expect(hp.text).toBe('0%')
  })

  it('fill 永远夹在 0..1，超量/负数输入不会画出条外', () => {
    expect(hpPresentationFor({ currentHp: 9999, maxHp: 1000 }).fill).toBe(1)
    expect(hpPresentationFor({ currentHp: -50, maxHp: 1000 }).fill).toBe(0)
  })
})

// Perspective changes lane placement without altering physical identities.
describe('rosterLanesFor', () => {
  it.each([1, 2, null])('keeps unknown separate for Recorder team %s', (friendlyTeam) => {
    const groups = { team1: [{ eid: 1, team: 1 }], team2: [{ eid: 2, team: 2 }], unknown: [{ eid: 3, team: null }] }
    const lanes = rosterLanesFor(groups, friendlyTeam)
    expect(lanes.left[friendlyTeam === 2 ? 'team2' : 'team1']).toBe(groups[friendlyTeam === 2 ? 'team2' : 'team1'])
    expect(lanes.right[friendlyTeam === 2 ? 'team1' : 'team2']).toBe(groups[friendlyTeam === 2 ? 'team1' : 'team2'])
    expect(lanes.left.unknown).toBe(groups.unknown)
    expect(lanes.right.unknown).toBeUndefined()
  })
})
