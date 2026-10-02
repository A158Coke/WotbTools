import { describe, expect, it } from 'vitest'
import {
  PHASE_DRUM_SHELL, PHASE_MAG_INTERVAL, PHASE_START, fillOf, groupByVehicle, inferMagazineSize,
  isPerShellPhase, shellStatesAt, usablePhases,
} from './reloadBar.js'

// 相位条目（facet `reloads` 的形状）：{ clock, eid, phase, duration_s, count }
const clip = (clock, eid, d) => ({ clock, eid, phase: PHASE_START, duration_s: d, count: null })
const mag = (clock, eid, d, count = null) => ({ clock, eid, phase: PHASE_MAG_INTERVAL, duration_s: d, count })
const drum = (clock, eid, d, count = null) => ({ clock, eid, phase: PHASE_DRUM_SHELL, duration_s: d, count })
const states = (arr) => arr.map((s) => s.state)

describe('reloadBar · 可用相位筛选与分组', () => {
  it('收 f2=3/6/7 且带正时长的条目；无时长的 5（就绪/取消）与其他码不参与', () => {
    const list = [clip(1, 7, 12.4), drum(2, 7, 6.5), { clock: 3, eid: 7, phase: 5, duration_s: null, count: 1 },
      { clock: 3.5, eid: 7, phase: 1, duration_s: null, count: 5 }, mag(5, 7, 2.5)]
    expect(usablePhases(list).map((e) => [e.clock, e.phase])).toEqual([[1, 3], [2, 6], [5, 7]])
  })

  it('逐发相位判定：6（弹鼓续装）与 7（夹内间隔）都是逐发；3 是整夹', () => {
    expect(isPerShellPhase(mag(1, 7, 2.5))).toBe(true)
    expect(isPerShellPhase(drum(1, 7, 6.5))).toBe(true)
    expect(isPerShellPhase(clip(1, 7, 12))).toBe(false)
  })

  it('分组按 eid（保留全量条目：未闭环相位码上的 f4 也要用于 N 推断）', () => {
    const m = groupByVehicle([clip(1, 7, 12.4), mag(2, 9, 3), drum(3, 11, 6),
      { clock: 4, eid: 11, phase: 1, duration_s: null, count: 5 }])
    expect([...m.keys()].sort((a, b) => a - b)).toEqual([7, 9, 11])
    expect(m.get(11).length).toBe(2)
  })

  it('只有未闭环相位的车：条目在，但状态恒满（不给未闭环码赋时长语义）', () => {
    const ev = [{ clock: 1, eid: 7, phase: 1, duration_s: null, count: 5 }]
    expect(shellStatesAt(ev, [], 100, 1)).toEqual([{ state: 'full', progress: 1 }])
  })
})

