// transientFeedback3d 单测（#820 Wave B6B）：假钟 + 假车辆/覆盖层，断言的是出仓前
// playbackScene.js 的既有语义——血量链事件源、回放时钟游标、壁钟寿命幽灵段/受击闪、
// seek 不补播。
import { describe, expect, it, vi } from 'vitest'
import {
  createTransientFeedback3d,
  type TransientData,
  type TransientFeedback3dDeps,
  type TransientVehicle,
} from './transientFeedback3d.js'

function vehicle(eid: number, maxHp: number, visible = true): TransientVehicle {
  return { def: { eid, max_hp: maxHp }, group: { visible } }
}

interface Harness {
  deps: TransientFeedback3dDeps
  clock: { ms: number }
  spawnDamage: ReturnType<typeof vi.fn>
  clearDamages: ReturnType<typeof vi.fn>
  clearFx: ReturnType<typeof vi.fn>
  invalidate: ReturnType<typeof vi.fn>
  invalidateLabels: ReturnType<typeof vi.fn>
  bursts: number[]
  setData: (d: TransientData) => void
  setVehicles: (v: TransientVehicle[], deaths?: Map<number, number[]>) => void
}

function makeHarness(opts: {
  data?: TransientData
  vehicles?: TransientVehicle[]
  deaths?: Map<number, number[]>
} = {}): Harness {
  const clock = { ms: 0 }
  let data = opts.data ?? { vehicles: [] }
  let vehicles = opts.vehicles ?? []
  let deaths = opts.deaths ?? new Map<number, number[]>()
  const spawnDamage = vi.fn()
  const clearDamages = vi.fn()
  const clearFx = vi.fn()
  const invalidate = vi.fn()
  const invalidateLabels = vi.fn()
  const bursts: number[] = []
  const deps: TransientFeedback3dDeps = {
    getData: () => data,
    getVehicles: () => vehicles,
    deathTimesOf: (v) => deaths.get(v.def.eid) ?? [],
    getLabelOverlay: () => ({ spawnDamage, clearDamages }),
    getBattleFx: () => ({ clearTransients: clearFx }),
    invalidateLabels,
    invalidate,
    now: () => clock.ms,
    scale: 2,
    floatDmgMs: 1000,
    ghostMs: 500,
    flashMs: 100,
    onBurst: (eid) => bursts.push(eid),
  }
  return {
    deps, clock, spawnDamage, clearDamages, clearFx, invalidate, invalidateLabels, bursts,
    setData: (d) => { data = d },
    setVehicles: (v, map) => { vehicles = v; if (map) deaths = map },
  }
}

describe('事件源', () => {
  it('伤害来自血量链下降：只收 loss>0，按时间升序', () => {
    const h = makeHarness({
      data: {
        vehicles: [
          { eid: 1, hp: [[0, 1000], [10, 800], [20, 800], [30, 500]] },
          { eid: 2, hp: [[5, 100], [8, 160]] },   // 上涨不算伤害
        ],
      },
      vehicles: [vehicle(1, 1000), vehicle(2, 100)],
    })
    const t = createTransientFeedback3d(h.deps)
    t.rebuildSources()
    const seen: Array<[number, number, number]> = []
    h.deps.onBurst = () => {}
    // 用 advanceTo 逐秒推进观察（伤害事件没有公开读接口）
    for (let sec = 0; sec <= 40; sec++) {
      const before = h.spawnDamage.mock.calls.length
      t.advanceTo(sec)
      for (let i = before; i < h.spawnDamage.mock.calls.length; i++) {
        const [eid, loss] = h.spawnDamage.mock.calls[i]
        seen.push([sec, eid, loss])
      }
    }
    expect(seen).toEqual([[10, 1, 200], [30, 1, 300]])
  })

  it('kills 原地升序（击杀流/比分依赖）', () => {
    const data: TransientData = { vehicles: [], kills: [{ t: 30 }, { t: 10 }] }
    const t = createTransientFeedback3d(makeHarness({ data }).deps)
    t.rebuildSources()
    expect(data.kills?.map((k) => k.t)).toEqual([10, 30])
  })

  it('击毁事件按每次死亡生成并升序（复活模式同一 eid 多次）', () => {
    const h = makeHarness({
      vehicles: [vehicle(1, 100), vehicle(2, 100)],
      deaths: new Map([[1, [40, 12]], [2, [20]]]),
    })
    const t = createTransientFeedback3d(h.deps)
    t.rebuildSources()
    t.advanceTo(100)
    expect(h.bursts).toEqual([1, 2, 1])   // 12 → 20 → 40
  })
})

