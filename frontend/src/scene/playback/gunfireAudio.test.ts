// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gate = vi.hoisted(() => ({ bytesDelay: null as Promise<void> | null }))
const assets = vi.hoisted(() => ({
  index: {
    main: { close: ['main_close_01.ogg', 'main_close_02.ogg'], far: ['main_far_01.ogg'] },
    huge: { close: ['huge_close_01.ogg'] },
    auto: { close: ['auto_close_01.ogg'] },
  },
  gunClass: {
    '1': { '5': 'wpn_shot_main_mb' },      // 合法 tag（_mb 变体 → 同等级）
    '2': { '7': 'wpn_shot_huge' },
    '3': { '9': 'wpn_Oth50_STT' },         // 词表外 → 不播（fail-closed）
    '5': { '13': 'wpn_shot_auto' },
  },
}))
vi.mock('../assetProvider.js', () => ({
  assetProvider: {
    json: async (path: string) => {
      if (path === '/sound/wpn/index.json') return assets.index
      if (path === '/sound/wpn/gun_class.json') return assets.gunClass
      throw new Error(`unexpected ${path}`)
    },
    bytes: async (path: string) => {
      if (gate.bytesDelay) await gate.bytesDelay
      return new TextEncoder().encode(`bytes:${path}`)
    },
  },
}))
vi.mock('../agentData.js', () => ({
  fetchTankData: async (id: number) => {
    if (id === 3) throw new Error('HTTP 404')
    return { configs: [{ gun_local: 5 }] }
  },
}))

import { createGunfireAudio, gainForDistance, panForCameraSpace, GUN_MAX_ATTENUATION_M, __resetGunfireAudioForTest } from './gunfireAudio.ts'
import { __reloadFeedbackPrefsForTest, setFeedbackPref } from '../../composables/useFeedbackPrefs.js'
import * as THREE from 'three'
import type { AgentPlaybackShot } from '../../api/agent-replay-facets.js'

function shotOf(eid: number): AgentPlaybackShot {
  return { t_fire: 1, shooter_eid: eid, from: [0, 0, 0], to: [0, 0, 0], flight_secs: 1, shell_speed: 0, hit: false, ricochet: false, game_hit_result: 0, damage: 0, is_kill: false, is_author: false } as AgentPlaybackShot
}

const audio = { started: [] as string[], stopped: 0 }
class FakeContext {
  decodeAudioData(buf: ArrayBuffer) { return Promise.resolve(new TextDecoder().decode(buf)) }
  createBufferSource() {
    const node: Record<string, unknown> = {
      buffer: null,
      connect: (n: unknown) => n,
      start: () => { audio.started.push(String(node.buffer)) },
      stop: () => { audio.stopped += 1 },
    }
    return node
  }
  createGain() { return { gain: { value: 0 }, connect: (n: unknown) => n } }
  createStereoPanner() { return { pan: { value: 0 }, connect: (n: unknown) => n } }
  state = 'running'
  resume() { return Promise.resolve() }
  destination = {}
}

/** 统一装配：相机在原点，射手 def 由用例注入（vehicleByEid 同构投影面）。 */
function makeHarness() {
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 0, 0)
  const defs = new Map<number, { tank_id?: number | null, gun_local?: unknown, config_idx?: unknown }>()
  const gunfire = createGunfireAudio({
    getCamera: () => camera,
    getVehicleDef: shot => defs.get(shot.shooter_eid) ?? null,
  })
  return { gunfire, defs }
}

