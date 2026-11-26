// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { PLAYBACK_SCENE_SOURCE } from '../playbackScene.test.source.js'
import { resolveActiveAccount, resolveActiveSender } from './battleMarkerHost.js'
import { createMarkerRuntime } from './markerRuntime.js'
import { createLabelsRuntime } from './labelsRuntime.js'
import { installRenderLoop } from './renderLoop.js'
import { makeHarness } from './battleMarkerRuntime.test.harness.js'

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

describe('生产接线守卫（playbackScene 源码级）', () => {
  const sceneSrc = PLAYBACK_SCENE_SOURCE

  it('createBattleMarkerHost 必须注入 visibleAt（help 类历史位姿门）', () => {
    const at = sceneSrc.indexOf('S.battleMarkers = createBattleMarkerHost(')
    expect(at).toBeGreaterThan(-1)
    const call = sceneSrc.slice(at, sceneSrc.indexOf('});', at))
    expect(call).toMatch(/visibleAt:\s*\(v,\s*t\)\s*=>\s*(?:S\.)?visibleAt\(v,\s*t\)/)
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

describe('暂停按需重绘的标记帧顺序（恢复被删的 markerFrame 回归）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('迟到目标位姿先更新环/卡片投影再投影标签；位姿丢失同帧隐藏；空闲帧不重绘', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1)

    const state = { T: 112.5 }
    const markerScene = new THREE.Scene()
    const poses = new Map<number, { x: number; z: number } | null>([[42, { x: 1, z: 2 }]])
    const sourceDefs = new Map<number, { eid: number; account_id: number; nickname: string; tank_name: string; tank_id?: number }>([
      [1, { eid: 1, account_id: 11, nickname: 'Alpha', tank_name: 'tank_14129', tank_id: 14129 }],
      [42, { eid: 42, account_id: 77, nickname: 'Bravo', tank_name: 'BZT-70' }],
    ])
    const markerRuntime = createMarkerRuntime({
      getScene: () => markerScene,
      groundY: () => 0,
      getVehiclePose: (eid, _t, out) => {
        const pose = poses.get(eid)
        if (!pose) return false
        out.set(pose.x, 0, pose.z)
        return true
      },
      getPoseAt: () => false,
      describeSource: (eid, account) => sourceDefs.get(eid) ?? sourceDefs.get(account) ?? null,
      findByNickname: () => null,
      tankNameOf: (tankId) => (tankId === 14129 ? 'Tiger II' : undefined),
      getT: () => state.T,
      invalidate: () => {},
    })
    const data = {
      markers: [{ t: 110, entity_id: 1, account_id: 11, marker_type: 4, target_eid: 42 }],
      chat_events: [],
    }
    markerRuntime.buildSession(data, null)

    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 600 })
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 5000)
    camera.position.set(0, 60, 90)
    camera.lookAt(0, 3, 0)

    const anchorCalls: Array<{ key: string; x: number; visible: boolean }> = []
    const labelRows: unknown[] = []
    const overlay = {
      setLabels: () => {},
      setAnchor: () => {},
      clear: () => {},
      setMarkerLabels: (rows: unknown) => { labelRows.push(rows) },
      setMarkerAnchor: (key: string, anchor: unknown) => {
        const a = anchor as { x: number; visible: boolean }
        anchorCalls.push({ key, x: a.x, visible: a.visible })
      },
    }
    const store = {
      mapReady: true, hasData: true, fps: 0, frameMs: 0, framePeakMs: 0,
      labelsOn: true, lastKnownOn: false,
      killfeed: [], scoreFriend: 0, scoreEnemy: 0, friendlyTeam: 1,
      roster: { team1: [], team2: [], unknown: [] },
    }
    const labelsData = { ...data, meta: { friendly_team: 1 }, kills: [], vehicles: [] }
    const labels = createLabelsRuntime({
      store,
      getViewportSize: () => ({ x: container.clientWidth, y: container.clientHeight }),
      getCamera: () => camera,
      getRaycaster: () => new THREE.Raycaster(),
      getData: () => labelsData,
      getT: () => state.T,
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
      transients: { ghostOf: () => undefined, hasFlash: () => false },
      fxScale: () => 1,
      getLabelOverlay: () => overlay,
      getMarkerLabelSources: () => markerRuntime.labelSources(),
      canonicalVehicles: () => [],
      invalidate: () => {},
    })
    const render = vi.fn()
    const S = {
      destroyed: false,
      paused: false,
      rafId: 0,
      renderer: { render, info: { autoReset: true, reset: vi.fn() }, domElement: { style: {} } },
      clock: { getDelta: () => 0 },
      DATA: data,
      PLAYING: false,
      T: state.T,
      END: 300,
      SPEED: 1,
      scene: new THREE.Scene(),
      camera,
      controls: { update: () => false, target: new THREE.Vector3(), enabled: true, minDistance: 0 },
      store,
      mapWorld: { animLayerMats: () => [], tickDynamicLights: () => {}, destruct: () => null, maybeRebuildTerrainLod: () => {} },
      cameraRuntime: {
        cam: () => 'free', cameraDriven: () => false, cameraBlend: () => false, fovRestore: () => false,
        flyMode: () => false, zoomTick: () => {}, renderArmorHighlight: () => {}, armorStats: () => ({}),
      },
      clampOrbitCameraToTerrain: () => {},
      clampCameraTarget: () => {},
      labels,
      updateBases: vi.fn(),
      battle: { isActive: () => false, transients: { updateNow: () => {} }, updateBattleFx: () => {}, advanceWreckClock: () => {} },
      battleMarkers: markerRuntime,
      vehicles: { frameTiming: () => {}, getVehicles: () => [] },
      session: { isReadySession: () => false, tryMarkFirstReadyFrame: () => {} },
      waterReflection: { update: () => {} },
      container,
      DEBUG: false,
      PERF: false,
    }
    type Host = Parameters<typeof installRenderLoop>[0]
    const host = S as unknown as Host
    installRenderLoop(host)
    const animate = () => (host as unknown as { animate: () => void }).animate()
    const setDirty = (dirty: boolean) => { (host as unknown as { frameDirty: boolean }).frameDirty = dirty }

    const ring = () => markerScene.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh)!
    const lastTargetAnchor = () => anchorCalls.filter((a) => a.key === '0').at(-1)!

    setDirty(true)
    animate()
    expect(render).toHaveBeenCalledTimes(1)
    expect(ring().visible).toBe(true)
    expect(ring().geometry.boundingSphere!.center.x).toBeCloseTo(1, 5)
    const firstX = lastTargetAnchor().x
    expect(lastTargetAnchor().visible).toBe(true)
    expect(labelRows.at(-1)).toMatchObject([{ key: '0', kind: 'target', target: 'BZT-70' }])

    poses.set(42, { x: 40, z: 2 })
    setDirty(true)
    animate()
    expect(render).toHaveBeenCalledTimes(2)
    expect(ring().geometry.boundingSphere!.center.x).toBeCloseTo(40, 5)
    expect(lastTargetAnchor().x).not.toBeCloseTo(firstX, 3)
    expect(lastTargetAnchor().visible).toBe(true)
    expect(labelRows.at(-1)).toMatchObject([{ key: '0', kind: 'target' }])

    poses.set(42, null)
    setDirty(true)
    animate()
    expect(render).toHaveBeenCalledTimes(3)
    expect(ring().visible).toBe(false)
    expect(labelRows.at(-1)).toEqual([])
    const anchorsBeforeIdle = anchorCalls.length
    const rendersBeforeIdle = render.mock.calls.length

    animate()
    animate()
    expect(anchorCalls.length).toBe(anchorsBeforeIdle)
    expect(render).toHaveBeenCalledTimes(rendersBeforeIdle)
  })
})
