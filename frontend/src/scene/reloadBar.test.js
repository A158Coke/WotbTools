import { describe, expect, it } from 'vitest'
import {
  PHASE_AMMO_COUNT, PHASE_DRUM_SHELL, PHASE_DURATION_CHANGE, PHASE_MAG_INTERVAL, PHASE_START, fillOf, groupByVehicle,
  hasPerShellReloads, inferMagazineSize, isTimedAmmoPhase, magazineSizeFromTank, reloadVisualKey, resolveMagazineSize,
  shellStatesAt, usablePhases,
} from './reloadBar.js'

// 相位条目（facet `reloads` 的形状）：{ clock, eid, phase, duration_s, count }
const clip = (clock, eid, d) => ({ clock, eid, phase: PHASE_START, duration_s: d, count: null })
const gap = (clock, eid, d, count = null) => ({ clock, eid, phase: PHASE_MAG_INTERVAL, duration_s: d, count })
const drum = (clock, eid, d, count = null) => ({ clock, eid, phase: PHASE_DRUM_SHELL, duration_s: d, count })
const ammo = (clock, eid, count) => ({ clock, eid, phase: PHASE_AMMO_COUNT, duration_s: null, count })
const chg = (clock, eid, d) => ({ clock, eid, phase: PHASE_DURATION_CHANGE, duration_s: d, count: null })
const states = (arr) => arr.map((s) => s.state)

describe('reloadBar · 相位语义与筛选', () => {
  it('收 f2=3/4/6/7 且带正时长的条目；无时长的 5（就绪/取消）与其他码不参与', () => {
    const list = [clip(1, 7, 12.4), drum(2, 7, 6.5), gap(2.5, 7, 2.7), chg(3.5, 7, 5),
      { clock: 4, eid: 7, phase: 5, duration_s: null, count: 1 },
      { clock: 4.5, eid: 7, phase: 1, duration_s: null, count: 5 }]
    expect(usablePhases(list).map((e) => [e.clock, e.phase])).toEqual([[1, 3], [2, 6], [2.5, 7], [3.5, 4]])
  })

  it('f2=3/6/7 都有定时结束；只有 3/6 在结束时补弹，7 只是夹内推弹间隔', () => {
    expect(isTimedAmmoPhase(clip(1, 7, 12))).toBe(true)
    expect(isTimedAmmoPhase(drum(1, 7, 6.5))).toBe(true)
    expect(isTimedAmmoPhase(gap(1, 7, 2.7))).toBe(true)
    expect(isTimedAmmoPhase(chg(1, 7, 5))).toBe(false)
  })

  it('分组按 eid（保留全量条目：未闭环相位码上的 f4 也要用于 N 推断）', () => {
    const m = groupByVehicle([clip(1, 7, 12.4), gap(2, 9, 3), drum(3, 11, 6),
      { clock: 4, eid: 11, phase: 1, duration_s: null, count: 5 }])
    expect([...m.keys()].sort((a, b) => a - b)).toEqual([7, 9, 11])
    expect(m.get(11).length).toBe(2)
  })

  it('只有未闭环相位的车：条目在，但状态恒满（不给未闭环码赋时长语义）', () => {
    const ev = [{ clock: 1, eid: 7, phase: 1, duration_s: null, count: 5 }]
    expect(shellStatesAt(ev, [], 100, 1)).toEqual([{ state: 'full', progress: 1 }])
  })
})

describe('reloadBar · 重绘视觉签名', () => {
  it('aggregate fill 同为 100% 时仍区分整条 loading 与完成后的 N 格 full', () => {
    const loading = [{ state: 'loading', progress: 0.996 }]
    const full = Array.from({ length: 3 }, () => ({ state: 'full', progress: 1 }))
    expect(Math.round(fillOf(loading) * 100)).toBe(100)
    expect(Math.round(fillOf(full) * 100)).toBe(100)
    expect(reloadVisualKey(loading)).not.toBe(reloadVisualKey(full))
  })

  it('loading 进度在同一 1% 桶内保持稳定，跨桶才变化', () => {
    expect(reloadVisualKey([{ state: 'loading', progress: 0.501 }]))
      .toBe(reloadVisualKey([{ state: 'loading', progress: 0.504 }]))
    expect(reloadVisualKey([{ state: 'loading', progress: 0.504 }]))
      .not.toBe(reloadVisualKey([{ state: 'loading', progress: 0.506 }]))
  })
})