beforeEach(() => {
  window.localStorage.clear()
  __reloadFeedbackPrefsForTest()   // 上一用例可能关过 battleSound（模块级 ref 跨用例残留）
  __resetGunfireAudioForTest()
  audio.started.length = 0
  audio.stopped = 0
  gate.bytesDelay = null
  vi.stubGlobal('AudioContext', FakeContext)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('gainForDistance（500m 衰减外不播；产品近似曲线）', () => {
  it('0m=1，线性衰减，≥500m=0，非法输入=0', () => {
    expect(gainForDistance(0)).toBe(1)
    expect(gainForDistance(250)).toBeCloseTo(0.5)
    expect(gainForDistance(GUN_MAX_ATTENUATION_M)).toBe(0)
    expect(gainForDistance(GUN_MAX_ATTENUATION_M + 1)).toBe(0)
    expect(gainForDistance(-5)).toBe(0)
    expect(gainForDistance(Number.NaN)).toBe(0)
  })
})

describe('panForCameraSpace（±0.8 压幅；NaN=0）', () => {
  it('居中=0，压幅到 0.8，NaN 回 0', () => {
    expect(panForCameraSpace(0)).toBe(0)
    expect(panForCameraSpace(2)).toBe(0.8)
    expect(panForCameraSpace(-2)).toBe(-0.8)
    expect(panForCameraSpace(Number.NaN)).toBe(0)
  })
})

describe('createGunfireAudio（炮→等级联表 + 触发）', () => {
  it('映射命中（含 _mb 变体 tag）开火 → close 层播放；词表外不播', async () => {
    const { gunfire, defs } = makeHarness()
    defs.set(1, { tank_id: 1, gun_local: 5 })   // wpn_shot_main_mb → main
    defs.set(2, { tank_id: 3, gun_local: 9 })   // wpn_Oth50_STT → 词表外
    gunfire.prepare([{ tank_id: 1, gun_local: 5 }, { tank_id: 3, gun_local: 9 }])
    gunfire.onShot(shotOf(1), new THREE.Vector3(10, 0, 0))
    await vi.waitFor(() => expect(audio.started).toHaveLength(1))
    expect(audio.started[0]).toContain('/sound/wpn/main_close_0')
    gunfire.onShot(shotOf(2), new THREE.Vector3(10, 0, 0))
    await new Promise(r => setTimeout(r, 20))
    expect(audio.started).toHaveLength(1)
  })

  it('未透传 gun_local 时经 configs[config_idx] 联表回退；tank 数据缺失不播', async () => {
    const { gunfire, defs } = makeHarness()
    defs.set(1, { tank_id: 1, config_idx: 0 })   // configs[0].gun_local=5 → main
    defs.set(2, { tank_id: 3, config_idx: 0 })   // fetchTankData 抛 404 → 不播
    gunfire.onShot(shotOf(1), new THREE.Vector3(5, 0, 0))
    await vi.waitFor(() => expect(audio.started).toHaveLength(1))
    expect(audio.started[0]).toContain('/sound/wpn/main_close_')
    gunfire.onShot(shotOf(2), new THREE.Vector3(5, 0, 0))
    await new Promise(r => setTimeout(r, 20))
    expect(audio.started).toHaveLength(1)
  })

  it('距离 ≥500m 不播；偏好关闭不播；dispose 停声源', async () => {
    const { gunfire, defs } = makeHarness()
    defs.set(1, { tank_id: 2, gun_local: 7 })   // huge
    gunfire.onShot(shotOf(1), new THREE.Vector3(GUN_MAX_ATTENUATION_M, 0, 0))
    await new Promise(r => setTimeout(r, 20))
    expect(audio.started).toHaveLength(0)
    gunfire.onShot(shotOf(1), new THREE.Vector3(30, 0, 0))
    await vi.waitFor(() => expect(audio.started).toHaveLength(1))
    setFeedbackPref('battleSound', false)
    gunfire.onShot(shotOf(1), new THREE.Vector3(30, 0, 0))
    await new Promise(r => setTimeout(r, 20))
    expect(audio.started).toHaveLength(1)
    gunfire.dispose()
    expect(audio.stopped).toBe(1)
  })

  it('异步取 buffer 期间 dispose：迟到的 Promise 不 start（评审 P2 会话代）', async () => {
    const { gunfire, defs } = makeHarness()
    defs.set(1, { tank_id: 5, gun_local: 13 })   // auto（独立于其它用例的 class）
    let release!: () => void
    gate.bytesDelay = new Promise<void>((r) => { release = r })
    gunfire.onShot(shotOf(1), new THREE.Vector3(30, 0, 0))
    // 让 resolveClass 完成、请求推进到 loadBuffers 的 bytes await
    await new Promise(r => setTimeout(r, 10))
    expect(audio.started).toHaveLength(0)
    gunfire.dispose()          // 会话结束：generation++ 失效在飞请求
    release()                  // 迟到的 buffer 到达
    gate.bytesDelay = null
    await new Promise(r => setTimeout(r, 30))
    expect(audio.started).toHaveLength(0)   // 不得在 dispose 之后发声
  })

  it('异步取 buffer 期间关闭 battleSound：release 后不 start（评审 P2 中途静音）', async () => {
    const { gunfire, defs } = makeHarness()
    defs.set(1, { tank_id: 5, gun_local: 13 })
    let release!: () => void
    gate.bytesDelay = new Promise<void>((r) => { release = r })
    gunfire.onShot(shotOf(1), new THREE.Vector3(30, 0, 0))
    await new Promise(r => setTimeout(r, 10))
    setFeedbackPref('battleSound', false)   // 会话代号不变，只有偏好转静音
    release()
    gate.bytesDelay = null
    await new Promise(r => setTimeout(r, 30))
    expect(audio.started).toHaveLength(0)
  })

  it('异步等待期间换场（prepare 新会话）：旧会话的迟到请求不 start', async () => {
    const { gunfire, defs } = makeHarness()
    defs.set(1, { tank_id: 5, gun_local: 13 })
    let release!: () => void
    gate.bytesDelay = new Promise<void>((r) => { release = r })
    gunfire.onShot(shotOf(1), new THREE.Vector3(30, 0, 0))
    await new Promise(r => setTimeout(r, 10))
    gunfire.prepare([])        // 新会话开始（generation++）
    release()
    gate.bytesDelay = null
    await new Promise(r => setTimeout(r, 30))
    expect(audio.started).toHaveLength(0)
  })
})