describe('reloadBar · 弹夹容量推断（f4=开火后剩余发数 → N = 最大剩余 + 1）', () => {
  it('单发车（只有整夹相位、无计数）→ 1', () => {
    expect(inferMagazineSize([clip(1, 7, 12.4), clip(30, 7, 12.4)])).toBe(1)
    expect(inferMagazineSize([])).toBe(1)
  })

  it('3 发弹鼓（真实序列：tank 4481，f4 = 2/1，无整夹相位）→ N=3', () => {
    // tournament-14-14-example eid 12558556：客户端 burst_size=3 / burst_interval=2.727
    const ev = [mag(39.97, 7, 2.63, 2), drum(42.56, 7, 6.56, 2), mag(42.86, 7, 2.63, 1),
      drum(45.47, 7, 9.38, 1), drum(54.85, 7, 6.56, 2)]
    expect(inferMagazineSize(ev)).toBe(3)
  })

  it('2 发弹夹（tank 11073，f4=1）→ N=2', () => {
    expect(inferMagazineSize([mag(99.72, 7, 2.5, 1), clip(103.72, 7, 15.63), mag(123.92, 7, 2.5, 1)])).toBe(2)
  })

  it('4 发弹夹（tank 19025，f4 = 3/2/1）→ N=4', () => {
    expect(inferMagazineSize([mag(84.1, 7, 2, 3), mag(86.6, 7, 2, 2), mag(91.0, 7, 2, 1), clip(94.19, 7, 16.93)])).toBe(4)
  })

  it('无 f4 时回退到"整夹之间最长连续夹内间隔串 + 1"', () => {
    const ev = [clip(10, 7, 3), mag(11, 7, 3), mag(12, 7, 3), clip(40, 7, 3), mag(41, 7, 3)]
    expect(inferMagazineSize(ev)).toBe(3)
  })

  it('既无 f4 也无整夹相位 → 1（不拿间隔串猜：单发车也可能连发 f2=7）', () => {
    const ev = [mag(10, 7, 2.63), mag(20, 7, 2.63), mag(30, 7, 2.63), mag(40, 7, 2.63)]
    expect(inferMagazineSize(ev)).toBe(1)
  })

  it('f4 出现在未闭环相位码上时也要用（实测 f2=1 也带剩余发数）：tank 19825 → N=6', () => {
    // XM551 样本：count 分布在 f2=1（5,4,2,1）与 f2=7（3）上 → 最大剩余 5 → N=6
    const ev = [
      { clock: 33.62, eid: 7, phase: 1, duration_s: null, count: 5 },
      { clock: 33.81, eid: 7, phase: 1, duration_s: null, count: 4 },
      mag(34.16, 7, 3, 3),
      { clock: 39.33, eid: 7, phase: 1, duration_s: null, count: 2 },
      { clock: 39.52, eid: 7, phase: 1, duration_s: null, count: 1 },
      clip(39.85, 7, 12.73),
    ]
    expect(inferMagazineSize(ev)).toBe(6)
  })

  it('f2=5 的 f4=1 是"就绪标志"，不参与容量推断（单发车不被推成 2 发）', () => {
    const ev = [clip(10, 7, 12.4), { clock: 22, eid: 7, phase: 5, duration_s: null, count: 1 }]
    expect(inferMagazineSize(ev)).toBe(1)
  })

  it('f4 明显越界（脏数据）→ 退回启发式，不产生荒唐容量', () => {
    // 99 越界被丢弃 → 走"整夹之间最长连续夹内间隔串 + 1" = 2，而不是 100
    expect(inferMagazineSize([mag(10, 7, 2.5, 99), clip(20, 7, 12)])).toBe(2)
    expect(inferMagazineSize([mag(10, 7, 2.5, -1), clip(20, 7, 12)])).toBe(2)
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

  it('弹夹整夹装填：**所有发一起**按同一进度填（不是逐发先后到位）', () => {
    const ev = [clip(10, 7, 4)]
    expect(shellStatesAt(ev, [], 10, 3)).toEqual([
      { state: 'loading', progress: 0 }, { state: 'loading', progress: 0 }, { state: 'loading', progress: 0 }])
    const half = shellStatesAt(ev, [], 12, 3)
    expect(states(half)).toEqual(['loading', 'loading', 'loading'])
    expect(half.map((s) => s.progress)).toEqual([0.5, 0.5, 0.5])
    // 装完才全部可用（整夹一次性到位）
    expect(states(shellStatesAt(ev, [], 14, 3))).toEqual(['full', 'full', 'full'])
  })

  it('夹内单发（f2=7）：打掉一发后只补那一发，其余保持', () => {
    const ev = [clip(10, 7, 4), mag(20, 7, 3)]
    // t=20：已开火 1 发（loaded=2），正在补第 3 发
    expect(states(shellStatesAt(ev, [15], 20, 3))).toEqual(['full', 'full', 'loading'])
    expect(shellStatesAt(ev, [15], 21.5, 3)[2].progress).toBeCloseTo(0.5, 6)
    expect(states(shellStatesAt(ev, [15], 23.5, 3))).toEqual(['full', 'full', 'full'])
  })

  it('弹鼓续装（f2=6）与夹内间隔（f2=7）同式：一次只补最左空位那一发', () => {
    // 真实序列（tank 4481）：开火 39.86（f4=2）→ f2=7 2.63s → f2=6 6.56s
    const ev = [mag(39.97, 7, 2.63, 2), drum(42.56, 7, 6.56, 2), drum(54.85, 7, 6.56, 2)]
    expect(inferMagazineSize(ev)).toBe(3)
    const mid7 = shellStatesAt(ev, [39.86], 40.5, 3)         // f2=7 中途（p≈0.2）
    expect(states(mid7)).toEqual(['full', 'full', 'loading'])
    expect(mid7[2].progress).toBeCloseTo((40.5 - 39.97) / 2.63, 6)
    const mid6 = shellStatesAt(ev, [39.86], 46.0, 3)         // f2=6 中途
    expect(states(mid6)).toEqual(['full', 'full', 'loading'])
  })

  it('手动重装（打掉两发后整夹重装）：静置如实显示空位；重装期间整夹锁住一起填', () => {
    const ev = [clip(10, 7, 4), clip(40, 7, 8)]
    // 打完 2 发后的空档：第 1 发在膛、第 2/3 发空
    expect(states(shellStatesAt(ev, [15, 25], 30, 3))).toEqual(['full', 'empty', 'empty'])
    // 整夹重装中：整夹一起装填（弹夹重装期间不可击发，故不出现"某一发先可用"）
    const mid = shellStatesAt(ev, [15, 25], 42, 3)
    expect(states(mid)).toEqual(['loading', 'loading', 'loading'])
    expect(mid.map((s) => s.progress)).toEqual([0.25, 0.25, 0.25])
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

  it('聚合比：满=1、空档=在膛发数/N、装填中=进度（整夹与逐发同式）', () => {
    const ev = [clip(10, 7, 4), clip(40, 7, 8)]
    expect(fillOf(shellStatesAt(ev, [], 50, 3))).toBe(1)
    expect(fillOf(shellStatesAt(ev, [15], 30, 3))).toBeCloseTo(2 / 3, 6)
    expect(fillOf(shellStatesAt(ev, [15, 25], 30, 3))).toBeCloseTo(1 / 3, 6)
    expect(fillOf(shellStatesAt(ev, [], 12, 3))).toBeCloseTo(0.5, 6)   // 整夹一起装填：聚合 = 进度
  })
})