describe('回放时钟游标', () => {
  it('advanceTo 只触发到期事件，重复调用不重放', () => {
    const h = makeHarness({ vehicles: [vehicle(1, 100)], deaths: new Map([[1, [10]]]) })
    const t = createTransientFeedback3d(h.deps)
    t.rebuildSources()
    t.advanceTo(9)
    expect(h.bursts).toEqual([])
    t.advanceTo(10)
    t.advanceTo(10)
    expect(h.bursts).toEqual([1])
  })

  it('rewind(t) 把两个游标都放到 t 之后：不补播历史', () => {
    const h = makeHarness({
      data: { vehicles: [{ eid: 1, hp: [[10, 1000], [20, 900]] }] },
      vehicles: [vehicle(1, 1000)],
      deaths: new Map([[1, [15]]]),
    })
    const t = createTransientFeedback3d(h.deps)
    t.rebuildSources()
    t.rewind(25)
    t.advanceTo(25)
    expect(h.spawnDamage).not.toHaveBeenCalled()
    expect(h.bursts).toEqual([])
  })

  it('rewindBursts 只动击毁游标（会话开战时刻的伤害事件仍会触发）', () => {
    const h = makeHarness({
      data: { vehicles: [{ eid: 1, hp: [[0, 1000], [5, 900]] }] },
      vehicles: [vehicle(1, 1000)],
      deaths: new Map([[1, [5]]]),
    })
    const t = createTransientFeedback3d(h.deps)
    t.rebuildSources()
    t.rewindBursts(0)
    t.advanceTo(5)
    expect(h.spawnDamage).toHaveBeenCalledTimes(1)
    expect(h.bursts).toEqual([1])
  })

  it('resyncBursts(t) 重建击毁源并跳过 t 之前的爆炸', () => {
    const h = makeHarness({ vehicles: [vehicle(1, 100)], deaths: new Map([[1, [10]]]) })
    const t = createTransientFeedback3d(h.deps)
    t.rebuildSources()
    t.resyncBursts(20)
    t.advanceTo(30)
    expect(h.bursts).toEqual([])
  })
})

