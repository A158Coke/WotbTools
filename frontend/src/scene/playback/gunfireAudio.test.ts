// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gate = vi.hoisted(() => ({
  bytesDelay: null as Promise<void> | null,
  jsonFail: { remaining: 0, permanent: false },
  jsonRequests: 0,
}))
const assets = vi.hoisted(() => ({
  index: {
    main: { close: ['main_close_01.ogg', 'main_close_02.ogg'], far: ['main_far_01.ogg'] },
    huge: { close: ['huge_close_01.ogg'] },
    auto: { close: ['auto_close_01.ogg'] },
    small: { close: ['small_close_01.ogg'] },
  },
  gunClass: {
    '1': { '5': 'wpn_shot_main_mb' },
    '2': { '7': 'wpn_shot_huge' },
    '3': { '9': 'wpn_Oth50_STT' },
    '5': { '13': 'wpn_shot_auto' },
    '6': { '15': 'wpn_shot_small' },
  },
}))
vi.mock('../assetProvider.js', () => ({
  assetProvider: {
    json: async (path: string) => {
      gate.jsonRequests++
      if (gate.jsonFail.remaining > 0) {
        gate.jsonFail.remaining--
        throw new Error(`asset ${path}: HTTP ${gate.jsonFail.permanent ? 404 : 503}`)
      }
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

const audio = {
  started: [] as string[],
  stopped: 0,
  gains: [] as Array<{ gain: { value: number } }>,
  gainTargets: [] as Array<{ value: number; time: number; timeConstant: number }>,
  sources: [] as Array<{ onended: (() => void) | null }>,
}
class FakeContext {
  currentTime = 1
  decodeAudioData(buf: ArrayBuffer) { return Promise.resolve(new TextDecoder().decode(buf)) }
  createBufferSource() {
    const node: Record<string, unknown> = {
      buffer: null,
      connect: (n: unknown) => n,
      start: () => { audio.started.push(String(node.buffer)) },
      stop: () => { audio.stopped += 1 },
      onended: null,
    }
    audio.sources.push(node as unknown as { onended: (() => void) | null })
    return node
  }
  createGain() {
    const param = {
      value: 0,
      setTargetAtTime(value: number, time: number, timeConstant: number) {
        param.value = value
        audio.gainTargets.push({ value, time, timeConstant })
      },
    }
    const node = { gain: param, connect: (n: unknown) => n }
    audio.gains.push(node)
    return node
  }
  createStereoPanner() { return { pan: { value: 0 }, connect: (n: unknown) => n } }
  state = 'running'
  resume() { return Promise.resolve() }
  destination = {}
}

function makeHarness() {
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 0, 0)
  const defs = new Map<number, { tank_id?: number | null, gun_local?: unknown, config_idx?: unknown }>()
  const gunfire = createGunfireAudio({
    getCamera: () => camera,
    getVehicleDef: shot => defs.get(shot.shooter_eid) ?? null,
  })
  return { gunfire, defs, camera }
}

beforeEach(() => {
  window.localStorage.clear()
  __reloadFeedbackPrefsForTest()
  __resetGunfireAudioForTest()
  audio.started.length = 0
  audio.stopped = 0
  audio.gains.length = 0
  audio.gainTargets.length = 0
  audio.sources.length = 0
  gate.bytesDelay = null
  gate.jsonFail.remaining = 0
  gate.jsonFail.permanent = false
  gate.jsonRequests = 0
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
    defs.set(1, { tank_id: 1, gun_local: 5 })
    defs.set(2, { tank_id: 3, gun_local: 9 })
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
    defs.set(1, { tank_id: 1, config_idx: 0 })
    defs.set(2, { tank_id: 3, config_idx: 0 })
    gunfire.onShot(shotOf(1), new THREE.Vector3(5, 0, 0))
    await vi.waitFor(() => expect(audio.started).toHaveLength(1))
    expect(audio.started[0]).toContain('/sound/wpn/main_close_')
    gunfire.onShot(shotOf(2), new THREE.Vector3(5, 0, 0))
    await new Promise(r => setTimeout(r, 20))
    expect(audio.started).toHaveLength(1)
  })

  it('相机移动：按世界距离持续更新增益（AudioParam 平滑、静止不重复写、≥500m 归零）', async () => {
    const { gunfire, defs, camera } = makeHarness()
    defs.set(1, { tank_id: 1, gun_local: 5 })   // main
    gunfire.onShot(shotOf(1), new THREE.Vector3(0, 0, 0))
    await vi.waitFor(() => expect(audio.started).toHaveLength(1))
    expect(audio.gains[0].gain.value).toBe(1)
    // 近 → 中：相机移动后重算，而不是开炮瞬间的一次性距离
    camera.position.set(250, 0, 0)
    gunfire.update()
    expect(audio.gainTargets.at(-1)?.value).toBeCloseTo(0.5, 6)
    expect(audio.gainTargets.at(-1)?.time).toBe(1)
    expect(audio.gainTargets.at(-1)?.timeConstant).toBe(0.05)
    // 静止帧不重复写 AudioParam（避免自动化事件堆积/抖动）
    const writes = audio.gainTargets.length
    gunfire.update()
    expect(audio.gainTargets).toHaveLength(writes)
    // 中 → 近 → 衰减外 → 再靠近：目标随距离双向更新
    camera.position.set(100, 0, 0)
    gunfire.update()
    expect(audio.gainTargets.at(-1)?.value).toBeCloseTo(0.8, 6)
    camera.position.set(600, 0, 0)
    gunfire.update()
    expect(audio.gainTargets.at(-1)?.value).toBe(0)
    camera.position.set(50, 0, 0)
    gunfire.update()
    expect(audio.gainTargets.at(-1)?.value).toBeCloseTo(0.9, 6)
  })

  it('多车各自更新；自然结束 / dispose 后不再写参数（无残留声源）', async () => {
    const { gunfire, defs, camera } = makeHarness()
    defs.set(1, { tank_id: 1, gun_local: 5 })   // main
    defs.set(2, { tank_id: 2, gun_local: 7 })   // huge
    gunfire.onShot(shotOf(1), new THREE.Vector3(0, 0, 0))
    await vi.waitFor(() => expect(audio.started).toHaveLength(1))
    gunfire.onShot(shotOf(2), new THREE.Vector3(250, 0, 0))
    await vi.waitFor(() => expect(audio.started).toHaveLength(2))
    expect(audio.gains.map(g => g.gain.value)).toEqual([1, 0.5])
    camera.position.set(250, 0, 0)
    gunfire.update()
    // 第一发 0→250m 降到 0.5；第二发 250m→0 升到 1（互不影响）
    expect(audio.gainTargets.map(t => t.value)).toEqual([0.5, 1])
    audio.sources[0].onended?.()   // 第一发声源自然结束
    const writes = audio.gainTargets.length
    camera.position.set(750, 0, 0)   // 第二发距离 500m → 0
    gunfire.update()
    expect(audio.gainTargets).toHaveLength(writes + 1)
    expect(audio.gainTargets.at(-1)?.value).toBe(0)
    gunfire.dispose()
    camera.position.set(0, 0, 0)
    gunfire.update()
    expect(audio.gainTargets).toHaveLength(writes + 1)
  })

  it('距离 ≥500m 不播；偏好关闭不播；dispose 停声源', async () => {
    const { gunfire, defs } = makeHarness()
    defs.set(1, { tank_id: 2, gun_local: 7 })
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
    defs.set(1, { tank_id: 5, gun_local: 13 })
    let release!: () => void
    gate.bytesDelay = new Promise<void>((r) => { release = r })
    gunfire.onShot(shotOf(1), new THREE.Vector3(30, 0, 0))
    await new Promise(r => setTimeout(r, 10))
    expect(audio.started).toHaveLength(0)
    gunfire.dispose()
    release()
    gate.bytesDelay = null
    await new Promise(r => setTimeout(r, 30))
    expect(audio.started).toHaveLength(0)
  })

  it('异步取 buffer 期间关闭 battleSound：release 后不 start（评审 P2 中途静音）', async () => {
    const { gunfire, defs } = makeHarness()
    defs.set(1, { tank_id: 5, gun_local: 13 })
    let release!: () => void
    gate.bytesDelay = new Promise<void>((r) => { release = r })
    gunfire.onShot(shotOf(1), new THREE.Vector3(30, 0, 0))
    await new Promise(r => setTimeout(r, 10))
    setFeedbackPref('battleSound', false)
    release()
    gate.bytesDelay = null
    await new Promise(r => setTimeout(r, 30))
    expect(audio.started).toHaveLength(0)
  })

  it('元数据临时失败可恢复：503 后下一次开炮重新请求并播放（评审 P2）', async () => {
    const { gunfire, defs } = makeHarness()
    defs.set(1, { tank_id: 5, gun_local: 13 })
    gate.jsonFail.remaining = 1
    gunfire.onShot(shotOf(1), new THREE.Vector3(30, 0, 0))
    await new Promise(r => setTimeout(r, 20))
    expect(audio.started).toHaveLength(0)
    gunfire.onShot(shotOf(1), new THREE.Vector3(30, 0, 0))
    await vi.waitFor(() => expect(audio.started).toHaveLength(1))
  })

  it('元数据 404 视为资产缺失：保持禁用，不再重复请求', async () => {
    const { gunfire, defs } = makeHarness()
    defs.set(1, { tank_id: 5, gun_local: 13 })
    gate.jsonFail.remaining = 1
    gate.jsonFail.permanent = true
    gunfire.onShot(shotOf(1), new THREE.Vector3(30, 0, 0))
    await new Promise(r => setTimeout(r, 20))
    expect(audio.started).toHaveLength(0)
    const requestsAfterMiss = gate.jsonRequests
    gunfire.onShot(shotOf(1), new THREE.Vector3(30, 0, 0))
    await new Promise(r => setTimeout(r, 20))
    expect(audio.started).toHaveLength(0)
    expect(gate.jsonRequests).toBe(requestsAfterMiss)
  })

  it('seek（invalidatePending）：在飞请求作废、在响声源停止，之后新开炮仍可播（评审 P2）', async () => {
    const { gunfire, defs } = makeHarness()
    defs.set(1, { tank_id: 5, gun_local: 13 })
    defs.set(2, { tank_id: 6, gun_local: 15 })
    gunfire.onShot(shotOf(1), new THREE.Vector3(30, 0, 0))
    await vi.waitFor(() => expect(audio.started).toHaveLength(1))
    let release!: () => void
    gate.bytesDelay = new Promise<void>((r) => { release = r })
    gunfire.onShot(shotOf(2), new THREE.Vector3(30, 0, 0))
    await new Promise(r => setTimeout(r, 10))
    gunfire.invalidatePending()
    expect(audio.stopped).toBe(1)
    release()
    gate.bytesDelay = null
    await new Promise(r => setTimeout(r, 30))
    expect(audio.started).toHaveLength(1)
    gunfire.onShot(shotOf(1), new THREE.Vector3(30, 0, 0))
    await vi.waitFor(() => expect(audio.started).toHaveLength(2))
  })

  it('异步等待期间换场（prepare 新会话）：旧会话的迟到请求不 start', async () => {
    const { gunfire, defs } = makeHarness()
    defs.set(1, { tank_id: 5, gun_local: 13 })
    let release!: () => void
    gate.bytesDelay = new Promise<void>((r) => { release = r })
    gunfire.onShot(shotOf(1), new THREE.Vector3(30, 0, 0))
    await new Promise(r => setTimeout(r, 10))
    gunfire.prepare([])
    release()
    gate.bytesDelay = null
    await new Promise(r => setTimeout(r, 30))
    expect(audio.started).toHaveLength(0)
  })
})
