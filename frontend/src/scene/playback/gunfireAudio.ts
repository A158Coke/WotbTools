import * as THREE from 'three'
import type { PerspectiveCamera } from 'three'
import { assetProvider } from '../assetProvider.js'
import { feedbackPrefs } from '../../composables/useFeedbackPrefs.js'
import { fetchTankData } from '../agentData.js'
import type { AgentPlaybackShot } from '../../api/agent-replay-facets.js'

export const GUN_CLASSES = Object.freeze([
  'small', 'mid', 'main', 'large', 'huge', 'huge_extra', 'auto',
] as const)
export type GunClass = (typeof GUN_CLASSES)[number]
export const GUN_LAYERS = Object.freeze(['close', 'mid', 'far'] as const)

const TAG_CLASS: Record<string, GunClass> = Object.freeze(Object.fromEntries(
  GUN_CLASSES.flatMap(c => [[`wpn_shot_${c}`, c] as const, [`wpn_shot_${c}_mb`, c] as const]),
))

export const GUN_MAX_ATTENUATION_M = 500
export function gainForDistance(distanceM: number): number {
  if (!(distanceM >= 0) || distanceM >= GUN_MAX_ATTENUATION_M) return 0
  return Math.max(0.05, 1 - distanceM / GUN_MAX_ATTENUATION_M)
}
export function panForCameraSpace(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.max(-0.8, Math.min(0.8, x))
}
const MAX_VOICES = 12

type SoundIndex = Partial<Record<GunClass, Partial<Record<string, string[]>>>>
type GunClassTable = Record<string, Record<string, string>>

export interface GunfireVehicleDef {
  tank_id?: number | null
  gun_local?: unknown
  config_idx?: unknown
}

export interface GunfireAudioDeps {
  getCamera(): PerspectiveCamera
  getVehicleDef(shot: AgentPlaybackShot): GunfireVehicleDef | null
}

export interface GunfireAudio {
  prepare(defs: readonly GunfireVehicleDef[]): void
  invalidatePending(): void
  dispose(): void
  onShot(shot: AgentPlaybackShot, muzzle: THREE.Vector3): void
}

let soundIndexPromise: Promise<SoundIndex> | null = null
let gunClassTablePromise: Promise<GunClassTable> | null = null
const bufferCache = new Map<string, Promise<AudioBuffer[]>>()
let disabled = false

function isPermanentAssetMiss(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e)
  return message.includes("HTTP 404")
}

async function loadMetadata<T>(load: () => Promise<T>, slot: () => Promise<T> | null, assign: (v: Promise<T> | null) => void): Promise<T> {
  const cached = slot()
  if (cached) return cached
  const request = load()
  assign(request)
  try {
    return await request
  } catch (e) {
    assign(null)
    if (isPermanentAssetMiss(e)) disabled = true
    throw e
  }
}

function loadSoundIndex(): Promise<SoundIndex> {
  return loadMetadata(
    () => assetProvider.json<SoundIndex>('/sound/wpn/index.json'),
    () => soundIndexPromise,
    (v) => { soundIndexPromise = v },
  )
}
function loadGunClassTable(): Promise<GunClassTable> {
  return loadMetadata(
    () => assetProvider.json<GunClassTable>('/sound/wpn/gun_class.json'),
    () => gunClassTablePromise,
    (v) => { gunClassTablePromise = v },
  )
}

function loadBuffers(cls: string, layer: string): Promise<AudioBuffer[]> {
  const key = `${cls}:${layer}`
  const pending = bufferCache.get(key)
  if (pending) return pending
  const req = (async () => {
    const idx = await loadSoundIndex()
    const files = idx[cls as GunClass]?.[layer] || []
    const audio = acquireContext()
    const buffers = await Promise.all(files.map(async f => {
      const bytes = await assetProvider.bytes(`/sound/wpn/${f}`)
      return audio.decodeAudioData(bytes.buffer as ArrayBuffer)
    }))
    return buffers.filter(b => !!b)
  })()
  bufferCache.set(key, req)
  req.catch(() => bufferCache.delete(key))
  return req
}

let ctx: AudioContext | null = null
function acquireContext(): AudioContext {
  if (!ctx) ctx = new window.AudioContext()
  if (ctx.state === 'suspended') ctx.resume().catch(() => { /* 无手势期拒绝：留待下次 */ })
  return ctx
}

