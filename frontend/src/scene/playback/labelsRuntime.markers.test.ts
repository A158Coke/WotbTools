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
      anchors.set(key, { ...(anchor as { x: number; y: number; visible: boolean; opacity: number }) })
    },
  }
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 0, 0)
  camera.lookAt(0, 0, -1)
  camera.updateMatrixWorld()
  const deps: LabelsRuntimeDeps = {
    store: { labelsOn: true, killfeed: [], scoreFriend: 0, scoreEnemy: 0, friendlyTeam: 1, roster: { team1: [], team2: [], unknown: [] } } as never,
    getViewportSize: () => ({ x: 0, y: 0 }),
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
      { key: 't', kind: 'target', intent: 'attack', fade: 1, player: 'Anonyme', tank: 'BZT-70', target: 'KRV', x: 0, y: 3, z: -10 },
      { key: 'p', kind: 'ping', fade: 1, player: 'Anonyme', tank: 'BZT-70', x: 0, y: 3, z: -10 },
    ]
    const { deps, overlay, anchors } = makeDeps(sources)
    const rt = createLabelsRuntime(deps)
    rt.updateLabels()
    expect(anchors.get('p')?.y).toBeCloseTo(0, 5)
    expect(anchors.get('t')?.y).toBeCloseTo(-MARKER_TARGET_CARD_LIFT_PX, 5)
    expect(anchors.get('t')?.visible).toBe(true)
    expect(overlay.setMarkerLabels).toHaveBeenCalledWith([
      expect.objectContaining({ key: 't', kind: 'target', intent: 'attack', player: 'Anonyme', tank: 'BZT-70', target: 'KRV' }),
      expect.objectContaining({ key: 'p', kind: 'ping', player: 'Anonyme', tank: 'BZT-70' }),
    ])
  })
})