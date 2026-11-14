// 3D 回放炮声（客户端内置 Wwise 武器音效的资产平面复刻，2026-11-14 MVP）。
//
// 数据链（Agent 仓 tools/ 一手导出，语义全部来自客户端文件级声明）：
//  * 音源 = 客户端 `weapon*.pck`（AKPK 容器）流式 .wem → OGG：tools/export_gun_sounds.py，
//    事件闭集 = SoundbanksInfo 的 play_wpn_{small,mid,main,large,huge,huge_extra,auto}_3p
//    （MaxAttenuation=500m；Close/Mid/Far 距离分层，资产包三层都备齐）。
//  * 炮 → 音效等级 = 车辆 XML 炮元素 `<effects>wpn_shot_*</effects>`（`_mb` 后缀 = 同等级
//    变体标记，网页侧同事件复用）：tools/export_gun_class.py → 资产包 sound/wpn/gun_class.json
//    键 `{tank_id: {gun_local: tag}}`。
//  * 触发 = battleRuntime.spawnShot（回放时钟推进到 t_fire；seek 经 resetShotsTo 只前移
//    游标，历史炮声不重放——与弹道特效同一游标语义）。
//
// MVP 边界（与导出工具头注释同口径）：
//  * 层选择固定 close：客户端在 HIRC 内按距离切 Close/Mid/Far 的阈值未取证；这里用
//    close 层 + WebAudio 距离增益近似，index.json 仍带全三层，取证后可平移启用。
//  * 距离 > MaxAttenuation（500m）不播；增益/pan 曲线为产品近似（非客户端语义）。
//  * 资产/映射缺失 → 该车该发静音（fail-open 于体验、fail-closed 于语义：绝不猜测等级），
//    仅 console.warn 留痕一次。
//  * iOS Safari WebAudio 随静音开关静音（与 useSound 同一平台口径）。
import * as THREE from 'three'
import type { PerspectiveCamera } from 'three'
import { assetProvider } from '../assetProvider.js'
import { feedbackPrefs } from '../../composables/useFeedbackPrefs.js'
import { fetchTankData } from '../agentData.js'
import type { AgentPlaybackShot } from '../../api/agent-replay-facets.js'

/** 炮声等级闭集 = 客户端 play_wpn_<class>_3p 事件词表（= 导出工具 EVENT_CLASSES）。 */
export const GUN_CLASSES = Object.freeze([
  'small', 'mid', 'main', 'large', 'huge', 'huge_extra', 'auto',
] as const)
export type GunClass = (typeof GUN_CLASSES)[number]
/** 距离层闭集（客户端 Close/Mid/Far）。 */
export const GUN_LAYERS = Object.freeze(['close', 'mid', 'far'] as const)

/** `<effects>wpn_shot_<class>[_mb]</effects>` → 等级（词表逐项声明，未列 = null 不播）。 */
const TAG_CLASS: Record<string, GunClass> = Object.freeze(Object.fromEntries(
  GUN_CLASSES.flatMap(c => [[`wpn_shot_${c}`, c] as const, [`wpn_shot_${c}_mb`, c] as const]),
))

/** 事件 MaxAttenuation（SoundbanksInfo，play_wpn_*_3p 全部 500m）。衰减外不发声。 */
export const GUN_MAX_ATTENUATION_M = 500
/** 500m 内增益的产品近似：线性 1 → 0.05（客户端实际衰减曲线未取证）。 */
export function gainForDistance(distanceM: number): number {
  if (!(distanceM >= 0) || distanceM >= GUN_MAX_ATTENUATION_M) return 0
  return Math.max(0.05, 1 - distanceM / GUN_MAX_ATTENUATION_M)
}
/** 立体声 pan 的产品近似：相机空间水平偏移方向（-1..1 压到 ±0.8）。 */
export function panForCameraSpace(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.max(-0.8, Math.min(0.8, x))
}
/** 同名并发声源上限（弹幕时刻保护，超出丢弃当发）。 */
const MAX_VOICES = 12

/** index.json 形状（sound/wpn/，export_gun_sounds.py 契约）。 */
type SoundIndex = Partial<Record<GunClass, Partial<Record<string, string[]>>>>
/** gun_class.json 形状（sound/wpn/，export_gun_class.py 契约）。 */
type GunClassTable = Record<string, Record<string, string>>

/** 射手车辆的炮声联表字段面（宿主从 RuntimeVehicle.def 投影，见 playbackScene 装配）。 */
export interface GunfireVehicleDef {
  tank_id?: number | null
  gun_local?: unknown
  config_idx?: unknown
}

export interface GunfireAudioDeps {
  getCamera(): PerspectiveCamera
  /** 射手 eid → 车辆 def（宿主经 vehicles.vehicleByEid 注入；无该车返回 null = 该发不播）。 */
  getVehicleDef(shot: AgentPlaybackShot): GunfireVehicleDef | null
}

export interface GunfireAudio {
  /** 会话装载后预热：按上阵车辆的 (tank_id, gun_local) 解析等级并预取 buffer（fire-and-forget）。 */
  prepare(defs: readonly GunfireVehicleDef[]): void
  /** seek 边界（宿主 seekTo 调用）：作废在飞请求并停止在响声源——旧时间点的炮声
   *  不得落到新时间点；seek 之后的新开炮照常（取新代号）。 */
  invalidatePending(): void
  /** 会话 teardown：作废在飞请求 + 停掉在响的声源（预取的 buffer 跨会话复用，不释放）。 */
  dispose(): void
  /** battleRuntime 每发开火回调（muzzle = 场景系炮口世界坐标）。 */
  onShot(shot: AgentPlaybackShot, muzzle: THREE.Vector3): void
}

