// battleMarkerRuntime 单测：假场景 + 假车辆位姿/名册，断言出仓前的既有语义——
// 事件源构建（fail-closed 逐条丢弃）、**回放时钟窗口状态**（update(T) 幂等重算：
// 窗内常驻、暂停冻结、倒带重现、播过消失）、末段淡出、扇区出现闪烁、池上限、
// 来源卡解析（labelSources：玩家+坦克两行、占位名纪律、sender 联册）。
// mapSemantics 用 importOriginal 包装：默认走真实档案（glob 索引在 vitest 可用），
// 单测按用例临时注入合成档案，用毕恢复。
import { describe, expect, it, vi } from 'vitest'
import { PLAYBACK_SCENE_SOURCE } from '../playbackScene.test.source.js'
import * as THREE from 'three'
import { resolveActiveAccount, resolveActiveSender } from './battleMarkerHost.js'
import {
  MARKER_FLASH_S,
  MARKER_LIFETIME_S,
  MARKER_MAX_ACTIVE,
  TARGET_FLASH_MIN,
  TARGET_FLASH_PERIOD_S,
  TARGET_FLASH_S,
  buildMarkerEvents,
  createMarkerRuntime,
  markerSourceCard,
  sectorRectForMapKey,
  sectorRectFromCells,
  type MarkerRuntimeDeps,
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

interface Harness {
  deps: MarkerRuntimeDeps
  t: { v: number }
  scene: { added: THREE.Object3D[]; removed: THREE.Object3D[] }
  poses: Map<number, { x: number; z: number } | null>
  /** 历史位姿表（getPoseAt；x = at(t) 函数——help 发令时刻语义用） */
  posesAt: Map<number, { z: number; at(t: number): number }>
  sources: Map<number, { nickname?: string; tank_name?: string; tank_id?: number } | null>
  byNickname: Map<string, { nickname?: string; tank_name?: string; tank_id?: number } | null>
  invalidate: ReturnType<typeof vi.fn>
}

function makeHarness(opts: {
  poses?: Map<number, { x: number; z: number } | null>
  posesAt?: Map<number, { z: number; at(t: number): number }>
  sources?: Map<number, { nickname?: string; tank_name?: string; tank_id?: number } | null>
  byNickname?: Map<string, { nickname?: string; tank_name?: string; tank_id?: number } | null>
} = {}): Harness {
  const t = { v: 100 }
  const scene = {
    added: [] as THREE.Object3D[],
    removed: [] as THREE.Object3D[],
    add(o: THREE.Object3D) { scene.added.push(o) },
    remove(o: THREE.Object3D) { scene.removed.push(o) },
  }
  const poses = opts.poses ?? new Map()
  const posesAt = opts.posesAt ?? new Map()
  const sources = opts.sources ?? new Map()
  const byNickname = opts.byNickname ?? new Map()
  const invalidate = vi.fn()
  const deps: MarkerRuntimeDeps = {
    getScene: () => scene as unknown as THREE.Scene,
    groundY: () => 3,
    getVehiclePose: (eid, _t, out) => {
      const p = poses.get(eid)
      if (!p) return false
      out.set(p.x, 3, p.z)
      return true
    },
    // 历史位姿（发令时刻采样；不做当前帧 gate——评审 P2 的 help 语义）
    getPoseAt: (eid, t, out) => {
      const p = posesAt.get(eid)
      if (!p) return false
      out.set(p.at(t), 3, p.z)
      return true
    },
    describeSource: (eid, accountId) => sources.get(eid) ?? sources.get(accountId) ?? null,
    findByNickname: (nickname) => byNickname.get(nickname) ?? null,
    tankNameOf: (tankId) => (tankId === 14129 ? 'Tiger II' : undefined),
    getT: () => t.v,
    invalidate,
  }
  return { deps, t, scene, poses, posesAt, sources, byNickname, invalidate }
}

const attention = (t: number, target: number, sender = '发布者') => ({
  t, kind: 'command' as const, raw_type: 1, channel: 0, sender,
  command_name: 'attention_to_cell', target,
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

describe('markerRuntime（回放时钟窗口状态：常驻 / 冻结 / 重现 / 淡出 / 闪烁）', () => {
  function runtimeWith(h: Harness, data: Parameters<typeof buildMarkerEvents>[0], mapKey: string | null = null) {
    const rt = createMarkerRuntime(h.deps)
    rt.buildSession(data, mapKey)
    return rt
  }

  it('窗口内常驻：update(T) 落场景（ping 环+柱、目标环、扇区面+描边带）；目标查不到位姿不画', () => {
    const h = makeHarness({ poses: new Map([[42, { x: 5, z: 6 }]]) })
    profileHolder.fn = () => ({ gridCells: [{ id: 'B3', nineGridRegion: 6, bounds: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 } }] })
    try {
      const rt = runtimeWith(h, {
        markers: [
          { t: 10, entity_id: 1, account_id: 11, marker_type: 1, at: [30, 5, 70] },
          { t: 12, entity_id: 1, account_id: 11, marker_type: 4, target_eid: 42 },
          { t: 13, entity_id: 1, account_id: 11, marker_type: 4, target_eid: 999 },   // 位姿缺失
        ],
        chat_events: [attention(12, 6)],
      }, 'some-map')
      rt.update(9)
      expect(h.scene.added).toHaveLength(0)
      rt.update(12)   // 窗口进入：t=10 ping、t=12 attack 环、t=12 扇区同时可见
      // ping（环+柱）+ attack 目标环 + 扇区（面+描边带）；位姿缺失的 999 不画
      expect(h.scene.added).toHaveLength(5)
      // 幂等：同 T 重复 update 不重复落场景
      rt.update(12)
      expect(h.scene.added).toHaveLength(5)
      expect(h.invalidate).toHaveBeenCalled()
    } finally {
      profileHolder.fn = null
    }
  })

  it('暂停冻结：T 不推进时重复 update 状态不变，不因壁钟流逝而消失（替换首版壁钟瞬态的回归）', () => {
    const h = makeHarness()
    const rt = runtimeWith(h, { markers: [{ t: 1, entity_id: 1, account_id: 11, marker_type: 1, at: [0, 0, 0] }] })
    rt.update(1)
    expect(h.scene.added).toHaveLength(2)
    for (let i = 0; i < 10; i++) rt.update(1)
    expect(h.scene.added).toHaveLength(2)
    expect(h.scene.removed).toHaveLength(0)
  })

  it('倒带重现：出窗移除、回窗重落场景（同一事件引用，确定性状态）', () => {
    const h = makeHarness()
    const rt = runtimeWith(h, { markers: [{ t: 10, entity_id: 1, account_id: 11, marker_type: 1, at: [0, 0, 0] }] })
    rt.update(15)
    expect(h.scene.added).toHaveLength(2)
    rt.update(5)                        // 倒带到下发前：移除
    expect(h.scene.removed).toHaveLength(2)
    const base = h.scene.added.length
    rt.update(12)                       // 重进窗口：重新落场景（重现）
    expect(h.scene.added.length - base).toBe(2)
    rt.update(10 + MARKER_LIFETIME_S)   // 窗口右端（含端点）：仍可见
    expect(h.scene.added.length - base).toBe(2)
    rt.update(10 + MARKER_LIFETIME_S + 0.1)   // 播过窗口：消失
    expect(h.scene.removed).toHaveLength(4)
  })

  it('末段淡出 + 扇区出现闪烁（确定性回放时钟相位；暂停冻结在当前相位）', () => {
    const h = makeHarness()
    profileHolder.fn = () => ({ gridCells: [{ id: 'B3', nineGridRegion: 6, bounds: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 } }] })
    try {
      const rt = runtimeWith(h, {
        markers: [{ t: 1, entity_id: 1, account_id: 11, marker_type: 1, at: [0, 0, 0] }],
        chat_events: [attention(1, 6)],
      }, 'k')
      rt.update(1)
      const ring = h.scene.added[0] as THREE.Mesh
      const ringMat = ring.material as THREE.MeshBasicMaterial
      // 扇区描边带（ objs[2] = fill? 顺序：fill、border —— scene.added 顺序 = ping 环、柱、扇区 fill、border）
      const sectorFill = h.scene.added[2] as THREE.Mesh
      const sectorMat = sectorFill.material as THREE.MeshBasicMaterial
      expect(ringMat.opacity).toBe(0.9)
      // 闪烁峰值（0.2s 相位）＝常亮 1；谷值（0.4s 相位）＝ SECTOR_FLASH_MIN 系数
      rt.update(1 + 0.2)
      expect(sectorMat.opacity).toBeCloseTo(0.28, 5)
      rt.update(1 + 0.4)
      expect(sectorMat.opacity).toBeCloseTo(0.28 * 0.45, 5)
      rt.update(1 + 0.2)   // 暂停在峰值相位：冻结
      expect(sectorMat.opacity).toBeCloseTo(0.28, 5)
      // 闪窗结束后回到稳定态（无闪烁系数）
      rt.update(1 + MARKER_FLASH_S + 0.1)
      expect(sectorMat.opacity).toBeCloseTo(0.28, 5)
      // ping 末段淡出（窗口剩余 < FADE 段线性降 0）
      rt.update(1 + MARKER_LIFETIME_S - 1)
      expect(ringMat.opacity).toBeCloseTo(0.45, 5)
      rt.update(1 + MARKER_LIFETIME_S)
      expect(ringMat.opacity).toBe(0)
    } finally {
      profileHolder.fn = null
    }
  })

  it('来源卡（labelSources）：0x2e 联名册两行；占位名走 tankNames 表；来源缺失不出卡', () => {
    const h = makeHarness({
      sources: new Map([[1, { nickname: 'Anonyme', tank_name: 'tank_14129', tank_id: 14129 }]]),
    })
    const rt = runtimeWith(h, {
      markers: [
        { t: 1, entity_id: 1, account_id: 11, marker_type: 1, at: [0, 0, 0] },
        { t: 2, entity_id: 9, account_id: 99, marker_type: 1, at: [5, 0, 5] },   // 来源缺失
      ],
    })
    rt.update(2)
    const sources = rt.labelSources()
    expect(sources).toHaveLength(1)   // 来源缺失的 ping 不出卡
    expect(sources[0]).toMatchObject({ key: '0', kind: 'ping', player: 'Anonyme', tank: 'Tiger II' })
    // 锚点 = 光柱顶上方（groundY=3 + BEAM_H 20 + LIFT 2.5）
    expect(sources[0].y).toBeCloseTo(25.5, 5)
  })

  it('来源卡（labelSources）：0x2f sender 联册 → 玩家+坦克两行；联不到只出玩家行；sender 空 → 不出卡', () => {
    profileHolder.fn = () => ({ gridCells: [{ id: 'B3', nineGridRegion: 6, bounds: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 } }] })
    try {
      const h = makeHarness({ byNickname: new Map([['SiLuck97', { nickname: 'SiLuck97', tank_name: 'T-34' }]]) })
      const rt = runtimeWith(h, { chat_events: [attention(1, 6, 'SiLuck97')] }, 'k')
      rt.update(1)
      expect(rt.labelSources()).toEqual([
        expect.objectContaining({ kind: 'sector', player: 'SiLuck97', tank: 'T-34' }),
      ])
      // 联不到名册：只出玩家行（sender 是包内唯一事实）
      const h2 = makeHarness()
      const rt2 = runtimeWith(h2, { chat_events: [attention(1, 6, '陌生人')] }, 'k')
      rt2.update(1)
      expect(rt2.labelSources()).toEqual([
        expect.objectContaining({ kind: 'sector', player: '陌生人', tank: '' }),
      ])
      // sender 空：不出卡
      const h3 = makeHarness()
      const rt3 = runtimeWith(h3, { chat_events: [attention(1, 6, '')] }, 'k')
      rt3.update(1)
      expect(rt3.labelSources()).toEqual([])
    } finally {
      profileHolder.fn = null
    }
  })

  it('来源卡继承末段淡出：透明度到 0 时卡消失（评审 P2——卡不继承淡出的回归）', () => {
    const h = makeHarness({ sources: new Map([[1, { nickname: 'P', tank_name: 'T', tank_id: 14129 }]]) })
    const rt = runtimeWith(h, { markers: [{ t: 1, entity_id: 1, account_id: 11, marker_type: 1, at: [0, 0, 0] }] })
    rt.update(1)
    expect(rt.labelSources()).toHaveLength(1)
    rt.update(1 + MARKER_LIFETIME_S - 0.5)   // 末段：环半透明，卡仍在且渐进透明（fade 过桥）
    expect(rt.labelSources()).toHaveLength(1)
    expect(rt.labelSources()[0].fade).toBeCloseTo(0.25, 5)
    rt.update(1 + MARKER_LIFETIME_S)         // 端点：环 opacity=0，卡必须消失
    expect(rt.labelSources()).toEqual([])
  })

  it('来源卡与目标环出现闪烁同步（评审 P3——v.fade 并入闪系数）', () => {
    const h = makeHarness({
      poses: new Map([[7, { x: 1, z: 2 }]]),
      sources: new Map([
        [1, { eid: 1, account_id: 11, nickname: 'Anonyme', tank_name: 'tank_14129', tank_id: 14129 }],
        [7, { eid: 7, account_id: 77, nickname: 'Bravo', tank_name: 'BZT-70' }],
      ]),
    })
    const rt = runtimeWith(h, { markers: [{ t: 1, entity_id: 1, account_id: 11, marker_type: 5, target_eid: 7 }] })
    // 闪相位 π/4（半周期 0.5s 的 1/4 处）：系数 = TARGET_FLASH_MIN + (1-MIN)·sin(π/4) < 1
    rt.update(1 + TARGET_FLASH_PERIOD_S / 4)
    const src = rt.labelSources()
    expect(src).toHaveLength(1)
    expect(src[0].fade).toBeGreaterThan(0)
    expect(src[0].fade).toBeLessThan(1)
    // 闪烁窗口外、末段前：卡恢复常亮（与环一致）
    rt.update(1 + TARGET_FLASH_S + 1)
    expect(rt.labelSources()[0].fade).toBe(1)
  })

  it('目标光环逐帧跟随位姿：贴地几何就地重摆 + 包围球同步 + 来源卡锚点跟随；位姿丢失暂隐不外推', () => {
    const poses = new Map<number, { x: number; z: number } | null>([[7, { x: 1, z: 2 }]])
    // 目标类卡 = **发起者身份 + 目标车型**（0x2f attack_enemy 同语义）：卡随环同显隐。
    // 发起者 = entity_id/account_id（0x2e），目标 = target_eid 的车型（动作章参数）。
    const h = makeHarness({
      poses,
      sources: new Map([
        [1, { eid: 1, account_id: 11, nickname: 'Anonyme', tank_name: 'tank_14129', tank_id: 14129 }],
        [7, { eid: 7, account_id: 77, nickname: 'Bravo', tank_name: 'BZT-70' }],
      ]),
    })
    const rt = runtimeWith(h, { markers: [{ t: 1, entity_id: 1, account_id: 11, marker_type: 5, target_eid: 7 }] })
    rt.update(1)
    const ring = h.scene.added[0] as THREE.Mesh
    const attr = ring.geometry.getAttribute('position') as THREE.BufferAttribute
    expect(attr.getX(0)).toBeCloseTo(1 + Math.cos(0) * 5, 5)   // 外圈起点 = 中心 + r
    // 包围球随顶点重摆同步更新（THREE 视锥剔除缓存球的防回归：评审 P2）
    expect(ring.geometry.boundingSphere).toBeTruthy()
    expect(ring.geometry.boundingSphere!.center.x).toBeCloseTo(1, 5)
    expect(ring.geometry.boundingSphere!.center.z).toBeCloseTo(2, 5)
    // 来源卡锚点随目标位姿；身份两行 = 发起者（不是目标），target 参数 = 目标车型
    expect(rt.labelSources()).toEqual([
      expect.objectContaining({ kind: 'target', player: 'Anonyme', tank: 'Tiger II', target: 'BZT-70', x: 1, y: 9, z: 2 }),
    ])
    poses.set(7, { x: 11, z: 12 })
    rt.update(1)
    expect(attr.getX(0)).toBeCloseTo(11 + Math.cos(0) * 5, 5)
    expect(ring.geometry.boundingSphere!.center.x).toBeCloseTo(11, 5)
    expect(rt.labelSources()[0].x).toBeCloseTo(11, 5)
    // 位姿丢失：环隐藏、卡不发布（不外推），恢复后重新出现（评审 P2 的覆盖层等价回归）
    poses.set(7, null)
    rt.update(1)
    expect(ring.visible).toBe(false)
    expect(rt.labelSources()).toHaveLength(0)
    poses.set(7, { x: 21, z: 22 })
    rt.update(1)
    expect(ring.visible).toBe(true)
    expect(rt.labelSources()).toHaveLength(1)
  })

  it('目标环：攻击/撤退统一友军亮绿；出现闪烁（确定性相位：谷值 → 峰值 → 常亮）', () => {
    const h = makeHarness({ poses: new Map([[7, { x: 1, z: 2 }], [8, { x: 3, z: 4 }]]) })
    const rt = runtimeWith(h, {
      markers: [
        { t: 1, entity_id: 1, account_id: 11, marker_type: 4, target_eid: 7 },   // attack
        { t: 1, entity_id: 1, account_id: 11, marker_type: 5, target_eid: 8 },   // retreat
      ],
    })
    rt.update(1)
    const rings = h.scene.added.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh)
    expect(rings).toHaveLength(2)
    // 颜色：attack 与 retreat 都是己方指令 → 统一友军亮绿（不再用敌方红）
    for (const ring of rings) {
      expect((ring.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x3ee08a)
    }
    // 相位 0 → 闪烁谷值（RING_OPACITY × TARGET_FLASH_MIN）
    expect((rings[0].material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.9 * TARGET_FLASH_MIN, 5)
    // 半周期后 → 峰值（常亮 0.9）
    rt.update(1 + TARGET_FLASH_PERIOD_S / 2)
    expect((rings[0].material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.9, 5)
    // 闪窗结束后 → 常亮（未进入末段淡出）
    rt.update(1 + TARGET_FLASH_S + 0.1)
    expect((rings[0].material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.9, 5)
  })

  it('help ping 用发令时刻位姿（评审 P2）：播放/跳转/倒带激活同一事件画出同一位置', () => {
    // sender 在移动：x = t * 10（t=5 时 50，t=1 时 10）
    const h = makeHarness({
      posesAt: new Map([[9, { z: 40, at: (t: number) => t * 10 }]]),
      sources: new Map([[9, { eid: 9, account_id: 900, nickname: 'SiLuck97', tank_name: 'BZT-70' }]]),
      byNickname: new Map([['SiLuck97', { eid: 9, account_id: 900, nickname: 'SiLuck97', tank_name: 'BZT-70' }]]),
    })
    const rt = runtimeWith(h, {
      chat_events: [{ t: 5, kind: 'command', raw_type: 20, channel: 0, sender: 'SiLuck97', command_name: 'help_me', target: 0 }],
    })
    rt.update(5)   // 正常播放到 t=5
    expect(rt.labelSources()[0].x).toBeCloseTo(50, 5)   // 发令时刻 t=5 的位置
    // 模拟 seek 到窗口后段再回来（隐藏/重开同语义）：同一事件同一位置（不是激活时刻位姿）
    rt.update(9)
    expect(rt.labelSources()[0].x).toBeCloseTo(50, 5)
    rt.update(6)
    expect(rt.labelSources()[0].x).toBeCloseTo(50, 5)
  })

  it('0x2f 快捷指令接入：attack_enemy 两域联册 → 目标环+目标卡；help 族 → 发起者自机琥珀 ping+发起者卡', () => {
    const h = makeHarness({
      poses: new Map([[42, { x: 50, z: 60 }]]),
      // help ping 走发令时刻历史位姿（getPoseAt）
      posesAt: new Map([[9, { z: 40, at: () => 30 }]]),
      // 目标 def：名册同一辆车双键（eid 42 / accountId 1400）——buildCommandEvents 用
      // accountId 两域联表，resolveCard（卡解析）用已解析出的 eid 再查 def
      sources: new Map([
        [42, { eid: 42, account_id: 1400, nickname: 'Bravo', tank_name: 'E 100', tank_id: 200 }],
        [1400, { eid: 42, account_id: 1400, nickname: 'Bravo', tank_name: 'E 100', tank_id: 200 }],
        // sender（SiLuck97 eid 9 / account 900）也在名册：help 卡解析走 describeSource(9, 900)
        [9, { eid: 9, account_id: 900, nickname: 'SiLuck97', tank_name: 'BZT-70' }],
        [900, { eid: 9, account_id: 900, nickname: 'SiLuck97', tank_name: 'BZT-70' }],
      ]),
      byNickname: new Map([['SiLuck97', { eid: 9, account_id: 900, nickname: 'SiLuck97', tank_name: 'BZT-70' }]]),
    })
    const rt = runtimeWith(h, {
      chat_events: [
        // attack_enemy：payload = 目标 accountId（§2.3）——两域联册命中 1400
        { t: 5, kind: 'command', raw_type: 20, channel: 0, sender: 'SiLuck97', command_name: 'attack_enemy', target: 1400 },
        // help_me：payload 0（自机位置）——sender 联册 → eid 9
        { t: 8, kind: 'command', raw_type: 20, channel: 0, sender: 'SiLuck97', command_name: 'help_me', target: 0 },
        // 无位置/目标语义的指令：不落 3D（仅滚动流）
        { t: 10, kind: 'command', raw_type: 20, channel: 0, sender: 'SiLuck97', command_name: 'negative', target: 0 },
        // attack_enemy 目标联不到名册：仅滚动流，不猜坐标
        { t: 12, kind: 'command', raw_type: 20, channel: 0, sender: 'SiLuck97', command_name: 'attack_enemy', target: 999999 },
        // help_me sender 联不到名册：仅滚动流
        { t: 13, kind: 'command', raw_type: 20, channel: 0, sender: '陌生人', command_name: 'help_me', target: 0 },
        // attack_enemy sender 不在名册：目标环仍出，卡用包内昵称作玩家行（无车型）
        { t: 14, kind: 'command', raw_type: 20, channel: 0, sender: '陌生人', command_name: 'attack_enemy', target: 1400 },
      ],
    })
    rt.update(14)
    // attack_enemy 目标环 ×2（t=5 / t=14）+ help 自机 ping（环+柱 2 对象）；负向/联册失败的 4 条不落
    expect(h.scene.added).toHaveLength(4)
    const sources = rt.labelSources()
    // attack_enemy 卡 = **发起者**身份 + 目标车型（目标自己的玩家/坦克由车辆名牌负责）
    expect(sources[0]).toMatchObject({ kind: 'target', intent: 'attack', player: 'SiLuck97', tank: 'BZT-70', target: 'E 100' })
    // help 卡 = 发起者身份（请求援助）
    expect(sources[1]).toMatchObject({ kind: 'help', player: 'SiLuck97', tank: 'BZT-70' })
    // help 环 = 发起者下发时刻位姿（静态）
    expect(sources[1].x).toBeCloseTo(30, 5)
    // sender 联不到名册：昵称是包内事实（玩家行保留），车型行留空；目标车型仍在
    expect(sources[2]).toMatchObject({ kind: 'target', intent: 'attack', player: '陌生人', tank: '', target: 'E 100' })
  })

  it('池上限：同窗超限保留最新 MAX_ACTIVE 条（确定性淘汰最旧）', () => {
    const h = makeHarness()
    const rt = runtimeWith(h, {
      markers: Array.from({ length: MARKER_MAX_ACTIVE + 2 }, (_, i) => ({
        t: i + 1, entity_id: 1, account_id: 11, marker_type: 1, at: [i, 0, i] as [number, number, number],
      })),
    })
    rt.update(MARKER_MAX_ACTIVE + 2)
    // 每个 ping = 环 + 光柱；淘汰发生后场景中同时存在的对象 ≤ MAX_ACTIVE × 2
    expect(h.scene.added.length - h.scene.removed.length).toBeLessThanOrEqual(MARKER_MAX_ACTIVE * 2)
    expect(h.scene.added.length).toBe(MARKER_MAX_ACTIVE * 2)
  })

  it('setEnabled(false)：清活动体；on 立即按当前 T 重算窗口', () => {
    const h = makeHarness({ sources: new Map([[1, { nickname: 'P1', tank_name: 'T1', tank_id: 14129 }]]) })
    const rt = runtimeWith(h, {
      markers: [
        { t: 10, entity_id: 1, account_id: 11, marker_type: 1, at: [0, 0, 0] },
        { t: 20, entity_id: 1, account_id: 11, marker_type: 1, at: [2, 0, 2] },
      ],
    })
    rt.update(20)   // T=20：两条都在窗内（[10,20] 含端点、[20,30] 含端点）
    expect(h.scene.added).toHaveLength(4)
    rt.setEnabled(false)
    expect(h.scene.removed).toHaveLength(4)
    expect(rt.labelSources()).toEqual([])
    h.t.v = 20
    rt.setEnabled(true)
    expect(h.scene.added).toHaveLength(8)   // 立即按当前 T（20）重现两条 ping（各环+柱）
    // T=20 时 t=10 的 ping 窗口 [10,20] 恰好到端点（fade=0 全透明）→ 卡消失；
    // 只有 t=20 的 ping（fade=1）出卡——卡与本体同生死
    expect(rt.labelSources()).toHaveLength(1)
    expect(rt.labelSources()[0].key).toBe('1')
  })

  it('clear：会话切换清活动体与事件源（labelSources 随之清空）', () => {
    const h = makeHarness({ sources: new Map([[1, { nickname: 'P1', tank_name: 'T1', tank_id: 14129 }]]) })
    const rt = runtimeWith(h, { markers: [{ t: 1, entity_id: 1, account_id: 11, marker_type: 1, at: [0, 0, 0] }] })
    rt.update(1)
    expect(rt.labelSources()).toHaveLength(1)
    rt.clear()
    expect(rt.labelSources()).toEqual([])
    rt.update(1)
    expect(h.scene.removed).toHaveLength(2)   // 事件源已清：不再落新对象
  })
})

describe('attack_enemy 的账号联册（换 eid 后的活动实体）', () => {
  it('联册查询携带指令时刻 t（账号兜底的时间证据）', () => {
    const h = makeHarness()
    const describeSource = vi.fn(() => ({ eid: 49, account_id: 7 }))
    const rt = createMarkerRuntime({ ...h.deps, describeSource })
    rt.buildSession({
      chat_events: [{ t: 12, kind: 'command', raw_type: 20, channel: 0, sender: 'S', command_name: 'attack_enemy', target: 7 }],
    }, null)
    expect(describeSource).toHaveBeenCalledWith(7, 7, 12)
  })

  it('同名账号新旧实体：旧 eid 不可见且已被接管 → 取新 eid；接管前倒带仍取旧 eid', () => {
    const def = (eid: number, account_id: number) => ({ def: { eid, account_id } })
    const roster = [def(42, 7), def(49, 7)]
    const visibleAt = (v: { def: { eid: number } }, t: number) => (v.def.eid === 42 ? t < 10 : t >= 10)
    const replacedAt = (eid: number, t: number) => eid === 42 && t >= 10
    expect(resolveActiveAccount(roster, 7, 12, visibleAt, replacedAt)?.def.eid).toBe(49)
    expect(resolveActiveAccount(roster, 7, 5, visibleAt, replacedAt)?.def.eid).toBe(42)
    expect(resolveActiveAccount(roster, 99, 12, visibleAt, replacedAt)).toBeNull()
  })
})

// 生产接线守卫（playbackScene 源码级，treadMarks.test.js 同风格）：单测 harness 自备
// getPoseAt，覆盖不到 src/scene/playbackScene.js 的真实传参形状。Codex P1 回归：
// createBattleMarkerHost 未注入 visibleAt 时，求援类指令窗口内 spawn→getPoseAt 每帧抛
// TypeError（渲染/HUD 中断，seek 进窗口同样失败）。
describe('生产接线守卫（playbackScene 源码级）', () => {
  const sceneSrc = PLAYBACK_SCENE_SOURCE

  it('createBattleMarkerHost 必须注入 visibleAt（help 类历史位姿门）', () => {
    // 合并后源码全集包含 battleMarkerHost.ts 的定义与 sceneAssembly.ts 的构造；必须取构造调用。
    const at = sceneSrc.indexOf('S.battleMarkers = createBattleMarkerHost(')
    expect(at).toBeGreaterThan(-1)
    const call = sceneSrc.slice(at, sceneSrc.indexOf('});', at))
    expect(call).toMatch(/visibleAt:\s*\(v,\s*t\)\s*=>\s*(?:S\.)?visibleAt\(v,\s*t\)/)
    // 账号兜底的活动实体解析（攻击目标换 eid）：注入身份接管判据
    expect(call).toMatch(/replacedAt:\s*\(eid,\s*t\)\s*=>\s*(?:S\.)?replacedAt\(eid,\s*t\)/)
  })
})

describe('resolveActiveSender（指令时刻在场解析）', () => {
  const def = (eid: number, nickname: string) => ({ def: { eid, nickname } })
  const windowOf = new Map<number, [number, number]>([[1, [0, 10]], [2, [10, 20]], [3, [0, 10]]])
  const visibleAt = (v: { def: { eid: number } }, t: number) => {
    const w = windowOf.get(v.def.eid)
    return !!w && w[0] <= t && t < w[1]
  }
  const vehicles = [def(1, 'P'), def(2, 'P'), def(3, 'Q')]

  it('同名多实体按指令时刻取在场实体；不在场 fail-closed 出 null', () => {
    expect(resolveActiveSender(vehicles, visibleAt, (v) => v.def.nickname, 'P', 5)?.def.eid).toBe(1)
    expect(resolveActiveSender(vehicles, visibleAt, (v) => v.def.nickname, 'P', 15)?.def.eid).toBe(2)
    expect(resolveActiveSender(vehicles, visibleAt, (v) => v.def.nickname, 'P', 25)).toBeNull()
    expect(resolveActiveSender(vehicles, visibleAt, (v) => v.def.nickname, 'Q', 5)?.def.eid).toBe(3)
    expect(resolveActiveSender(vehicles, visibleAt, (v) => v.def.nickname, 'X', 5)).toBeNull()
  })
})
