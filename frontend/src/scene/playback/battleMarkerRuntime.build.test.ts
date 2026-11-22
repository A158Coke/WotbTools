// battleMarkerRuntime 数据面单测：事件源构建（fail-closed 逐条丢弃）、来源卡解析、
// 扇区矩形聚合与坐标镜像。窗口状态/帧行为见 battleMarkerRuntime.test.ts 与
// battleMarkerRuntime.wiring.test.ts。
// mapSemantics 用 importOriginal 包装：默认走真实档案，单测按用例临时注入合成档案。
import { describe, expect, it, vi } from 'vitest'
import { attention } from './battleMarkerRuntime.test.harness.js'
import {
  buildMarkerEvents,
  markerSourceCard,
  sectorRectForMapKey,
  sectorRectFromCells,
} from './markerRuntime.js'

const profileHolder = vi.hoisted(() => ({
  fn: null as null | ((mapKey: string | number) => unknown),
}))
vi.mock('../../data/mapSemantics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/mapSemantics.js')>()
  return {
    ...actual,
    mapGridProfile: (mapKey: string | number) =>
      profileHolder.fn ? profileHolder.fn(mapKey) : actual.mapGridProfile(mapKey),
  }
})

describe('buildMarkerEvents（数据面 → 场景事件，fail-closed）', () => {
  it('0x2e markers：type1 带 at → ping（x 镜像 + 来源 eid/account）；4/5 → attack/retreat 目标；id = 稳定 key', () => {
    const events = buildMarkerEvents({
      markers: [
        { t: 10, entity_id: 1, account_id: 11, marker_type: 1, at: [30, 5, 70] },
        { t: 12, entity_id: 1, account_id: 11, marker_type: 4, target_eid: 42 },
        { t: 14, entity_id: 1, account_id: 11, marker_type: 5, target_eid: 7 },
      ],
    }, null)
    expect(events).toEqual([
      { id: '0', t: 10, kind: 'ping', x: -30, z: 70, srcEid: 1, srcAccount: 11 },
      { id: '1', t: 12, kind: 'target', intent: 'attack', eid: 42, srcEid: 1, srcAccount: 11 },
      { id: '2', t: 14, kind: 'target', intent: 'retreat', eid: 7, srcEid: 1, srcAccount: 11 },
    ])
  })

  it('畸形 payload 逐条丢弃：缺 at / 非法坐标 / 非法 target / 未知 marker_type / 缺 t', () => {
    const events = buildMarkerEvents({
      markers: [
        { t: 1, entity_id: 1, account_id: 11, marker_type: 1 },                    // 缺 at
        { t: 2, entity_id: 1, account_id: 11, marker_type: 1, at: [1, NaN, 3] },   // 坐标脏值
        { t: 3, entity_id: 1, account_id: 11, marker_type: 4 },                    // 缺 target_eid
        { t: 4, entity_id: 1, account_id: 11, marker_type: 4, target_eid: -5 },    // 非正整数
        { t: 5, entity_id: 1, account_id: 11, marker_type: 9 },                    // 未知类型不消费
        { entity_id: 1, account_id: 11, marker_type: 1, at: [0, 0, 0] },           // 缺 t
      ],
    }, null)
    expect(events).toEqual([])
  })

  it('attention_to_cell：扇区号域内 + 档案有格 → sector（区域并集、x 镜像、sender 作来源）；缺档案/域外丢弃', () => {
    profileHolder.fn = () => ({
      gridCells: [
        { id: 'B3', nineGridRegion: 6, bounds: { xMin: 10, yMin: 20, xMax: 40, yMax: 50 } },
        { id: 'B2', nineGridRegion: 6, bounds: { xMin: -20, yMin: 20, xMax: 10, yMax: 50 } },
        { id: 'A1', nineGridRegion: 1, bounds: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 } },
      ],
    })
    try {
      // region 6 并集 = 语义系 (-20..40, 20..50) → 场景系 x 镜像 = (-40..20)
      expect(buildMarkerEvents({ chat_events: [attention(3, 6, ' 队友 ')] }, 'some-map')).toEqual([
        { id: '0', t: 3, kind: 'sector', region: 6, rect: { xMin: -40, zMin: 20, xMax: 20, zMax: 50 }, source: '队友' },
      ])
      // 缺档案：指令丢弃，不猜坐标
      profileHolder.fn = () => null
      expect(buildMarkerEvents({ chat_events: [attention(3, 6)] }, 'some-map')).toEqual([])
      // 域外扇区号（0 / 10）丢弃
      profileHolder.fn = () => ({ gridCells: [] })
      for (const target of [0, 10]) {
        expect(buildMarkerEvents({ chat_events: [attention(3, target)] }, 'some-map')).toEqual([])
      }
    } finally {
      profileHolder.fn = null
    }
  })

  it('事件表按 t 升序（markers 与 chat 指令混排；id 跟随最终次序）', () => {
    profileHolder.fn = () => ({ gridCells: [{ id: 'C1', nineGridRegion: 7, bounds: { xMin: 0, yMin: 0, xMax: 5, yMax: 5 } }] })
    try {
      const events = buildMarkerEvents({
        markers: [{ t: 9, entity_id: 1, account_id: 11, marker_type: 1, at: [1, 2, 3] }],
        chat_events: [attention(4, 7)],
      }, 'k')
      expect(events.map((e) => [e.id, e.t])).toEqual([['0', 4], ['1', 9]])
    } finally {
      profileHolder.fn = null
    }
  })
})