describe('伤害反馈（伤害数字 + 幽灵段 + 受击闪）', () => {
  it('可见车辆：spawnDamage 用 3D 时长倍率；幽灵段覆盖掉血前后比例', () => {
    const h = makeHarness({
      data: { vehicles: [{ eid: 1, hp: [[0, 1000], [10, 800]] }] },
      vehicles: [vehicle(1, 1000)],
    })
    const t = createTransientFeedback3d(h.deps)
    t.rebuildSources()
    t.advanceTo(10)
    expect(h.spawnDamage).toHaveBeenCalledWith(1, 200, 2000)   // 1000 ms × scale 2
    expect(t.ghostOf(1)).toMatchObject({ fromFrac: 0.8, toFrac: 1, bornMs: 0, untilMs: 1000 })
    expect(t.hasFlash(1)).toBe(true)
    expect(h.invalidateLabels).toHaveBeenCalled()
  })

  it('连续受击：同一条幽灵段向下延伸并重启寿命，不叠第二段', () => {
    const h = makeHarness({
      data: { vehicles: [{ eid: 1, hp: [[0, 1000], [10, 800], [20, 500]] }] },
      vehicles: [vehicle(1, 1000)],
    })
    const t = createTransientFeedback3d(h.deps)
    t.rebuildSources()
    t.advanceTo(10)
    h.clock.ms = 300
    t.advanceTo(20)
    expect(t.ghostOf(1)).toMatchObject({ fromFrac: 0.5, toFrac: 1, bornMs: 300, untilMs: 1300 })
  })

  it('幽灵段过期后再次受击：沿用上一段的终点比例不再延续', () => {
    const h = makeHarness({
      data: { vehicles: [{ eid: 1, hp: [[0, 1000], [10, 800], [20, 900], [30, 700]] }] },
      vehicles: [vehicle(1, 1000)],
    })
    const t = createTransientFeedback3d(h.deps)
    t.rebuildSources()
    t.advanceTo(10)                  // 1000 → 800
    h.clock.ms = 5000                // 远超过 untilMs=1000
    t.advanceTo(30)                  // 900 → 700（中间 800→900 是回血，不算伤害）
    expect(t.ghostOf(1)).toMatchObject({ fromFrac: 0.7, toFrac: 0.9 })
  })

  it('不可见车辆：不出伤害数字/幽灵段/受击闪', () => {
    const h = makeHarness({
      data: { vehicles: [{ eid: 1, hp: [[0, 1000], [10, 800]] }] },
      vehicles: [vehicle(1, 1000, false)],
    })
    const t = createTransientFeedback3d(h.deps)
    t.rebuildSources()
    t.advanceTo(10)
    expect(h.spawnDamage).not.toHaveBeenCalled()
    expect(t.ghostOf(1)).toBeUndefined()
    expect(t.hasFlash(1)).toBe(false)
  })

  it('max_hp 无效：不出幽灵段，但仍记受击闪', () => {
    const h = makeHarness({
      data: { vehicles: [{ eid: 1, hp: [[0, 100], [10, 50]] }] },
      vehicles: [vehicle(1, 0)],
    })
    const t = createTransientFeedback3d(h.deps)
    t.rebuildSources()
    t.advanceTo(10)
    expect(t.ghostOf(1)).toBeUndefined()
    expect(t.hasFlash(1)).toBe(true)
  })
})

describe('壁钟寿命与清理', () => {
  it('updateNow 过期清理并请求重绘；无变化时返回 false', () => {
    const h = makeHarness({
      data: { vehicles: [{ eid: 1, hp: [[0, 1000], [10, 800]] }] },
      vehicles: [vehicle(1, 1000)],
    })
    const t = createTransientFeedback3d(h.deps)
    t.rebuildSources()
    t.advanceTo(10)
    expect(t.hasActive()).toBe(true)

    h.clock.ms = 500
    expect(t.updateNow()).toBe(true)       // 闪光 until=200 先到期
    expect(t.hasFlash(1)).toBe(false)
    expect(t.ghostOf(1)).toBeDefined()

    h.clock.ms = 1000
    expect(t.updateNow()).toBe(true)       // 幽灵 until=1000
    expect(t.ghostOf(1)).toBeUndefined()
    expect(t.hasActive()).toBe(false)
    expect(h.invalidate).toHaveBeenCalled()
    expect(t.updateNow()).toBe(false)      // 无变化
  })

  it('clear 清空壁钟状态并调用覆盖层/FX 的清理', () => {
    const h = makeHarness({
      data: { vehicles: [{ eid: 1, hp: [[0, 1000], [10, 800]] }] },
      vehicles: [vehicle(1, 1000)],
    })
    const t = createTransientFeedback3d(h.deps)
    t.rebuildSources()
    t.advanceTo(10)
    t.clear()
    expect(h.clearDamages).toHaveBeenCalledTimes(1)
    expect(h.clearFx).toHaveBeenCalledTimes(1)
    expect(t.hasActive()).toBe(false)
    expect(t.ghostOf(1)).toBeUndefined()
  })
})