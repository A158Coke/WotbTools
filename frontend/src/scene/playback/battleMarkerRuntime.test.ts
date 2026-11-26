import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { attention, makeHarness, type Harness } from './battleMarkerRuntime.test.harness.js'
import {
  MARKER_FLASH_S,
  MARKER_LIFETIME_S,
  MARKER_MAX_ACTIVE,
  TARGET_FLASH_MIN,
  TARGET_FLASH_PERIOD_S,
  TARGET_FLASH_S,
  buildMarkerEvents,
  createMarkerRuntime,
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
      rt.update(12)
      expect(h.scene.added).toHaveLength(5)
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
    rt.update(5)
    expect(h.scene.removed).toHaveLength(2)
    const base = h.scene.added.length
    rt.update(12)
    expect(h.scene.added.length - base).toBe(2)
    rt.update(10 + MARKER_LIFETIME_S)
    expect(h.scene.added.length - base).toBe(2)
    rt.update(10 + MARKER_LIFETIME_S + 0.1)
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
      const sectorFill = h.scene.added[2] as THREE.Mesh
      const sectorMat = sectorFill.material as THREE.MeshBasicMaterial
      expect(ringMat.opacity).toBe(0.9)
      rt.update(1 + 0.2)
      expect(sectorMat.opacity).toBeCloseTo(0.28, 5)
      rt.update(1 + 0.4)
      expect(sectorMat.opacity).toBeCloseTo(0.28 * 0.45, 5)
      rt.update(1 + 0.2)
      expect(sectorMat.opacity).toBeCloseTo(0.28, 5)
      rt.update(1 + MARKER_FLASH_S + 0.1)
      expect(sectorMat.opacity).toBeCloseTo(0.28, 5)
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
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ key: '0', kind: 'ping', player: 'Anonyme', tank: 'Tiger II' })
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
      const h2 = makeHarness()
      const rt2 = runtimeWith(h2, { chat_events: [attention(1, 6, '陌生人')] }, 'k')
      rt2.update(1)
      expect(rt2.labelSources()).toEqual([
        expect.objectContaining({ kind: 'sector', player: '陌生人', tank: '' }),
      ])
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
    rt.update(1 + MARKER_LIFETIME_S - 0.5)
    expect(rt.labelSources()).toHaveLength(1)
    expect(rt.labelSources()[0].fade).toBeCloseTo(0.25, 5)
    rt.update(1 + MARKER_LIFETIME_S)
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
    rt.update(1 + TARGET_FLASH_PERIOD_S / 4)
    const src = rt.labelSources()
    expect(src).toHaveLength(1)
    expect(src[0].fade).toBeGreaterThan(0)
    expect(src[0].fade).toBeLessThan(1)
    rt.update(1 + TARGET_FLASH_S + 1)
    expect(rt.labelSources()[0].fade).toBe(1)
  })

  it('目标光环逐帧跟随位姿：贴地几何就地重摆 + 包围球同步 + 来源卡锚点跟随；位姿丢失暂隐不外推', () => {
    const poses = new Map<number, { x: number; z: number } | null>([[7, { x: 1, z: 2 }]])
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
    expect(attr.getX(0)).toBeCloseTo(1 + Math.cos(0) * 5, 5)
    expect(ring.geometry.boundingSphere).toBeTruthy()
    expect(ring.geometry.boundingSphere!.center.x).toBeCloseTo(1, 5)
    expect(ring.geometry.boundingSphere!.center.z).toBeCloseTo(2, 5)
    expect(rt.labelSources()).toEqual([
      expect.objectContaining({ kind: 'target', player: 'Anonyme', tank: 'Tiger II', target: 'BZT-70', x: 1, y: 9, z: 2 }),
    ])
    poses.set(7, { x: 11, z: 12 })
    rt.update(1)
    expect(attr.getX(0)).toBeCloseTo(11 + Math.cos(0) * 5, 5)
    expect(ring.geometry.boundingSphere!.center.x).toBeCloseTo(11, 5)
    expect(rt.labelSources()[0].x).toBeCloseTo(11, 5)
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
        { t: 1, entity_id: 1, account_id: 11, marker_type: 4, target_eid: 7 },
        { t: 1, entity_id: 1, account_id: 11, marker_type: 5, target_eid: 8 },   // retreat
      ],
    })
    rt.update(1)
    const rings = h.scene.added.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh)
    expect(rings).toHaveLength(2)
    for (const ring of rings) {
      expect((ring.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x3ee08a)
    }
    expect((rings[0].material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.9 * TARGET_FLASH_MIN, 5)
    rt.update(1 + TARGET_FLASH_PERIOD_S / 2)
    expect((rings[0].material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.9, 5)
    rt.update(1 + TARGET_FLASH_S + 0.1)
    expect((rings[0].material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.9, 5)
  })

  it('help ping 用发令时刻位姿（评审 P2）：播放/跳转/倒带激活同一事件画出同一位置', () => {
    const h = makeHarness({
      posesAt: new Map([[9, { z: 40, at: (t: number) => t * 10 }]]),
      sources: new Map([[9, { eid: 9, account_id: 900, nickname: 'SiLuck97', tank_name: 'BZT-70' }]]),
      byNickname: new Map([['SiLuck97', { eid: 9, account_id: 900, nickname: 'SiLuck97', tank_name: 'BZT-70' }]]),
    })
    const rt = runtimeWith(h, {
      chat_events: [{ t: 5, kind: 'command', raw_type: 20, channel: 0, sender: 'SiLuck97', command_name: 'help_me', target: 0 }],
    })
    rt.update(5)
    expect(rt.labelSources()[0].x).toBeCloseTo(50, 5)
    rt.update(9)
    expect(rt.labelSources()[0].x).toBeCloseTo(50, 5)
    rt.update(6)
    expect(rt.labelSources()[0].x).toBeCloseTo(50, 5)
  })

  it('0x2f 快捷指令接入：attack_enemy 两域联册 → 目标环+目标卡；help 族 → 发起者自机琥珀 ping+发起者卡', () => {
    const h = makeHarness({
      poses: new Map([[42, { x: 50, z: 60 }]]),
      posesAt: new Map([[9, { z: 40, at: () => 30 }]]),
      sources: new Map([
        [42, { eid: 42, account_id: 1400, nickname: 'Bravo', tank_name: 'E 100', tank_id: 200 }],
        [1400, { eid: 42, account_id: 1400, nickname: 'Bravo', tank_name: 'E 100', tank_id: 200 }],
        [9, { eid: 9, account_id: 900, nickname: 'SiLuck97', tank_name: 'BZT-70' }],
        [900, { eid: 9, account_id: 900, nickname: 'SiLuck97', tank_name: 'BZT-70' }],
      ]),
      byNickname: new Map([['SiLuck97', { eid: 9, account_id: 900, nickname: 'SiLuck97', tank_name: 'BZT-70' }]]),
    })
    const rt = runtimeWith(h, {
      chat_events: [
        { t: 5, kind: 'command', raw_type: 20, channel: 0, sender: 'SiLuck97', command_name: 'attack_enemy', target: 1400 },
        { t: 8, kind: 'command', raw_type: 20, channel: 0, sender: 'SiLuck97', command_name: 'help_me', target: 0 },
        { t: 10, kind: 'command', raw_type: 20, channel: 0, sender: 'SiLuck97', command_name: 'negative', target: 0 },
        { t: 12, kind: 'command', raw_type: 20, channel: 0, sender: 'SiLuck97', command_name: 'attack_enemy', target: 999999 },
        { t: 13, kind: 'command', raw_type: 20, channel: 0, sender: '陌生人', command_name: 'help_me', target: 0 },
        { t: 14, kind: 'command', raw_type: 20, channel: 0, sender: '陌生人', command_name: 'attack_enemy', target: 1400 },
      ],
    })
    rt.update(14)
    expect(h.scene.added).toHaveLength(4)
    const sources = rt.labelSources()
    expect(sources[0]).toMatchObject({ kind: 'target', intent: 'attack', player: 'SiLuck97', tank: 'BZT-70', target: 'E 100' })
    expect(sources[1]).toMatchObject({ kind: 'help', player: 'SiLuck97', tank: 'BZT-70' })
    expect(sources[1].x).toBeCloseTo(30, 5)
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
    rt.update(20)
    expect(h.scene.added).toHaveLength(4)
    rt.setEnabled(false)
    expect(h.scene.removed).toHaveLength(4)
    expect(rt.labelSources()).toEqual([])
    h.t.v = 20
    rt.setEnabled(true)
    expect(h.scene.added).toHaveLength(8)
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
    expect(h.scene.removed).toHaveLength(2)
  })
})
