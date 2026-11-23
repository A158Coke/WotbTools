// 标记卡锚点行为：target 类卡必须整体上移 MARKER_TARGET_CARD_LIFT_PX（60px）——
// 卡片说明的是「发起者要求攻击/撤退 目标车型」（单行），锚在目标车上时不得覆盖目标
// 自己的玩家/血量/ID 名牌。ping/help/sector 不移动。投影点用 0×0 容器归一（x/y 均为 0），
// 只锁「按 kind 施加的屏幕空间偏移」这一事实；真实像素观感由用户验收。
// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createLabelsRuntime } from './labelsRuntime.js'
import type { LabelsRuntimeDeps, LabelsOverlay } from './labelsRuntime.js'
import type { MarkerLabelSource } from './markerRuntime.js'

const MARKER_TARGET_CARD_LIFT_PX = 60

function makeDeps(sources: readonly MarkerLabelSource[]) {
  const anchors = new Map<string, { x: number; y: number; visible: boolean; opacity: number }>()
  const overlay: LabelsOverlay = {
    setLabels: vi.fn(),
    setAnchor: vi.fn(),
    clear: vi.fn(),
    setMarkerLabels: vi.fn(),
    setMarkerAnchor: (key: string, anchor: unknown) => {
      // 契约与 PlaybackVehicleLabels3D 相同：同步拷贝（逐帧复用同一 scratch）
      anchors.set(key, { ...(anchor as { x: number; y: number; visible: boolean; opacity: number }) })
    },
  }
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 0, 0)
  camera.lookAt(0, 0, -1)
  camera.updateMatrixWorld()
  const deps: LabelsRuntimeDeps = {
    store: { labelsOn: true, killfeed: [], scoreFriend: 0, scoreEnemy: 0, friendlyTeam: 1, roster: { team1: [], team2: [], unknown: [] } } as never,
    getViewportSize: () => ({ x: 0, y: 0 }),   // 0×0 逻辑视口：投影 x/y 归一为 0（只锁屏幕空间偏移）
    getCamera: () => camera,
    getRaycaster: () => new THREE.Raycaster(),
    getData: () => ({ meta: { friendly_team: 1 }, kills: [] }) as never,
    getT: () => 10,
    getVehicles: () => [] as never,
    getSessionGen: () => 0,
    getFollowEid: () => null,
    deathAt: () => false,
    hpAt: () => 100,
    visibleAt: () => true,
    visByEid: () => new Map(),
    scopedHiddenEid: () => 0,
    sampleHeight: () => 0,
    heightField: () => null,
    heightMeta: () => null,
    mapScenery: () => null,
    occlGrid: () => null,
    transients: { ghostOf: () => undefined, hasFlash: () => false },
    fxScale: () => 2,
    getLabelOverlay: () => overlay,
    getMarkerLabelSources: () => sources,
    canonicalVehicles: () => [],
    invalidate: vi.fn(),
  }
  return { deps, overlay, anchors }
}

describe('标记来源卡锚点（labelsRuntime）', () => {
  it('target 卡上移 60px 避让目标名牌；非 target 卡不动；target 字段过投影桥', () => {
    const sources: MarkerLabelSource[] = [
      // 两台来源同一点（0,3,-10）：投影相同，唯一差异 = kind
      { key: 't', kind: 'target', intent: 'attack', fade: 1, player: 'Anonyme', tank: 'BZT-70', target: 'KRV', x: 0, y: 3, z: -10 },
      { key: 'p', kind: 'ping', fade: 1, player: 'Anonyme', tank: 'BZT-70', x: 0, y: 3, z: -10 },
    ]
    const { deps, overlay, anchors } = makeDeps(sources)
    const rt = createLabelsRuntime(deps)
    rt.updateLabels()
    // 0×0 容器：投影 x/y 归一为 0，可见；target 只差 −84px
    expect(anchors.get('p')?.y).toBeCloseTo(0, 5)
    expect(anchors.get('t')?.y).toBeCloseTo(-MARKER_TARGET_CARD_LIFT_PX, 5)
    expect(anchors.get('t')?.visible).toBe(true)
    // 内容行：target 车型必须随行下发（覆盖层据此合成「要求攻击 {target}」章）
    expect(overlay.setMarkerLabels).toHaveBeenCalledWith([
      expect.objectContaining({ key: 't', kind: 'target', intent: 'attack', player: 'Anonyme', tank: 'BZT-70', target: 'KRV' }),
      expect.objectContaining({ key: 'p', kind: 'ping', player: 'Anonyme', tank: 'BZT-70' }),
    ])
  })
})