// 资产缓存（模块级，跨会话/跨场景复用；内容不可变）
let soundIndexPromise: Promise<SoundIndex> | null = null
let gunClassTablePromise: Promise<GunClassTable> | null = null
const bufferCache = new Map<string, Promise<AudioBuffer[]>>() // key = `${class}:${layer}`
let disabled = false

/** 资产**确实不存在**（HTTP 404）才算永久禁用；网络抖动 / 5xx / 解码错误都是可恢复的。 */
function isPermanentAssetMiss(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e)
  // 生产格式：assetProvider.json 抛 `asset <path>: HTTP <status>`
  return message.includes("HTTP 404")
}

/** 元数据加载（可恢复失败）：失败时清空缓存的 Promise，下一次 prepare/onShot 会重试；
 *  只有 404 才置 `disabled`。此前每次失败都 `disabled = true` 且保留 rejected Promise，
 *  一次临时网络故障就让后续所有回放静音直到整页刷新（评审 P2）。 */
async function loadMetadata<T>(load: () => Promise<T>, slot: () => Promise<T> | null, assign: (v: Promise<T> | null) => void): Promise<T> {
  const cached = slot()
  if (cached) return cached
  const request = load()
  assign(request)
  try {
    return await request
  } catch (e) {
    assign(null)   // 允许重试（网络恢复后下一次调用重新请求）
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

// WebAudio 上下文（首个声源时惰性创建；iOS 随静音开关静音，见 useSound 同口径）
let ctx: AudioContext | null = null
function acquireContext(): AudioContext {
  if (!ctx) ctx = new window.AudioContext()
  // 自动播放策略：无用户手势时 resume 被浏览器拒绝——静默吞掉（下次有手势的交互后再试）
  if (ctx.state === 'suspended') ctx.resume().catch(() => { /* 无手势期拒绝：留待下次 */ })
  return ctx
}

/** 会话级实例（playbackScene 每场景一个；dispose 只停声源，缓存跨会话复用）。 */
export function createGunfireAudio(deps: GunfireAudioDeps): GunfireAudio {
  const voices = new Set<AudioBufferSourceNode>()
  // `${tank_id}:${gun_local|cfg:config_idx}` → 等级；键不含 eid，跨会话安全（车↔炮声明不变）
  const classCache = new Map<string, GunClass | null>()
  // 会话代：prepare（新会话开始）与 dispose（会话结束）递增。onShot 的解析/取 buffer
  // 都可能跨 await（网络 + 解码）；等待期间离开回放或换场时，迟到的 Promise 必须在
  // 每个异步边界后及 start 前核对代号——否则退出后/新回放里会响起旧回放的炮声
  //（评审 P2；dispose 只能停 voices 里已 start 的节点）。
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
        // 回退：def 未透传 gun_local 时经 configs[config_idx].gun_local 联表
        //（fail-closed：联不上 = 不播，不猜）
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
    // 取 buffer 可能跨网络 + 解码：期间 dispose/换场 → 弃播（不 start）；
    // 同时复查静音偏好与 disabled——关闭 battleSound 不改变会话代，只查 gen 会把
    // 「等待期间用户关掉炮声」的请求照常发声（评审 P2：中途静音分支）。
    if (gen !== generation || disabled || !feedbackPrefs.value.battleSound) return
    if (!buffers.length || voices.size >= MAX_VOICES) return
    const audio = acquireContext()
    // 相机空间水平方向 → pan（场景系坐标与相机同系，直接投影）
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

  /** 停掉所有在响声源（seek 与 teardown 共用；buffer 缓存不在此释放）。 */
  function stopVoices(): void {
    for (const v of voices) { try { v.stop() } catch { /* already stopped */ } }
    voices.clear()
  }

  return {
    prepare(defs) {
      // 纯预热（fire-and-forget）：onShot 不依赖本调用（缺资产/缺映射 → 当发静音 + 留痕）。
      // 递增会话代 = 新会话边界：上一会话还在飞的 onShot 请求从这里开始失效。
      generation++
      const gen = generation
      if (disabled || !feedbackPrefs.value.battleSound) return
      void (async () => {
        try {
          const classes = new Set<GunClass>()
          await Promise.all(defs.map(d => resolveClass(d.tank_id, d.gun_local, d.config_idx)
            .then(c => { if (c !== null) classes.add(c) })))
          if (gen !== generation) return   // 预热期间又换了会话：不再占带宽
          await Promise.all([...classes].map(c => loadBuffers(c, 'close')))
        } catch (e) {
          // 预热失败不阻断回放；首发声源会按 disabled 口径自然降级
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
          // 解析等级可能跨网络（config 联表回退）；会话已变 → 弃播
          if (gen !== generation || disabled || !feedbackPrefs.value.battleSound) return undefined
          return play(c, muzzle, gen)
        })
        .catch(() => { /* resolveClass 内已置缓存，静默 */ })
    },
    invalidatePending() {
      // 递增会话代：在飞的 resolve/load Promise 在下一个边界自行作废；
      // 同时停掉已响的声源（它们属于被跳过的旧时间点）
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
