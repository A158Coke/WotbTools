// battleMarkerRuntime 接线与帧行为单测：attack_enemy 账号联册、生产接线守卫、
// 指令时刻 sender 解析，以及暂停按需重绘的标记帧顺序（恢复合并时删除的
// playbackSceneP3.markerFrame 行为回归——不是源码字符串断言）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { PLAYBACK_SCENE_SOURCE } from '../playbackScene.test.source.js'
import { resolveActiveAccount, resolveActiveSender } from './battleMarkerHost.js'
import { createMarkerRuntime } from './markerRuntime.js'
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

// 历史 playbackSceneP3.markerFrame.test.ts 在合并时被删除；这里用真实 renderLoop +
// 真实 markerRuntime + labels.updateLabels 观察点恢复行为级回归（不是源码字符串断言）：
// 暂停态按需重绘必须先重算标记，再做来源卡投影；位姿迟到/缺失同帧生效；空闲不再重绘。
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

    const snapshots: Array<{ x: number | null; visible: boolean | null; sources: number }> = []
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
      camera: new THREE.PerspectiveCamera(),
      controls: { update: () => false, target: new THREE.Vector3(), enabled: true, minDistance: 0 },
      store: { mapReady: true, hasData: true, fps: 0, frameMs: 0, framePeakMs: 0 },
      mapWorld: { animLayerMats: () => [], tickDynamicLights: () => {}, destruct: () => null, maybeRebuildTerrainLod: () => {} },
      cameraRuntime: {
        cam: () => 'free', cameraDriven: () => false, cameraBlend: () => false, fovRestore: () => false,
        flyMode: () => false, zoomTick: () => {}, renderArmorHighlight: () => {}, armorStats: () => ({}),
      },
      clampOrbitCameraToTerrain: () => {},
      clampCameraTarget: () => {},
      labels: {
        updateLabels: vi.fn(() => {
          const ring = markerScene.children.find((o) => o instanceof THREE.Mesh)
          snapshots.push({
            x: ring?.geometry.boundingSphere?.center.x ?? null,
            visible: ring?.visible ?? null,
            sources: markerRuntime.labelSources().length,
          })
        }),
        updateScore: vi.fn(),
      },
      updateBases: vi.fn(),
      battle: { isActive: () => false, transients: { updateNow: () => {} }, updateBattleFx: () => {}, advanceWreckClock: () => {} },
      battleMarkers: markerRuntime,
      vehicles: { frameTiming: () => {}, getVehicles: () => [] },
      session: { isReadySession: () => false, tryMarkFirstReadyFrame: () => {} },
      waterReflection: { update: () => {} },
      container: { clientWidth: 800, clientHeight: 600 },
      DEBUG: false,
      PERF: false,
    }
    type Host = Parameters<typeof installRenderLoop>[0]
    const host = S as unknown as Host
    installRenderLoop(host)
    const animate = () => (host as unknown as { animate: () => void }).animate()
    const setDirty = (dirty: boolean) => { (host as unknown as { frameDirty: boolean }).frameDirty = dirty }

    setDirty(true)
    animate()
    expect(snapshots).toEqual([{ x: 1, visible: true, sources: 1 }])

    poses.set(42, { x: 40, z: 2 })
    setDirty(true)
    animate()
    expect(snapshots[1]).toEqual({ x: 40, visible: true, sources: 1 })

    poses.set(42, null)
    setDirty(true)
    animate()
    expect(snapshots[2]).toEqual({ x: 40, visible: false, sources: 0 })

    // 空闲帧（无脏标记、无在飞特效）不得再投影标签或重绘。
    animate()
    animate()
    expect(snapshots).toHaveLength(3)
    expect(render).toHaveBeenCalledTimes(3)
  })
})