describe('reloadBar · 弹夹容量推断（f4=开火后剩余发数 → N = 最大剩余 + 1）', () => {
  it('单发车（只有整夹相位、无计数）→ 1', () => {
    expect(inferMagazineSize([clip(1, 7, 12.4), clip(30, 7, 12.4)])).toBe(1)
    expect(inferMagazineSize([])).toBe(1)
  })

  it('3 发弹鼓（真实序列：tank 4481，f4 = 2/1，无整夹相位）→ N=3', () => {
    // tournament-14-14-example eid 12558556：客户端 burst_size=3 / burst_interval=2.727 / burst_reloads=[14,10,7]
    const ev = [gap(39.97, 7, 2.63, 2), drum(42.56, 7, 6.56, 2), gap(42.86, 7, 2.63, 1),
      drum(45.47, 7, 9.38, 1), drum(54.85, 7, 6.56, 2)]
    expect(inferMagazineSize(ev)).toBe(3)
  })

  it('2 发弹夹（tank 11073，f4=1）→ N=2', () => {
    expect(inferMagazineSize([gap(99.72, 7, 2.5, 1), clip(103.72, 7, 15.63), gap(123.92, 7, 2.5, 1)])).toBe(2)
  })

  it('4 发弹夹（tank 19025，f4 = 3/2/1）→ N=4', () => {
    expect(inferMagazineSize([gap(84.1, 7, 2, 3), gap(86.6, 7, 2, 2), gap(91.0, 7, 2, 1), clip(94.19, 7, 16.93)])).toBe(4)
  })

  it('f4 出现在未闭环相位码上时也要用（实测 f2=1 也带剩余发数）：tank 19825 → N=6', () => {
    const ev = [
      { clock: 33.62, eid: 7, phase: 1, duration_s: null, count: 5 },
      { clock: 33.81, eid: 7, phase: 1, duration_s: null, count: 4 },
      gap(34.16, 7, 3, 3),
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

  it('无 f4 时回退到"整夹之间最长连续逐发相位串 + 1"', () => {
    const ev = [clip(10, 7, 3), gap(11, 7, 3), gap(12, 7, 3), clip(40, 7, 3), gap(41, 7, 3)]
    expect(inferMagazineSize(ev)).toBe(3)
  })

  it('既无 f4 也无整夹相位 → 1（不拿间隔串猜：单发车也可能连发 f2=7）', () => {
    const ev = [gap(10, 7, 2.63), gap(20, 7, 2.63), gap(30, 7, 2.63)]
    expect(inferMagazineSize(ev)).toBe(1)
  })

  it('f4 明显越界（脏数据）→ 退回启发式，不产生荒唐容量', () => {
    expect(inferMagazineSize([gap(10, 7, 2.5, 99), clip(20, 7, 12)])).toBe(2)
    expect(inferMagazineSize([gap(10, 7, 2.5, -1), clip(20, 7, 12)])).toBe(2)
  })
})

describe('reloadBar · f2=1 = 剩余弹数更新（权威计数）', () => {
  it('无开火事件也能靠 f2=1 得到正确的在膛发数（实测该码 16/16 与开火同刻）', () => {
    const ev = [ammo(33.62, 7, 5), ammo(33.81, 7, 4), ammo(39.33, 7, 2), ammo(39.52, 7, 1)]   // 6 发弹夹
    const full = (k) => Array.from({ length: 6 }, (_, i) => (i < k ? 'full' : 'empty'))
    expect(states(shellStatesAt(ev, [], 33.7, 6))).toEqual(full(5))   // 首条计数 5
    expect(states(shellStatesAt(ev, [], 33.9, 6))).toEqual(full(4))   // 次条计数 4
    expect(states(shellStatesAt(ev, [], 39.6, 6))).toEqual(full(1))   // 最后一条计数 1
  })

  it('计数优先于推导（开火漏报时以协议计数为准）', () => {
    expect(states(shellStatesAt([ammo(20, 7, 0)], [], 25, 3))).toEqual(['empty', 'empty', 'empty'])
  })

  it('计数越界（脏数据/容量推断错）→ 不采纳，退回推导值', () => {
    expect(states(shellStatesAt([ammo(20, 7, 99)], [], 25, 3))).toEqual(['full', 'full', 'full'])
  })
})

describe('reloadBar · 空槽两态：弹鼓 locked(.69) vs 弹夹 used(.25)', () => {
  it('hasPerShellReloads：相位流里有 f2=6（弹鼓按发装填）才为真', () => {
    expect(hasPerShellReloads([gap(1, 7, 2.5), clip(2, 7, 12)])).toBe(false)
    expect(hasPerShellReloads([gap(1, 7, 2.6), drum(2, 7, 6.5)])).toBe(true)
    expect(hasPerShellReloads([])).toBe(false)
  })

  it('弹夹（只有整夹相位）打出的空槽 = used（.250980）', () => {
    const ev = [clip(10, 7, 4), clip(40, 7, 8)]
    expect(states(shellStatesAt(ev, [15, 25], 30, 3))).toEqual(['full', 'empty', 'empty'])
  })

  it('弹鼓（有 f2=6）：f2=6 补的是空槽那格；空闲时空槽 = locked', () => {
    const ev = [drum(10, 7, 5), drum(30, 7, 5)]
    // 打一发（9s，loaded→2）→ f2=6（10~15s）补空槽：B 在第 3 格 → A|A|B
    expect(states(shellStatesAt(ev, [9], 11, 3))).toEqual(['full', 'full', 'loading'])
    // 开火打断 f2=6 → 不结算：空闲分割，空槽 = locked(.69)
    expect(states(shellStatesAt(ev, [9, 12], 16, 3))).toEqual(['full', 'locked', 'locked'])
  })
})

describe('reloadBar · 由客户端坦克数据取容量（静态权威）', () => {
  it('弹夹参数挂在 burst 那个 config 上 → 取 configs 里最大 burst_size', () => {
    // 实测 tank 19825：configs[0] 非弹夹(burst_size 0) / configs[1] burst_size=6
    expect(magazineSizeFromTank({ configs: [{ burst_size: 0 }, { burst_size: 6, burst_interval: 3 }] })).toBe(6)
    // 实测 tank 23329：configs[1] burst_size=3
    expect(magazineSizeFromTank({ configs: [{ burst_size: 0 }, { burst_size: 3 }, { burst_size: 0 }] })).toBe(3)
  })
  it('单发（全部 config burst_size 为 0 / 缺字段）→ 1；越界脏值夹到上限', () => {
    expect(magazineSizeFromTank({ configs: [{ burst_size: 0 }] })).toBe(1)
    expect(magazineSizeFromTank({})).toBe(1)
    expect(magazineSizeFromTank(null)).toBe(1)
    expect(magazineSizeFromTank({ configs: [{ burst_size: 999 }] })).toBe(10)
  })
})

describe('reloadBar · N 的合成（客户端静态为主，相位推断取大）', () => {
  it('客户端静态值优先：4 发弹夹从未打空夹，相位推断=1 时仍用 4', () => {
    expect(resolveMagazineSize({ configs: [{ burst_size: 4 }] }, [clip(10, 7, 12)])).toBe(4)
  })
  it('相位推断更大时取相位（回放真值可纠正静态配置歧义）', () => {
    expect(resolveMagazineSize({ configs: [{ burst_size: 0 }] }, [gap(1, 7, 2.5, 2), drum(2, 7, 6, 2)])).toBe(3)
  })
  it('两边都没有 → 1', () => { expect(resolveMagazineSize({}, [])).toBe(1) })
})

describe('reloadBar · 方法 35（权威有效装填时长）驱动进度', () => {
  it('装填起点采用权威时长（与相位自带时长不同时以 35 为准）', () => {
    const ev = [clip(10, 7, 4)]                      // 相位自带 4s
    const dur = [{ clock: 0, eid: 7, duration_s: 8 }] // 权威 8s
    expect(shellStatesAt(ev, [], 12, 1, dur)[0].progress).toBeCloseTo(0.25, 6)   // (12−10)/8
    expect(shellStatesAt(ev, [], 12, 1)[0].progress).toBeCloseTo(0.5, 6)          // 无 35 时用相位 4s
  })
  it('中途 method 35 缩短时长 → end mark 同步提前，到新 ready 立即完成', () => {
    const ev = [clip(10, 7, 8)]
    const dur = [{ clock: 0, eid: 7, duration_s: 8 }, { clock: 14, eid: 7, duration_s: 4 }]
    // 原 ready=18；14s 时剩余 4s × (4/8)=2s → 新 ready=16。
    expect(shellStatesAt(ev, [], 15, 3, dur)[0].progress).toBeCloseTo(0.75, 6)
    expect(states(shellStatesAt(ev, [], 16, 3, dur))).toEqual(['full', 'full', 'full'])
    expect(states(shellStatesAt(ev, [], 16.5, 3, dur))).toEqual(['full', 'full', 'full'])
  })
  it('中途 method 35 延长时长 → 旧 ready 不得提前结算，直到新 ready 才完成', () => {
    const ev = [clip(10, 7, 8)]
    const dur = [{ clock: 0, eid: 7, duration_s: 8 }, { clock: 14, eid: 7, duration_s: 16 }]
    // 原 ready=18；14s 时剩余 4s × (16/8)=8s → 新 ready=22。
    const mid = shellStatesAt(ev, [], 18.5, 3, dur)
    expect(states(mid)).toEqual(['loading'])
    expect(mid[0].progress).toBeCloseTo(1 - (22 - 18.5) / 16, 6)
    expect(states(shellStatesAt(ev, [], 22, 3, dur))).toEqual(['full', 'full', 'full'])
  })
})

describe('reloadBar · 方法 35 只作用于整夹装填（回归：小装填不得套用长装填刻度）', () => {
  it('f2=7 期间进度按相位时长走，即使存在更长的方法 35 值', () => {
    const ev = [gap(99.72, 7, 2.5, 2), clip(103.72, 7, 15.63)]
    const dur = [{ clock: 0, eid: 7, duration_s: 15.63 }]   // 方法 35 = 长装填 15.63s
    // t=100.97（f2=7 中点）：按 2.5s 走 → 50%（旧 bug：按 15.63s 走 → 只 8%）
    expect(shellStatesAt(ev, [99.62], 100.97, 3, dur)[1].progress).toBeCloseTo(0.5, 4)
    // 同一场的 f2=3 整夹装填：仍用方法 35 的 15.63s 刻度
    expect(shellStatesAt(ev, [99.62, 103.62], 111.5, 3, dur)[0].progress).toBeCloseTo((111.5 - 103.72) / 15.63, 4)
  })
  it('f2=6（弹鼓逐发）同样只用相位时长', () => {
    const ev = [gap(39.97, 7, 2.63, 2), drum(42.56, 7, 6.56, 2)]
    const dur = [{ clock: 0, eid: 7, duration_s: 31 }]      // 方法 35 = 整鼓时长 31s
    const st = shellStatesAt(ev, [39.86], 46.0, 3, dur)
    expect(st[2].progress).toBeCloseTo((46.0 - 42.56) / 6.56, 4)
  })
})

describe('reloadBar · 服务器剩余发数快照（任意相位的 f4 纠开火延迟漂移）', () => {
  it('f2=7 携带的 f4 直接覆盖推导：开火事件缺失时仍正确', () => {
    const ev = [gap(99.72, 7, 2.5, 2)]                     // 无开火事件，服务器计数 2
    expect(states(shellStatesAt(ev, [], 100.5, 3))).toEqual(['full', 'loading', 'empty'])
  })
  it('计数纠正开火推导的漂移（推导以为剩 2，服务器说 1）', () => {
    const ev = [gap(99.72, 7, 2.5, 1)]
    expect(states(shellStatesAt(ev, [99.0], 100.5, 3))).toEqual(['loading', 'empty', 'empty'])
  })
  it('f2=5 的 f4=1 是就绪标志，不当剩余发数用', () => {
    const ev = [clip(10, 7, 12.4), { clock: 22, eid: 7, phase: 5, duration_s: null, count: 1 }]
    expect(states(shellStatesAt(ev, [], 25, 3))).toEqual(['full', 'full', 'full'])
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

  it('弹夹整夹装填（f2=3）：期间**不分割**（一整条按进度延长），装完才分割 A|A|A', () => {
    const ev = [clip(10, 7, 4)]
    const half = shellStatesAt(ev, [], 12, 3)
    expect(states(half)).toEqual(['loading'])          // 整夹装填 = 一根完整条（弹夹装完才能射击）
    expect(half[0].progress).toBeCloseTo(0.5, 6)
    expect(states(shellStatesAt(ev, [], 14, 3))).toEqual(['full', 'full', 'full'])
  })

  it('弹夹（N=3）完整序列：A|A|A → A|B|C → A|A|C → B|C|C → A|C|C → 整条B → A|A|A', () => {
    // 真实形态（tank 11073）：f2=7 @99.72 (2.5s)；f2=3 整夹 @103.72 (15.63s)
    const ev = [gap(99.72, 7, 2.5, 2), clip(103.72, 7, 15.63)]
    // 开局满弹 → 分割 A|A|A
    expect(states(shellStatesAt(ev, [], 99.0, 3))).toEqual(['full', 'full', 'full'])
    // 打第 1 发（99.62）：f2=7 推弹上膛期间 → A|B|C（B = 正推上膛那格）
    const d = shellStatesAt(ev, [99.62], 100.5, 3)
    expect(states(d)).toEqual(['full', 'loading', 'empty'])
    expect(d[1].progress).toBeCloseTo((100.5 - 99.72) / 2.5, 4)
    // 小装填完成 → A|A|C（**不补弹**：3 发夹打掉 1 发 = 2 在膛 + 1 空）
    expect(states(shellStatesAt(ev, [99.62], 102.6, 3))).toEqual(['full', 'full', 'empty'])
    // 打第 2 发（101.5，打断 f2=7 的结算）→ 空档：1 在膛 → A|C|C
    expect(states(shellStatesAt(ev, [99.62, 101.5], 102.0, 3))).toEqual(['full', 'empty', 'empty'])
    // 打空第 3 发（103.6）→ f2=3 整夹装填：**一整条不分割**
    const mid = shellStatesAt(ev, [99.62, 101.5, 103.6], 111.5, 3)
    expect(states(mid)).toEqual(['loading'])
    expect(mid[0].progress).toBeCloseTo((111.5 - 103.72) / 15.63, 4)
    // 整夹装完 → 恢复分割 A|A|A
    expect(states(shellStatesAt(ev, [99.62, 101.5, 103.6], 120.0, 3))).toEqual(['full', 'full', 'full'])
  })

  it('弹鼓（N=3）：打一发 A|B|C → f2=6 补空槽 A|A|B → 满 A|A|A', () => {
    // 真实序列（tank 4481）：开火 39.86（f4=2）→ f2=7 2.63s → f2=6 6.56s（补第 3 槽）
    const ev = [gap(39.97, 7, 2.63, 2), drum(42.56, 7, 6.56, 2)]
    expect(inferMagazineSize(ev)).toBe(3)
    // f2=7 推弹期间 → A|B|C（与弹夹同形；弹鼓的空槽档是 locked(.69)）
    expect(states(shellStatesAt(ev, [39.86], 41.0, 3))).toEqual(['full', 'loading', 'locked'])
    // f2=6（42.56~49.12）补空槽：B 在第 3 格 → A|A|B
    const mid = shellStatesAt(ev, [39.86], 46.0, 3)
    expect(states(mid)).toEqual(['full', 'full', 'loading'])
    expect(mid[2].progress).toBeCloseTo((46.0 - 42.56) / 6.56, 6)
    // f2=6 完成 → 该槽补回 → A|A|A
    expect(states(shellStatesAt(ev, [39.86], 49.3, 3))).toEqual(['full', 'full', 'full'])
  })

  it('装填被开火打断 → 不结算（那发没到位）', () => {
    const ev = [drum(10, 7, 5)]
    // 12s 时开火打断；15s（原定结束）之后也不该把打出的那发算回来（弹鼓空槽 = locked）
    expect(states(shellStatesAt(ev, [12], 16, 3))).toEqual(['full', 'full', 'locked'])
  })

  it('整夹装填中途时长变更（f2=4）→ **按比例缩放剩余时间**（不是重置基准）', () => {
    // f2=4 给的是"新生效的完整配置时长"（实测每车仅少数几档）。硬约束检验「开火不得早于就绪」：
    // 重置基准 9/120 违例、缩放剩余 1/120，故采用后者。
    const ev = [clip(40, 7, 8), chg(44, 7, 4)]      // 原就绪 48；44s 时改为 4s 档（比例 0.5）
    // 剩余 (48−44)=4s × 0.5 = 2s → 新就绪 46 → t=45 时进度 = 1 − 1/4 = 0.75（重置基准只会给 0.25）
    expect(shellStatesAt(ev, [], 45, 2).map((s) => s.progress)).toEqual([0.75])   // 不分割：单格
    expect(shellStatesAt(ev, [], 43, 2).map((s) => s.progress)).toEqual([0.375])   // 变更前仍按原 8s 档
    expect(shellStatesAt(ev, [], 46, 2).map((s) => s.progress)).toEqual([1, 1])   // 装完 → 恢复分割
    // 变长方向同理：改为 16s 档（比例 2）→ 剩余 4s×2 = 8s → 新就绪 52 → t=48 进度 = 1 − 4/16 = 0.75
    const ev2 = [clip(40, 7, 8), chg(44, 7, 16)]
    expect(shellStatesAt(ev2, [], 48, 2).map((s) => s.progress)).toEqual([0.75])
  })

  it('手动重装（打掉两发后整夹重装）：静置如实显示空位；重装期间整夹锁住一起填', () => {
    const ev = [clip(10, 7, 4), clip(40, 7, 8)]
    expect(states(shellStatesAt(ev, [15, 25], 30, 3))).toEqual(['full', 'empty', 'empty'])
    const mid = shellStatesAt(ev, [15, 25], 42, 3)     // 整夹装填期间不分割：单格按进度
    expect(states(mid)).toEqual(['loading'])
    expect(mid[0].progress).toBeCloseTo(0.25, 6)
    expect(states(shellStatesAt(ev, [15, 25], 50, 3))).toEqual(['full', 'full', 'full'])
  })

  it('打空整夹后静置：全空（等整夹装填相位）', () => {
    const ev = [clip(10, 7, 4), clip(40, 7, 8)]
    expect(states(shellStatesAt(ev, [15, 25, 35], 38, 3))).toEqual(['empty', 'empty', 'empty'])
  })

  it('求值与调用顺序无关（seek 乱序求值一致）', () => {
    const ev = [clip(10, 7, 4), drum(20, 7, 3)]
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
