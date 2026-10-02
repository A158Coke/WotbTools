import { describe, expect, it } from 'vitest'
import {
  PHASE_MAG_INTERVAL, PHASE_START, fillOf, groupByVehicle, inferMagazineSize, shellStatesAt, usablePhases,
} from './reloadBar.js'

// 相位条目（facet `reloads` 的形状）：{ clock, eid, phase, duration_s, count }
const clip = (clock, eid, d) => ({ clock, eid, phase: PHASE_START, duration_s: d, count: null })
const mag = (clock, eid, d) => ({ clock, eid, phase: PHASE_MAG_INTERVAL, duration_s: d, count: null })
const ready = (clock, eid) => ({ clock, eid, phase: 0, duration_s: 12.4, count: 1 })
const states = (arr) => arr.map((s) => s.state)

describe('reloadBar · 可用相位筛选与分组', () => {
  it('只收 f2=3/7 且带正时长的条目；就绪（f4=1）与未闭环相位码不参与', () => {
    const list = [clip(1, 7, 12.4), ready(2, 7), { clock: 3, eid: 7, phase: 1, duration_s: null, count: 5 },
      { clock: 4, eid: 7, phase: 8, duration_s: null, count: null }, mag(5, 7, 2.5)]
    expect(usablePhases(list).map((e) => [e.clock, e.phase])).toEqual([[1, 3], [5, 7]])
  })

  it('分组按 eid；没有可用相位的车不出现', () => {
    const m = groupByVehicle([clip(1, 7, 12.4), mag(2, 9, 3), ready(3, 11)])
    expect([...m.keys()].sort()).toEqual([7, 9])
  })
})

describe('reloadBar · 弹夹容量推断', () => {
  it('单发车（无弹夹内间隔）→ 1', () => {
    expect(inferMagazineSize([clip(1, 7, 12.4), clip(30, 7, 12.4)])).toBe(1)
    expect(inferMagazineSize([])).toBe(1)
  })
  it('只有弹夹内间隔、没有任何整夹装填 → 1（单发车，如 J39 样本 eid=1467934 的 17 连串）', () => {
    const ev = [mag(10, 7, 2.63), mag(20, 7, 2.63), mag(30, 7, 2.63), mag(40, 7, 2.63)]
    expect(inferMagazineSize(ev)).toBe(1)
  })
  it('3 发弹夹：整夹装填之间 2 次弹夹内间隔 → N=3', () => {
    const ev = [clip(10, 7, 3.0), mag(1, 7, 3), mag(2, 7, 3), clip(40, 7, 3.0), mag(1, 7, 3), mag(2, 7, 3)]
    expect(inferMagazineSize(ev)).toBe(3)
  })
  it('取最长的一串（夹内间隔数不齐时按最大者）', () => {
    const ev = [clip(10, 7, 3.0), mag(1, 7, 3), clip(20, 7, 3.0), mag(1, 7, 3), mag(2, 7, 3), mag(3, 7, 3)]
    expect(inferMagazineSize(ev)).toBe(4)
  })
})

describe('reloadBar · 逐发状态（对齐客户端 Full / Active / Inactive）', () => {
  it('无相位流（敌方/零起点车）→ 恒满，不猜', () => {
    expect(states(shellStatesAt([], [], 100, 1))).toEqual(['full'])
    expect(states(shellStatesAt([], [50], 100, 3))).toEqual(['full', 'full', 'full'])
  })

  it('单发车整夹装填：整条按进度填（0 → 1）', () => {
    const ev = [clip(10, 7, 4), clip(30, 7, 4)]
    expect(shellStatesAt(ev, [], 10, 1)).toEqual([{ state: 'loading', progress: 0 }])
    expect(shellStatesAt(ev, [], 12, 1)[0].progress).toBeCloseTo(0.5, 6)
    expect(states(shellStatesAt(ev, [], 14, 1))).toEqual(['full'])          // 相位走完 = 已就绪
    expect(states(shellStatesAt(ev, [], 5, 1))).toEqual(['full'])           // 第一条相位之前
  })

  it('3 发弹夹整夹装填中：从 0 逐发填（0.5 进度 = 第 1 发满 + 第 2 发半）', () => {
    const ev = [clip(10, 7, 4)]
    expect(states(shellStatesAt(ev, [], 10, 3))).toEqual(['loading', 'empty', 'empty'])
    const half = shellStatesAt(ev, [], 12, 3)
    expect(states(half)).toEqual(['full', 'loading', 'empty'])
    expect(half[1].progress).toBeCloseTo(0.5, 6)
    expect(states(shellStatesAt(ev, [], 14, 3))).toEqual(['full', 'full', 'full'])
  })

  it('弹夹内单发：打掉一发后补一发 → 只该发布入 loading，其余保持', () => {
    const ev = [clip(10, 7, 4), mag(20, 7, 3)]
    // t=20：已开火 1 发（loaded=2），正在补第 3 发
    expect(states(shellStatesAt(ev, [15], 20, 3))).toEqual(['full', 'full', 'loading'])
    expect(shellStatesAt(ev, [15], 21.5, 3)[2].progress).toBeCloseTo(0.5, 6)
    expect(states(shellStatesAt(ev, [15], 23.5, 3))).toEqual(['full', 'full', 'full'])
  })

  it('手动重装（打掉两发后静置再整夹重装）：静置时如实显示只剩一发空位', () => {
    const ev = [clip(10, 7, 4), clip(40, 7, 8)]
    // 打完 2 发后的空档：第 1 发在膛、第 2/3 发空（旧标量模型会画成全满或从 0 重画）
    expect(states(shellStatesAt(ev, [15, 25], 30, 3))).toEqual(['full', 'empty', 'empty'])
    // 整夹重装中（p=0.25 → pos=0.75）：整段时间负责填满 3 发，故第 1 发已填到 75%
    const mid = shellStatesAt(ev, [15, 25], 42, 3)
    expect(states(mid)).toEqual(['loading', 'empty', 'empty'])
    expect(mid[0].progress).toBeCloseTo(0.75, 6)
    // 重装完毕：整夹满
    expect(states(shellStatesAt(ev, [15, 25], 50, 3))).toEqual(['full', 'full', 'full'])
  })

  it('打空整夹后静置：全空（等整夹装填相位）', () => {
    const ev = [clip(10, 7, 4), clip(40, 7, 8)]
    expect(states(shellStatesAt(ev, [15, 25, 35], 38, 3))).toEqual(['empty', 'empty', 'empty'])
  })

  it('求值与调用顺序无关（seek 乱序求值一致）', () => {
    const ev = [clip(10, 7, 4), mag(20, 7, 3)]
    const a = shellStatesAt(ev, [15], 21.5, 3)
    shellStatesAt(ev, [15], 40, 3)
    expect(shellStatesAt(ev, [15], 21.5, 3)).toEqual(a)
  })

  it('聚合比：满=1、空档=在膛发数/N、装填中=含当前发进度', () => {
    const ev = [clip(10, 7, 4), clip(40, 7, 8)]
    expect(fillOf(shellStatesAt(ev, [], 50, 3))).toBe(1)
    expect(fillOf(shellStatesAt(ev, [15], 30, 3))).toBeCloseTo(2 / 3, 6)
    expect(fillOf(shellStatesAt(ev, [15, 25], 30, 3))).toBeCloseTo(1 / 3, 6)
    expect(fillOf(shellStatesAt(ev, [], 12, 3))).toBeCloseTo(1.5 / 3, 6)
  })
})
