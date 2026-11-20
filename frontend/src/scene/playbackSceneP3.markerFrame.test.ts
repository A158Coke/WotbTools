// @vitest-environment happy-dom
// 暂停态迟到数据重算（评审 P2）：实际 psP3 帧体 + Three.js 标记 + labelsRuntime。
// 场景：显式 EID 42 的攻击目标环，暂停在 T=112.5；迟到的位姿只触发**一次按需重绘**——
// 重绘必须先重算标记（环移动/隐藏），再投影来源卡（卡片锚点随环移动、随环消失）。
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as THREE from 'three'
import { psP3 } from './playbackSceneP3.ts'
import { createMarkerRuntime, type MarkerRuntimeDeps, type MarkerSourceDef } from './playback/markerRuntime.ts'
import type { SceneParts } from './playback/sceneParts.types.ts'
import { createLabelsRuntime } from './playback/labelsRuntime.ts'

const T = 112.5

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('playbackSceneP3 暂停帧：标记重算先于卡片投影（单次按需重绘）', () => {
  const rafQueue: Array<() => void> = []
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', { configurable: true, value: 1280 })
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 960 })

  const poses = new Map<number, { x: number; z: number } | null>([[42, { x: 1, z: 2 }]])
  const sources = new Map<number, MarkerSourceDef | null>([
    [1, { eid: 1, account_id: 11, nickname: 'Anonyme', tank_name: 'tank_14129', tank_id: 14129 }],
    [42, { eid: 42, account_id: 42, nickname: 'Bravo', tank_name: 'BZT-70' }],
  ])
  const anchorCalls: Array<{ key: string; x: number; visible: boolean }> = []
  const labelRows: Array<Array<Record<string, unknown>>> = []
  const overlay = {
    setLabels: () => {},
    setAnchor: () => {},
    clear: () => {},
    setMarkerLabels: (rows: Array<Record<string, unknown>>) => { labelRows.push(rows) },
    setMarkerAnchor: (key: string, anchor: { x: number; visible: boolean }) => {
      anchorCalls.push({ key, x: anchor.x, visible: anchor.visible })
    },
  }
  let renders = 0

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1280 / 960, 0.1, 5000)
  camera.position.set(0, 60, 90)
  camera.lookAt(0, 3, 0)

  const markerDeps: MarkerRuntimeDeps = {
    getScene: () => scene,
    groundY: () => 3,
    getVehiclePose: (eid, _t, out) => {
      const p = poses.get(eid)
      if (!p) return false
      out.set(p.x, 3, p.z)
      return true
    },
    describeSource: (eid) => sources.get(eid) ?? null,
    findByNickname: () => null,
    tankNameOf: (id) => (id === 14129 ? 'Tiger II' : undefined),
    getT: () => T,
    invalidate: () => {},
  }
  const markers = createMarkerRuntime(markerDeps as MarkerRuntimeDeps)
  markers.buildSession({ markers: [{ t: 110, entity_id: 1, account_id: 11, marker_type: 4, target_eid: 42 }], chat_events: [] } as never, 'map')

  const labels = createLabelsRuntime({
    store: { labelsOn: true, lastKnownOn: false, fps: 0, frameMs: 0, framePeakMs: 0, treadOn: false, startTime: 0, duration: 300, banner: null },
    container,
    getCamera: () => camera,
    getRaycaster: () => new THREE.Raycaster(),
    getData: () => ({ markers: [], chat_events: [], meta: {}, vehicles: [] }),
    getT: () => T,
    getVehicles: () => [],
    getSessionGen: () => 0,
    getFollowEid: () => null,
    deathAt: () => false,
    hpAt: () => 0,
    visibleAt: () => false,
    visByEid: () => new Map(),
    scopedHiddenEid: () => 0,
    sampleHeight: () => 0,
    heightField: () => null,
    heightMeta: () => null,
    mapScenery: () => null,
    occlGrid: () => null,
    transients: { ghostOf: () => null, hasFlash: () => false },
    fxScale: () => 1,
    getLabelOverlay: () => overlay,
    getMarkerLabelSources: () => markers.labelSources(),
    canonicalVehicles: () => [],
    invalidate: () => {},
  } as never)

  const S = {
    destroyed: false,
    paused: false,
    rafId: 0,
    renderer: { render: () => { renders += 1 }, info: { autoReset: true, reset: () => {} } },
    clock: new THREE.Clock(),
    DATA: { markers: [], chat_events: [], meta: {} },
    PLAYING: false,
    T,
    frameDirty: false,
    scene,
    camera,
    controls: { update: () => false, target: new THREE.Vector3(), enabled: true },
    followAnchor: null,
    cameraRuntime: {
      cam: () => 'top', cameraDriven: () => false, cameraBlend: () => false, fovRestore: () => false,
      flyMode: () => false, zoomTick: () => {}, renderArmorHighlight: () => {}, ensureArmorHighlight: () => {},
      armorStats: () => ({}),
    },
    clampOrbitCameraToTerrain: () => {},
    clampCameraTarget: () => {},
    dynResCtl: null,
    labels,
    updateBases: () => {},
    battle: {
      transients: { updateNow: () => {}, advanceTo: () => {}, rewind: () => {} },
      updateBattleFx: () => {},
      isActive: () => false,
      ensureBattleFx: () => {},
    },
    battleMarkers: markers,
    mapWorld: { maybeRebuildTerrainLod: () => {}, destruct: () => null, animLayerMats: () => [], terrainCounters: () => ({}), resetTerrainCounters: () => {}, mapKey: () => 'map' },
    waterReflection: { update: () => {} },
    session: { isReadySession: () => false, tryMarkFirstReadyFrame: () => {} },
    annotationScene: { stats: () => ({}) },
    contactShadowCtl: { count: () => 0 },
    QKEY: 'high',
    ARMOR_HIGHLIGHT: false,
    Q: { forceGlb: false, allowGlb: false },
    requestWaterReflectionRefresh: () => {},
    store: { labelsOn: true, lastKnownOn: false, fps: 0, frameMs: 0, framePeakMs: 0 },
    winnerShown: false,
    START: 0,
    END: 300,
    vehicles: { getVehicles: () => [], applyPose: () => {}, clearSnap: () => {}, frameTiming: () => {} },
    lastRenderAt: 0,
    fpsIdle: false,
  } as unknown as SceneParts

  const P = { container, store: { labelsOn: true, lastKnownOn: false }, labelOverlay: null, recorderReticle: null } as unknown as Parameters<typeof psP3>[1]

  psP3(S, P)

  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { rafQueue.push(cb); return rafQueue.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})

  const ring = () => scene.children.find((o) => o instanceof THREE.Mesh) as THREE.Mesh
  const lastAnchor = () => anchorCalls.filter((a) => a.key === '0').at(-1)
  const anchorCount = () => anchorCalls.length

  it('单次按需重绘：迟到位姿让环与卡片一起移动；位姿缺失让环与卡片一起消失；空闲帧不重绘', () => {
    // 帧一：迟到位姿首次到达（创建时位姿缺失 → 环曾隐藏；此处直接验证移动分支）
    S.frameDirty = true
    S.animate()
    expect(ring()).toBeTruthy()
    expect(ring().visible).toBe(true)
    const sphere = ring().geometry.boundingSphere!
    expect(sphere.center.x).toBeCloseTo(1, 5)
    expect(anchorCount()).toBeGreaterThan(0)
    const x1 = lastAnchor()!.x
    expect(lastAnchor()!.visible).toBe(true)
    const renders1 = renders

    // 帧二：迟到位姿更新（x 1 → 40）→ 同一次重绘里环与卡片锚点一起移动
    poses.set(42, { x: 40, z: -20 })
    S.frameDirty = true
    S.animate()
    expect(ring().geometry.boundingSphere!.center.x).toBeCloseTo(40, 5)
    const x2 = lastAnchor()!.x
    expect(x2).not.toBeCloseTo(x1, 3)
    expect(lastAnchor()!.visible).toBe(true)
    expect(renders).toBe(renders1 + 1)

    // 帧三：位姿缺失 → 环隐藏；labelSources 随之为空 → 卡片同帧移除（不留在旧屏幕坐标）
    poses.set(42, null)
    S.frameDirty = true
    S.animate()
    expect(ring().visible).toBe(false)
    expect(labelRows.at(-1)).toEqual([])
    const anchorsBeforeIdle = anchorCount()
    const rendersAfterHide = renders

    // 空闲帧：无脏标记、相机静止 → 不再重绘（两次空闲 rAF 均无锚点/渲染发生）
    S.animate()
    S.animate()
    expect(anchorCount()).toBe(anchorsBeforeIdle)
    expect(renders).toBe(rendersAfterHide)
  })
})
