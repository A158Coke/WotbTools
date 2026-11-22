// 纯函数测试（无 DOM）：时间轴刻度换算 / 跳炮击最近邻 / 数字键骑乘侧别映射。
// 数据契约见 utils/playbackShortcuts.js 头注（AgentPlaybackFacet → 刻度 / 骑乘模型）。
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { REPLAY_3D_PANE_SOURCE } from '../components/replay3dPane.test.source.js'
import {
  RIDE_DIGIT_MAX,
  buildKillTicks,
  buildShotTicks,
  findNextShotTime,
  findPrevShotTime,
  nearestTickTime,
  rosterRideTarget,
  tickPercentToTime,
  timelineTickPercent,
} from './playbackShortcuts.ts'

const here = dirname(fileURLToPath(import.meta.url))

describe('timelineTickPercent（t → 百分比，与滑块 min/max 同语义）', () => {
  it('端点映射：start→0、end→100', () => {
    expect(timelineTickPercent(0, 0, 20)).toBe(0)
    expect(timelineTickPercent(10, 0, 20)).toBe(50)
    expect(timelineTickPercent(20, 0, 20)).toBe(100)
    // 3D 时间轴起点 t_start 不一定是 0
    expect(timelineTickPercent(45, 45, 145)).toBe(0)
    expect(timelineTickPercent(145, 45, 145)).toBe(100)
    expect(timelineTickPercent(95, 45, 145)).toBe(50)
  })

  it('越界夹取：早于起点 → 0，晚于终点 → 100', () => {
    expect(timelineTickPercent(-5, 0, 20)).toBe(0)
    expect(timelineTickPercent(25, 0, 20)).toBe(100)
    expect(timelineTickPercent(1000, 45, 145)).toBe(100)
  })

  it('退化时间轴（duration <= startTime）按组件同一回退 startTime+1 量程', () => {
    expect(timelineTickPercent(7, 7, 7)).toBe(0)
    expect(timelineTickPercent(8, 7, 7)).toBe(100)
    expect(timelineTickPercent(7.5, 7, 0)).toBe(50)   // duration 无效 → [7, 8]
  })

  it('非法输入 fail-closed：非有限 t / 非有限起点 → null（该刻度不渲染）', () => {
    expect(timelineTickPercent(NaN, 0, 20)).toBeNull()
    expect(timelineTickPercent(Infinity, 0, 20)).toBeNull()
    expect(timelineTickPercent(undefined, 0, 20)).toBeNull()
    expect(timelineTickPercent(10, NaN, 20)).toBeNull()
    // duration 为 NaN 时与组件的 max computed 同一回退（start+1 量程）：t 落在量程外 → 夹取 100
    expect(timelineTickPercent(10, 0, NaN)).toBe(100)
    expect(timelineTickPercent('10', 0, 20)).toBe(50)   // 数值字符串按 Number 语义接受
  })
})

describe('buildShotTicks / buildKillTicks（刻度模型）', () => {
  const shots = [
    { t_fire: 0, shooter_eid: 1, is_author: true },
    { t_fire: 10, shooter_eid: 2, is_author: false },
    { t_fire: 20, shooter_eid: 3, is_author: false },
    { t_fire: NaN, shooter_eid: 4 },   // 非法：丢弃
    null,                              // 非法：丢弃
  ]

  it('t_fire → pct，非法条目丢弃', () => {
    const ticks = buildShotTicks(shots, 0, 20)
    expect(ticks.map(t => t.t)).toEqual([0, 10, 20])
    expect(ticks.map(t => t.pct)).toEqual([0, 50, 100])
  })

  it('高亮：is_author 直标；highlightEid 命中 shooter_eid 也高亮', () => {
    const ticks = buildShotTicks(shots, 0, 20, null)
    expect(ticks.map(t => t.highlight)).toEqual([true, false, false])
    const withFollower = buildShotTicks(shots, 0, 20, 2)
    expect(withFollower.map(t => t.highlight)).toEqual([true, true, false])
    const other = buildShotTicks(shots, 0, 20, 999)
    expect(other.map(t => t.highlight)).toEqual([true, false, false])
  })

  it('击毁刻度：kills[].t → pct，非数组输入返回空', () => {
    expect(buildKillTicks([{ t: 5 }, { t: 15 }], 0, 20)).toEqual([
      { t: 5, pct: 25 },
      { t: 15, pct: 75 },
    ])
    expect(buildKillTicks(null, 0, 20)).toEqual([])
    expect(buildKillTicks(undefined, 0, 20)).toEqual([])
    expect(buildShotTicks('nope', 0, 20)).toEqual([])
  })
})