describe('markerSourceCard（来源卡解析）', () => {
  it('名 + 车 → 两行；缺一补一；占位名 tank_<id> 不上 UI（表命中用真名）；全缺 → null', () => {
    expect(markerSourceCard({ nickname: 'Anonyme', tank_name: 'BZT-70', tank_id: 1 })).toEqual({ player: 'Anonyme', tank: 'BZT-70' })
    expect(markerSourceCard({ nickname: 'Anonyme', tank_name: 'tank_14129', tank_id: 14129 }, (id) => (id === 14129 ? 'Tiger II' : undefined)))
      .toEqual({ player: 'Anonyme', tank: 'Tiger II' })
    // 占位名 + 表未命中 → 只出玩家行（tank 行为空不上）
    expect(markerSourceCard({ nickname: 'Anonyme', tank_name: 'tank_14129', tank_id: 14129 })).toEqual({ player: 'Anonyme', tank: '' })
    expect(markerSourceCard({ nickname: 'Anonyme', tank_name: '', tank_id: 1 })).toEqual({ player: 'Anonyme', tank: '' })
    expect(markerSourceCard({ nickname: '', tank_name: 'BZT-70', tank_id: 1 })).toEqual({ player: '', tank: 'BZT-70' })
    expect(markerSourceCard({ nickname: '  ', tank_name: 'tank_9', tank_id: 9 })).toBeNull()
    expect(markerSourceCard(null)).toBeNull()
  })
})

describe('sectorRectFromCells / sectorRectForMapKey（区域聚合 + 坐标镜像）', () => {
  it('并集同 MapOverview 口径；无格 / 脏 bounds → null', () => {
    const cells = [
      { id: 'A1', nineGridRegion: 1, bounds: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 } },
      { id: 'A2', nineGridRegion: 1, bounds: { xMin: 10, yMin: 0, xMax: 20, yMax: 10 } },
      { id: 'F1', nineGridRegion: 7, bounds: { xMin: -50, yMin: -60, xMax: -40, yMax: -50 } },
      { id: 'dirty', nineGridRegion: 2, bounds: { xMin: 0, yMin: NaN, xMax: 5, yMax: 5 } },
    ]
    expect(sectorRectFromCells(cells, 1)).toEqual({ xMin: -20, zMin: 0, xMax: 0, zMax: 10 })
    expect(sectorRectFromCells(cells, 2)).toBeNull()
    expect(sectorRectFromCells(cells, 3)).toBeNull()
    expect(sectorRectFromCells(null, 1)).toBeNull()
  })

  it('真实语义档案：erlenberg 九宫格 1..9 各有矩形、成 tile（3D 与 2D 概览同一聚合）', () => {
    profileHolder.fn = null   // 走真实档案
    const rects = new Map<number, NonNullable<ReturnType<typeof sectorRectForMapKey>>>()
    for (let region = 1; region <= 9; region++) {
      const rect = sectorRectForMapKey('erlenberg', region)
      expect(rect, `region ${region}`).toBeTruthy()
      rects.set(region, rect!)
    }
    // 九个区域两两内部不相交（同一套 gridCells 的 tile 划分）
    const keys = [...rects.keys()]
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = rects.get(keys[i])!, b = rects.get(keys[j])!
        const disjoint = a.xMax <= b.xMin || b.xMax <= a.xMin || a.zMax <= b.zMin || b.zMax <= a.zMin
        expect(disjoint, `region ${keys[i]} vs ${keys[j]}`).toBe(true)
      }
    }
    // fail-closed：缺档 key → null
    expect(sectorRectForMapKey('no-such-map-key', 6)).toBeNull()
    expect(sectorRectForMapKey(null, 6)).toBeNull()
  })
})