export function createGunfireAudio(deps: GunfireAudioDeps): GunfireAudio {
  const voices = new Set<AudioBufferSourceNode>()
  const classCache = new Map<string, GunClass | null>()
  let generation = 0

  function resolveClass(
    tankId: number | null | undefined,
    gunLocal: unknown,
    configIdx: unknown,
  ): Promise<GunClass | null> {
    if (tankId == null) return Promise.resolve(null)
    const gunKey = gunLocal != null ? String(Number(gunLocal)) : null
    const key = `${tankId}:${gunKey ?? 'cfg:' + String(configIdx)}`
    const hit = classCache.get(key)
    if (hit !== undefined) return Promise.resolve(hit)
    return (async (): Promise<GunClass | null> => {
      const table = await loadGunClassTable()
      const perTank = table[String(tankId)]
      let tag: string | undefined
      if (gunKey != null && perTank) tag = perTank[gunKey]
      if (!tag && configIdx != null && perTank) {
        try {
          const tank = await fetchTankData(tankId)
          const cfg = (tank?.configs || [])[Number(configIdx)]
          const gl = cfg?.gun_local != null ? String(Number(cfg.gun_local)) : null
          if (gl) tag = perTank[gl]
        } catch { /* tank 数据缺失 → 不播 */ }
      }
      const cls = tag != null ? (TAG_CLASS[tag] ?? null) : null
      classCache.set(key, cls)
      return cls
    })()
  }

  /** @param gen 发起时（onShot）的会话代；每个 await 之后与 start 前核对，过期即弃。 */
  async function play(cls: GunClass, muzzle: THREE.Vector3, gen: number): Promise<void> {
    if (disabled || gen !== generation) return
    const camera = deps.getCamera()
    const distance = muzzle.distanceTo(camera.position)
    if (distance >= GUN_MAX_ATTENUATION_M) return
    const buffers = await loadBuffers(cls, 'close')
    if (gen !== generation || disabled || !feedbackPrefs.value.battleSound) return
    if (!buffers.length || voices.size >= MAX_VOICES) return
    const audio = acquireContext()
    const local = muzzle.clone().applyMatrix4(camera.matrixWorldInverse)
    const horiz = Math.hypot(local.x, local.z)
    const pan = panForCameraSpace(horiz > 1e-6 ? local.x / horiz : 0)
    const src = audio.createBufferSource()
    src.buffer = buffers[Math.floor(Math.random() * buffers.length)]
    const gain = audio.createGain()
    gain.gain.value = gainForDistance(distance)
    const panner = audio.createStereoPanner()
    panner.pan.value = pan
    src.connect(gain).connect(panner).connect(audio.destination)
    src.onended = () => voices.delete(src)
    voices.add(src)
    src.start()
  }

  function stopVoices(): void {
    for (const v of voices) { try { v.stop() } catch { /* already stopped */ } }
    voices.clear()
  }

  return {
    prepare(defs) {
      generation++
      const gen = generation
      if (disabled || !feedbackPrefs.value.battleSound) return
      void (async () => {
        try {
          const classes = new Set<GunClass>()
          await Promise.all(defs.map(d => resolveClass(d.tank_id, d.gun_local, d.config_idx)
            .then(c => { if (c !== null) classes.add(c) })))
          if (gen !== generation) return
          await Promise.all([...classes].map(c => loadBuffers(c, 'close')))
        } catch (e) {
          console.warn('[gunfire] 预热失败（资产源缺 sound/wpn？）:', e)
        }
      })()
    },
    onShot(shot, muzzle) {
      if (disabled || !feedbackPrefs.value.battleSound) return
      const def = deps.getVehicleDef(shot)
      if (!def) return
      const gen = generation
      void resolveClass(def.tank_id, def.gun_local, def.config_idx)
        .then(c => {
          if (c === null) return undefined
          if (gen !== generation || disabled || !feedbackPrefs.value.battleSound) return undefined
          return play(c, muzzle, gen)
        })
        .catch(() => { /* resolveClass 内已置缓存，静默 */ })
    },
    invalidatePending() {
      generation++
      stopVoices()
    },
    dispose() {
      generation++
      stopVoices()
    },
  }
}

export function __resetGunfireAudioForTest(): void {
  soundIndexPromise = null
  gunClassTablePromise = null
  bufferCache.clear()
  disabled = false
  ctx = null
}