describe('nearestTickTime / tickPercentToTime（命中条吸附与按比例换算）', () => {
  const ticks = [
    { t: 12, pct: 60 },
    { t: 8, pct: 40 },
    { t: NaN, pct: 20 },   // 非法条目不参与吸附
    null,
  ]

  it('半径内取最近刻度；并列时先到先得（稳定）', () => {
    expect(nearestTickTime(ticks, 61, 2.5)).toBe(12)
    expect(nearestTickTime(ticks, 39, 2.5)).toBe(8)
    expect(nearestTickTime(ticks, 58, 2.5)).toBe(12)   // 40 与 60 等距？58→60 距离 2，40 距离 18 → 60
    expect(nearestTickTime(ticks, 60, 2.5)).toBe(12)   // 位置恰在刻度上 → 距离 0
  })

  it('半径外无吸附 → null（调用方退回按比例 seek）', () => {
    expect(nearestTickTime(ticks, 50, 2.5)).toBeNull()   // 40/60 各距 10 > 2.5
    expect(nearestTickTime(ticks, 0, 2.5)).toBeNull()
  })

  it('空表 / 非法输入 fail-closed', () => {
    expect(nearestTickTime([], 50, 2.5)).toBeNull()
    expect(nearestTickTime(null, 50, 2.5)).toBeNull()
    expect(nearestTickTime(ticks, NaN, 2.5)).toBeNull()
    expect(nearestTickTime(ticks, 50, NaN)).toBeNull()
    expect(nearestTickTime(ticks, 50, -1)).toBeNull()
  })

  it('tickPercentToTime 与滑块同语义的比例换算（端点 / 越界夹取 / 退化量程）', () => {
    expect(tickPercentToTime(0, 45, 145)).toBe(45)
    expect(tickPercentToTime(50, 45, 145)).toBe(95)
    expect(tickPercentToTime(100, 45, 145)).toBe(145)
    expect(tickPercentToTime(-5, 45, 145)).toBe(45)      // 夹取
    expect(tickPercentToTime(150, 45, 145)).toBe(145)
    expect(tickPercentToTime(50, 7, 7)).toBe(7.5)        // 退化量程 [7,8]
    expect(tickPercentToTime(NaN, 45, 145)).toBeNull()
    expect(tickPercentToTime(50, NaN, 145)).toBeNull()
  })
})

describe('findPrevShotTime / findNextShotTime（跳炮击最近邻）', () => {
  const shots = [{ t_fire: 10 }, { t_fire: 20 }, { t_fire: 30 }]

  it('空序列 → null（保持不动）', () => {
    expect(findPrevShotTime([], 10)).toBeNull()
    expect(findNextShotTime([], 10)).toBeNull()
    expect(findPrevShotTime(null, 10)).toBeNull()
    expect(findNextShotTime(undefined, 10)).toBeNull()
  })

  it('严格最近邻：t 恰在某发上时，prev 取更早、next 取更晚（可来回骑在同一对炮击上）', () => {
    expect(findPrevShotTime(shots, 20)).toBe(10)
    expect(findNextShotTime(shots, 20)).toBe(30)
  })

  it('介于两发之间取最近侧', () => {
    expect(findPrevShotTime(shots, 25)).toBe(20)
    expect(findNextShotTime(shots, 25)).toBe(30)
  })

  it('越界：早于全部 → prev null；晚于全部 → next null', () => {
    expect(findPrevShotTime(shots, 5)).toBeNull()
    expect(findNextShotTime(shots, 5)).toBe(10)
    expect(findPrevShotTime(shots, 100)).toBe(30)
    expect(findNextShotTime(shots, 100)).toBeNull()
  })

  it('不信任输入顺序：乱序 / 重复 t_fire 也按排序序列查找', () => {
    const messy = [{ t_fire: 30 }, { t_fire: 10 }, { t_fire: 20 }, { t_fire: 10 }]
    expect(findPrevShotTime(messy, 25)).toBe(20)
    expect(findNextShotTime(messy, 12)).toBe(20)
    expect(findNextShotTime(messy, 10)).toBe(20)   // 重复首发的下一发仍是 20
  })

  it('非法 t / 非有限 t_fire fail-closed', () => {
    expect(findPrevShotTime(shots, NaN)).toBeNull()
    expect(findNextShotTime(shots, undefined)).toBeNull()
    expect(findPrevShotTime([{ t_fire: 'x' }, { t_fire: 5 }], 0)).toBeNull()
    expect(findNextShotTime([{ t_fire: 'x' }, { t_fire: 5 }], 0)).toBe(5)
  })
})

describe('rosterRideTarget（数字键骑乘：1–7 己方 / Shift+1–7 敌方）', () => {
  // 名册序 = buildRosterRows 顺序（vehicles 原序）；team 字段为 facet 实际字段名
  const roster = [
    { eid: 101, team: 1 },
    { eid: 102, team: 1 },
    { eid: 201, team: 2 },
    { eid: 202, team: 2 },
    { eid: 300, team: 0 },   // 未知阵营：绝不并进任何一队
    { eid: null, team: 1 },  // 无 eid：跳过
  ]

  it('己方按名册序取第 digit 辆（allyTeam=1）', () => {
    expect(rosterRideTarget(roster, 1, false, 1)).toBe(101)
    expect(rosterRideTarget(roster, 2, false, 1)).toBe(102)
    expect(rosterRideTarget(roster, 3, false, 1)).toBeNull()   // 己方只有 2 辆 → 越界 null
  })

  it('敌方（Shift）按名册序取第 digit 辆', () => {
    expect(rosterRideTarget(roster, 1, true, 1)).toBe(201)
    expect(rosterRideTarget(roster, 2, true, 1)).toBe(202)
    expect(rosterRideTarget(roster, 3, true, 1)).toBeNull()
  })

  it('allyTeam=2 时侧别翻转', () => {
    expect(rosterRideTarget(roster, 1, false, 2)).toBe(201)
    expect(rosterRideTarget(roster, 1, true, 2)).toBe(101)
  })

  it('显式 side 字段优先于 team', () => {
    const bySide = [{ eid: 1, side: 'enemy' }, { eid: 2, side: 'ALLY' }, { eid: 3 }]
    expect(rosterRideTarget(bySide, 1, false, 1)).toBe(2)
    expect(rosterRideTarget(bySide, 1, true, 1)).toBe(1)
    expect(rosterRideTarget(bySide, 2, false, 1)).toBeNull()   // 无侧别行不参与
  })

  it('fail-closed：allyTeam 未知（null）时整体禁用，绝不猜「team 1 = 己方」', () => {
    expect(rosterRideTarget(roster, 1, false, null)).toBeNull()
    expect(rosterRideTarget(roster, 1, true, null)).toBeNull()
  })

  it('位次越界与非法 digit → null', () => {
    expect(rosterRideTarget(roster, 0, false, 1)).toBeNull()
    expect(rosterRideTarget(roster, -1, false, 1)).toBeNull()
    expect(rosterRideTarget(roster, 1.5, false, 1)).toBeNull()
    expect(rosterRideTarget(roster, RIDE_DIGIT_MAX + 1, false, 1)).toBeNull()
    expect(rosterRideTarget(roster, RIDE_DIGIT_MAX, false, 1)).toBeNull()   // 7 号位无车
    expect(rosterRideTarget(null, 1, false, 1)).toBeNull()
    expect(rosterRideTarget('x', 1, false, 1)).toBeNull()
  })
})

describe('源码级 guard：数字键冲突消解逻辑存在', () => {
  const transport = readFileSync(resolve(here, '../composables/usePlaybackTransport.ts'), 'utf8')
  // 拆分后实现分布在 Replay3DPane.vue + replay3dPane{A..C}.ts；守卫必须覆盖全部 owner。
  const pane = REPLAY_3D_PANE_SOURCE

  it('transport 的数字键分支先经 fly 模式判定，才调 rideVehicle（自由飞行激活 → 数字键归飞行速率）', () => {
    // 分支条件现同时排除 Ctrl/Meta/Alt（浏览器快捷键不得被骑乘劫持）；顺序断言不变
    const branch = transport.match(/else if \(\/\^Digit\[1-7\]\$\/\.test\(event\.code\) && adapter\.rideVehicle[\s\S]*?\) \{([\s\S]*?)\n    \}/)
    expect(branch).not.toBeNull()
    expect(branch[1]).toContain('isFlyMode')
    // 顺序：isFlyMode 让出判定必须出现在 rideVehicle 调用之前
    expect(branch[1].indexOf('isFlyMode')).toBeLessThan(branch[1].indexOf('rideVehicle('))
    expect(branch[1]).toContain('event.shiftKey')
  })

  it('3D 面板把 fly 激活态（store.cam === \'free\'）接进 transport adapter', () => {
    expect(pane).toMatch(/isFlyMode:\s*\(\)\s*=>\s*store\.cam === 'free'/)
    // 跳炮击与骑乘都以 shots[].t_fire 序列 / 名册序接线
    expect(pane).toMatch(/findPrevShotTime|findNextShotTime/)
    expect(pane).toMatch(/rosterRideTarget\(/)
  })

  it('飞行速率键（Digit1-6 → setFlySpeed）保持现状，未被骑乘分支改动', () => {
    const fly = readFileSync(resolve(here, '../composables/useSceneFlyControls.ts'), 'utf8')
    expect(fly).toMatch(/\/\^Digit\[1-6\]\$\/\.test\(event\.code\)/)
    expect(fly).toMatch(/adapter\.setFlySpeed\(n\)/)
  })
})
