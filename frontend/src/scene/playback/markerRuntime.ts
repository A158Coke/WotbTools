// 3D 战场快捷标记（battle markers）——把回放数据里的两类标记事实落到 3D 场景：
//   · `markers`（上游 v0.5.4 additive；Avatar method 0x2e）：marker_type 1=moving_here
//     （`at` 世界坐标）、4=attack / 5=ally_retreat（`target_eid`）；未知类型只保留 raw，不消费；
//   · `chat_events` 的 attention_to_cell 指令（上游 v0.5.3；0x2f）：`target` = 扇区号 1..9。
// 三类视觉：moving_here → 贴地圆环 + 高光柱（友军亮绿）；attack / ally_retreat → 目标车辆
// 贴地光环（亮红 / 亮绿，逐帧跟随目标位姿）；attention_to_cell → 地面半透明扇区矩形 + 描边带
// （objective 琥珀，**出现时闪烁**——与游戏注意标记同款）。来源标注卡不在本模块渲染：
// `labelSources()` 输出世界锚点 + 玩家/坦克字段，由 labelsRuntime（updateLabels 投影）与
// PlaybackVehicleLabels3D（与坦克名牌**同一 DOM 卡片**，屏幕空间恒定大小，不随距离缩放）消费。
//
// 生命周期 = **回放时钟窗口状态**（2026-11-19 用户裁示）：可见判据
// `ev.t <= T <= ev.t + MARKER_LIFETIME_S`（战斗秒）——暂停时 T 冻结 ⇒ 标记/闪烁/淡出
// 全部冻结；倒带回窗 ⇒ 立即重现；播过窗口 ⇒ 消失。`update(T)` 幂等重算，tick（播放中）
// 与 seekTo（任意跳转）共用同一条状态路径，无游标、无补播语义。
//
// fail-closed（不猜坐标 / 不猜语义 / 不猜身份）：
// - marker_type 1 缺合法 `at`（三有限数）→ 跳过；target_eid 非正整数 → 跳过；
//   未知 marker_type → 忽略（上游原样保留，语义未闭合）；
// - attention_to_cell：扇区号 1..9 之外不画；地图缺语义档案（mapGridProfile fail-closed
//   返回 null）或该九宫格区域无格 → 不画；
// - 目标光环：目标 eid 查不到可见车辆位姿 → 不画；激活期间位姿查不到 → 暂隐（不外推）；
// - 来源卡：0x2e 描述不到名册 def → 不出卡；0x2f 指令 sender 昵称联不到名册 → 只出玩家行
//   （sender 是包内唯一事实）；全缺（sender 空）→ 不出卡。
//
// 坐标系：游戏/回放系 → 场景系 **x 取负**（battleRuntime / vehicleRuntime / bases 同一
// 镜像规则）；扇区矩形来自 common/map-semantics/*.semantic.json 的 analysisGrid
// （六宫格 letter 单元各带 nineGridRegion 1..9，行优先、1 = 西北；语义 y = 回放 z），
// 区域矩形 = 该区域全部单元 bounds 的并集（与 MapOverview.vue gridRegions 同一聚合口径）。
// 扇区网格是地图级几何（各战斗变体共享同一底图空间），与 2D overview 的 gridCells
// 同口径、不做变体门禁。
import * as THREE from 'three'
import type { BufferGeometry, Material, Mesh, Scene, Vector3 } from 'three'
import type { AgentBattleMarkerEvent, AgentChatEvent } from '../../api/agent-replay-facets.js'
import { PLAYBACK_ROLES } from '../../data/mapTeamColors.js'
import { makeGroundedRing } from './bases.js'
import { sectorRectForMapKey, sectorQuadGeometry, sectorBorderGeometry, regroundRingInPlace, type MarkerSectorRect } from './markerGeometry.js'
import { markerSourceCard, type MarkerSourceCard } from './markerSourceCard.js'
export { markerSourceCard, type MarkerSourceCard } from './markerSourceCard.js'

export { sectorRectFromCells, sectorRectForMapKey, type MarkerSectorRect, type SectorGridCell } from './markerGeometry.js'

export const MARKER_LIFETIME_S = 10
/** 末段淡出（战斗秒）：窗口最后一段透明度线性降到 0；暂停即冻结。 */
export const MARKER_FADE_S = 2
/** 出现闪烁（战斗秒）：扇区高亮前段的确定性脉冲（暂停即冻结在当前相位）。 */
export const MARKER_FLASH_S = 1.6
/** 闪烁周期（战斗秒）：半周期亮暗交替。 */
export const MARKER_FLASH_PERIOD_S = 0.4
/** 目标光环出现闪烁（战斗秒）：攻击/撤退目标是「要立刻行动」的指令，闪得比扇区更久更亮。 */
export const TARGET_FLASH_S = 2.4
export const TARGET_FLASH_PERIOD_S = 0.5
export const TARGET_FLASH_MIN = 0.2
/** 同时在窗活动体上限：超限保留**最新**的若干条（确定性，不做任何统计判断）。 */
export const MARKER_MAX_ACTIVE = 8

const PING_RADIUS = 6
const PING_BEAM_H = 20
const PING_BEAM_R = 0.55
const PING_BEAM_OPACITY = 0.45
const TARGET_RADIUS = 5
const TARGET_SEG = 48
const TARGET_LABEL_LIFT = 6
const SECTOR_LABEL_LIFT = 5
const SECTOR_FILL_OPACITY = 0.28
const SECTOR_BORDER_OPACITY = 0.95
const RING_OPACITY = 0.9
/** 闪烁谷值：扇区高亮在闪窗内的最低透明度系数（峰值 1）。 */
const SECTOR_FLASH_MIN = 0.45
/** 来源卡锚点在光柱顶 / 光环上方的抬升。 */
const PING_LABEL_LIFT = 2.5

/** 扇区矩形（场景系：x 已镜像，z = 回放 z；单位米）。 */

/** 战场标记场景事件（t 升序；坐标已换到场景系；id = 稳定 key 供来源卡 DOM 复用）。
 *  数据面（上游 §2.3/§2.4 权威语义）：
 *  - 0x2e markers：ping（at）/ target（target_eid）——srcEid/srcAccount = 发送者；
 *  - 0x2f 指令：attention_to_cell（扇区号）→ sector；attack_enemy（payload = 目标
 *    accountId，eid/account 两域联名册）→ target；help_me / help_me_ex / follow_me /
 *    support_me_with_fire（payload 0，自机位置 ping）→ help（eid = sender 车辆）。
 *    sender 在包内只有昵称 → 宿主 findByNickname 联册，联不到 → 该指令仅进滚动流
 *    （无位置/身份事实，不猜坐标）。其余指令（positive/negative/attack/back_to_base/
 *    turn_back/hold_positions/stop/catch_point/defend_point/0x2f 60-62 等）无已闭合的
 *    位置/目标语义 → 不落 3D，仅滚动流。 */
export type MarkerSceneEvent =
  | { id: string; t: number; kind: 'ping'; x: number; z: number; srcEid: number; srcAccount: number }
  | { id: string; t: number; kind: 'help'; eid: number; srcEid: number; srcAccount: number }
  | { id: string; t: number; kind: 'target'; intent: 'attack' | 'retreat'; eid: number; srcEid: number; srcAccount: number; srcName?: string }
  | { id: string; t: number; kind: 'sector'; region: number; rect: MarkerSectorRect; source: string }

/** marker/chat 数据面（AgentPlaybackFacet 的消费子集）。 */
export interface MarkerData {
  markers?: Array<Partial<AgentBattleMarkerEvent>> | null
  chat_events?: Array<Partial<AgentChatEvent>> | null
}

const isFiniteTriple = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0

/** 注意扇区指令（仅 0x2f command 的 attention_to_cell；target = 扇区号 1..9）。 */
function attentionRegionOf(ev: Partial<AgentChatEvent> | null | undefined): number | null {
  if (!ev || ev.kind !== 'command' || ev.command_name !== 'attention_to_cell') return null
  const target = ev.target
  return typeof target === 'number' && Number.isInteger(target) && target >= 1 && target <= 9 ? target : null
}

/**
 * 数据面 → 场景事件表（t 升序）。逐条 fail-closed：畸形 payload / 域外扇区 /
 * 缺语义档案的扇区指令都丢弃，不做任何内容推断。
 */
export function buildMarkerEvents(data: MarkerData | null | undefined, mapKey: string | null | undefined): MarkerSceneEvent[] {
  const events: MarkerSceneEvent[] = []
  for (const m of data?.markers || []) {
    const t = m?.t
    if (typeof t !== 'number' || !Number.isFinite(t)) continue
    const srcEid = typeof m.entity_id === 'number' && Number.isFinite(m.entity_id) ? m.entity_id : 0
    const srcAccount = typeof m.account_id === 'number' && Number.isFinite(m.account_id) ? m.account_id : 0
    const id = `${events.length}`
    if (m.marker_type === 1) {
      if (!isFiniteTriple(m.at)) continue
      events.push({ id, t, kind: 'ping', x: -m.at[0], z: m.at[2], srcEid, srcAccount })
    } else if (m.marker_type === 4 || m.marker_type === 5) {
      if (!isPositiveInt(m.target_eid)) continue
      events.push({ id, t, kind: 'target', intent: m.marker_type === 4 ? 'attack' : 'retreat', eid: m.target_eid, srcEid, srcAccount })
    }
    // 其余 marker_type 语义未闭合（上游原样保留）：不消费。
  }
  for (const ev of data?.chat_events || []) {
    const region = attentionRegionOf(ev)
    const t = ev?.t
    if (region == null || typeof t !== 'number' || !Number.isFinite(t)) continue
    const rect = sectorRectForMapKey(mapKey, region)
    if (!rect) continue
    events.push({ id: `${events.length}`, t, kind: 'sector', region, rect, source: (ev.sender || '').trim() })
  }
  events.sort((a, b) => a.t - b.t)
  // 升序重排后 id 须与最终次序一致（来源卡 key 稳定性的唯一依据）
  for (let i = 0; i < events.length; i++) events[i] = { ...events[i], id: `${i}` } as MarkerSceneEvent
  return events
}

/** 来源标注卡字段（与坦克名牌同构：玩家行 + 车型行；空行不上）。
 *  target 类卡的 `target` = 目标车型（动作章「要求攻击 {target}」），身份两行 = **发起者**。 */
export type VehiclePoseLookup = (eid: number, t: number, out: Vector3) => boolean

/**
 * 来源描述查询面（宿主经 vehicles def 提供：eid/account_id 为位姿与身份联表键；
 * tank_id 占位名/tankNames 表解析纪律见 markerSourceCard）。eid 优先、account 兜底；
 * 描述不到返回 null。
 */
export interface MarkerSourceDef {
  eid: number
  account_id: number
  nickname?: string | null
  tank_name?: string | null
  tank_id?: number | null
}
export type MarkerSourceLookup = (eid: number, accountId: number, t?: number) => MarkerSourceDef | null

/** 0x2f 指令 sender 昵称联名册（玩家 + 坦克两行 + 自机位置 eid；联不到返回 null）。
 *  t = 指令时刻：同名多实体（AoI 重入 / 复活换 eid）时必须解析**指令时刻在场**的那一个。 */
export type MarkerSenderLookup = (nickname: string, t?: number) => MarkerSourceDef | null

export interface MarkerRuntimeDeps {
  getScene: () => Scene
  /** 贴地高度（世界事实 owner = mapWorld.groundY）。 */
  groundY: (x: number, z: number) => number
  getVehiclePose: VehiclePoseLookup
  /**
   * 历史位姿采样（发令时刻 t 的位姿 + **历史在场判断**；不做当前帧 group.visible
   * gate——求援 ping 语义 = 发令时的位置，与播放历史无关，评审 P2）。缺省回退
   * getVehiclePose（旧行为：当前帧位姿——仅单测桩使用）。
   */
  getPoseAt?: VehiclePoseLookup
  /** 来源描述（0x2e 的 entity_id/account_id 同域；查不到 → 不出卡）。 */
  describeSource: MarkerSourceLookup
  /** sender 昵称联名册（attention_to_cell 的玩家+坦克行；缺省 = 只出玩家行）。 */
  findByNickname?: MarkerSenderLookup
  /** 车型名表查询（tank_cache；占位名纪律与事件流同一套，缺表缺档回落无车型行）。 */
  tankNameOf?: (tankId: number) => string | undefined
  getT: () => number
  invalidate: () => void
}

export interface MarkerRuntimeHandle {
  /** 会话装载：重建事件源 + 清活动体（startPlayback 编排调用）。 */
  buildSession: (data: MarkerData | null | undefined, mapKey: string | null | undefined) => void
  /** 回放时钟窗口状态重算（幂等）：tick（播放中）与 seekTo（任意跳转）共用。 */
  update: (t: number) => void
  /** 来源卡世界锚点（labelsRuntime.updateLabels 逐帧投影 → 覆盖层卡片，屏幕空间恒定大小）。 */
  labelSources: () => readonly MarkerLabelSource[]
  /** 开关（off = 清活动体；on = 立即按当前 T 重算窗口）。 */
  setEnabled: (on: boolean) => void
  clear: () => void
}

/** 来源卡数据源（世界锚点由 update/跟随维护；投影与 DOM 卡片在 labelsRuntime/覆盖层）。 */
export interface MarkerLabelSource {
  /** 稳定 key（来源卡 DOM 复用锚点元素）。 */
  key: string
  kind: 'ping' | 'help' | 'target' | 'sector'
  /** target 类卡的动作意图（覆盖层按 intent 取章文案；其余 kind 无 intent）。 */
  intent?: 'attack' | 'retreat'
  /** 标记本体当前透明度系数（末段淡出 + 闪烁；0 = 完全透明 → 卡不出）。 */
  fade: number
  /** 身份两行 = 标注来源（target 类 = 发起者；其余 = 标记下发者）。 */
  player: string
  tank: string
  /** target 类卡的目标车型（动作章文案参数；其余 kind 无）。 */
  target?: string
  x: number
  y: number
  z: number
}

interface MarkerVisual {
  event: MarkerSceneEvent
  objs: Array<Mesh>
  mats: Material[]
  baseOpacities: number[]
  /** 当前淡出系数（update 维护；0 = 已完全透明——来源卡随之消失）。 */
  fade: number
  /** 来源卡（null = 不出卡：来源描述不到且 sender 空）。 */
  card: MarkerSourceCard | null
  /** 来源卡世界锚点（target 逐帧跟随更新）。 */
  anchor: { x: number; y: number; z: number }
  /** target 光环：逐帧跟随的车辆 eid 与贴地几何。 */
  eid?: number
  ring?: Mesh
}

/** 扇区地面细分矩形（grid×grid 采样地形高度 + 抬升，起伏地形上平面矩形会被坡地埋掉）。 */
export function createMarkerRuntime(deps: MarkerRuntimeDeps): MarkerRuntimeHandle {
  const poseTmp = new THREE.Vector3()
  let events: MarkerSceneEvent[] = []
  let enabled = true
  /** key = 事件对象引用（events 数组会话期内稳定），value = 已落场景的活动体。 */
  const active = new Map<MarkerSceneEvent, MarkerVisual>()

  function disposeVisual(v: MarkerVisual): void {
    const scene = deps.getScene()
    for (const o of v.objs) {
      scene.remove(o)
      if (o instanceof THREE.Mesh) (o.geometry as BufferGeometry | undefined)?.dispose()
      const mat = (o as Mesh).material as Material | undefined
      if (mat) mat.dispose()
    }
  }

  function clear(): void {
    for (const v of active.values()) disposeVisual(v)
    active.clear()
    events = []
  }

  /** 场景系贴地环：构造走 bases.makeGroundedRing（与基地/出生点同一实现，不复制第二份）。 */
  function makeRing(color: number | string, cx: number, cz: number, radius: number, seg: number): Mesh {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: RING_OPACITY,
      depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
    return new THREE.Mesh(makeGroundedRing(deps.groundY, cx, cz, radius, seg), mat)
  }

  /**
   * 来源卡解析（卡语义随标记种类）：
   * - target（0x2e attack/ally_retreat + 0x2f attack_enemy）：身份两行 = **发起者**，
   *   `target` = 目标车型 —— 卡读作「{发起者} 要求攻击/撤退 {目标车型}」；目标自己的
   *   玩家/坦克由车辆名牌负责，不在这里重复。发起者联不到（0x2e 缺 def / 0x2f sender
   *   不在名册）→ 只出动作章（目标车型仍在），动作章都缺才不出卡；
   * - ping / help：卡 = 发起者身份（0x2e 联 srcEid/srcAccount；0x2f 联 sender def）；
   * - sector：卡 = 发起者（sender 昵称联册，联不到只出玩家行；sender 也空 → null）。
   */
  function resolveCard(ev: MarkerSceneEvent): MarkerSourceCard | null {
    if (ev.kind === 'target') {
      // 0x2f 的 sender 只有昵称：先按昵称兜底（与 sector 同一纪律），再尝试 eid/account 域
      const sourceDef = deps.describeSource(ev.srcEid, ev.srcAccount, ev.t)
        ?? (ev.srcName ? { eid: 0, account_id: 0, nickname: ev.srcName } : null)
      const source = markerSourceCard(sourceDef, deps.tankNameOf)
      const target = markerSourceCard(deps.describeSource(ev.eid, ev.eid, ev.t), deps.tankNameOf)
      if (!source && !target) return null
      const targetName = target ? (target.tank || target.player) : ''
      return { player: source?.player ?? '', tank: source?.tank ?? '', ...(targetName ? { target: targetName } : {}) }
    }
    if (ev.kind === 'sector') {
      if (!ev.source) return null
      const def = deps.findByNickname?.(ev.source, ev.t ?? Number.NEGATIVE_INFINITY) ?? null
      return markerSourceCard(def ?? { nickname: ev.source }, deps.tankNameOf)
    }
    return markerSourceCard(deps.describeSource(ev.srcEid, ev.srcAccount, ev.t), deps.tankNameOf)
  }

  function spawn(ev: MarkerSceneEvent): void {
    const colors = { ally: PLAYBACK_ROLES.friendly.tracer, objective: PLAYBACK_ROLES.objective.base }
    const objs: Mesh[] = []
    const mats: Material[] = []
    const baseOpacities: number[] = []
    const visual: MarkerVisual = { event: ev, objs, mats, baseOpacities, fade: 1, card: resolveCard(ev), anchor: { x: 0, y: 0, z: 0 } }
    if (ev.kind === 'ping') {
      const gy = deps.groundY(ev.x, ev.z)
      const ring = makeRing(colors.ally, ev.x, ev.z, PING_RADIUS, 72)
      const beamMat = new THREE.MeshBasicMaterial({ color: colors.ally, side: THREE.DoubleSide, transparent: true,
        opacity: PING_BEAM_OPACITY, depthWrite: false, toneMapped: false })
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(PING_BEAM_R, PING_BEAM_R, PING_BEAM_H, 10, 1, true), beamMat)
      beam.position.set(ev.x, gy + PING_BEAM_H / 2, ev.z)
      objs.push(ring, beam); mats.push(ring.material as Material, beamMat); baseOpacities.push(RING_OPACITY, PING_BEAM_OPACITY)
      visual.anchor = { x: ev.x, y: gy + PING_BEAM_H + PING_LABEL_LIFT, z: ev.z }
    } else if (ev.kind === 'help') {
      // 自机位置 ping（payload 0；位置 = sender 车辆**发令时刻**位姿，静态——
      // 不用当前帧可见性替代历史在场判断：播放/跳转/倒带必须画出同一位置，评审 P2）
      const poseAt = deps.getPoseAt ?? deps.getVehiclePose
      if (!poseAt(ev.eid, ev.t, poseTmp)) return
      const gy = deps.groundY(poseTmp.x, poseTmp.z)
      const ring = makeRing(colors.objective, poseTmp.x, poseTmp.z, PING_RADIUS, 72)
      const beamMat = new THREE.MeshBasicMaterial({ color: colors.objective, side: THREE.DoubleSide, transparent: true,
        opacity: PING_BEAM_OPACITY, depthWrite: false, toneMapped: false })
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(PING_BEAM_R, PING_BEAM_R, PING_BEAM_H, 10, 1, true), beamMat)
      beam.position.set(poseTmp.x, gy + PING_BEAM_H / 2, poseTmp.z)
      objs.push(ring, beam); mats.push(ring.material as Material, beamMat); baseOpacities.push(RING_OPACITY, PING_BEAM_OPACITY)
      visual.anchor = { x: poseTmp.x, y: gy + PING_BEAM_H + PING_LABEL_LIFT, z: poseTmp.z }
    } else if (ev.kind === 'target') {
      // 目标查不到可见位姿：不画，不猜（窗口内位姿恢复时下轮 update 会再试）
      if (!deps.getVehiclePose(ev.eid, deps.getT(), poseTmp)) return
      // 攻击 / 撤退都是**己方**下发的指令：统一用友军亮绿（与 moving_here ping 同色相）
      const ring = makeRing(colors.ally, poseTmp.x, poseTmp.z, TARGET_RADIUS, TARGET_SEG)
      objs.push(ring); mats.push(ring.material as Material); baseOpacities.push(RING_OPACITY)
      visual.eid = ev.eid
      visual.ring = ring
      visual.anchor = { x: poseTmp.x, y: deps.groundY(poseTmp.x, poseTmp.z) + TARGET_LABEL_LIFT, z: poseTmp.z }
    } else {
      const cx = (ev.rect.xMin + ev.rect.xMax) / 2, cz = (ev.rect.zMin + ev.rect.zMax) / 2
      const fillMat = new THREE.MeshBasicMaterial({ color: colors.objective, side: THREE.DoubleSide, transparent: true,
        opacity: SECTOR_FILL_OPACITY, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      const fill = new THREE.Mesh(sectorQuadGeometry(deps.groundY, ev.rect), fillMat)
      const borderMat = new THREE.MeshBasicMaterial({ color: colors.objective, side: THREE.DoubleSide, transparent: true,
        opacity: SECTOR_BORDER_OPACITY, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      const border = new THREE.Mesh(sectorBorderGeometry(deps.groundY, ev.rect), borderMat)
      objs.push(fill, border); mats.push(fillMat, borderMat); baseOpacities.push(SECTOR_FILL_OPACITY, SECTOR_BORDER_OPACITY)
      visual.anchor = { x: cx, y: deps.groundY(cx, cz) + SECTOR_LABEL_LIFT, z: cz }
    }
    const scene = deps.getScene()
    for (const o of objs) scene.add(o)
    active.set(ev, visual)
    deps.invalidate()
  }

  /** 窗口内事件（含池上限：保最新的 MAX_ACTIVE 条）。 */
  function windowEvents(t: number): MarkerSceneEvent[] {
    const inWindow = events.filter((ev) => ev.t <= t && t <= ev.t + MARKER_LIFETIME_S)
    return inWindow.length > MARKER_MAX_ACTIVE ? inWindow.slice(inWindow.length - MARKER_MAX_ACTIVE) : inWindow
  }

  function update(t: number): void {
    if (!events.length && !active.size) return
    const wanted = enabled ? windowEvents(t) : []
    // diff：出窗的移除；新入窗的落场景。key = 事件引用（会话期内稳定）。
    const wantedSet = new Set(wanted)
    for (const [ev, v] of active) {
      if (!wantedSet.has(ev)) {
        disposeVisual(v)
        active.delete(ev)
        deps.invalidate()
      }
    }
    for (const ev of wanted) {
      if (!active.has(ev)) spawn(ev)
    }
    // 已在窗活动体的逐帧维护：目标光环跟随 + 扇区出现闪烁 + 末段淡出（暂停时 T 冻结 ⇒ 状态冻结）
    for (const v of active.values()) {
      const ev = v.event
      if (ev.kind === 'target' && v.ring && v.eid != null) {
        if (deps.getVehiclePose(v.eid, deps.getT(), poseTmp)) {
          v.ring.visible = true
          v.anchor.x = poseTmp.x; v.anchor.z = poseTmp.z
          v.anchor.y = deps.groundY(poseTmp.x, poseTmp.z) + TARGET_LABEL_LIFT
          regroundRingInPlace(v.ring.geometry, deps.groundY, poseTmp.x, poseTmp.z, TARGET_RADIUS, TARGET_SEG)
        } else {
          v.ring.visible = false
        }
      }
      const remain = ev.t + MARKER_LIFETIME_S - t
      let f = Math.max(0, Math.min(1, remain / MARKER_FADE_S))
      if (ev.kind === 'sector' && t - ev.t < MARKER_FLASH_S) {
        // 出现闪烁（确定性回放时钟相位）：谷值 SECTOR_FLASH_MIN，峰值为常亮 1
        const phase = Math.max(0, t - ev.t)
        f *= SECTOR_FLASH_MIN + (1 - SECTOR_FLASH_MIN) * Math.abs(Math.sin((phase / MARKER_FLASH_PERIOD_S) * Math.PI))
      } else if (ev.kind === 'target' && t - ev.t < TARGET_FLASH_S) {
        // 攻击/撤退目标环的出现闪烁：谷值 TARGET_FLASH_MIN（比扇区更深的暗段 → 更醒目），
        // 峰值 1；相位只由回放时钟决定，暂停冻结、倒带重播同一闪法。
        const phase = Math.max(0, t - ev.t)
        f *= TARGET_FLASH_MIN + (1 - TARGET_FLASH_MIN) * Math.abs(Math.sin((phase / TARGET_FLASH_PERIOD_S) * Math.PI))
      }
      // 闪烁系数并入 v.fade：DOM 来源卡经 labelSources().fade 与环/光柱同步闪（评审 P3——
      // 提交说明承诺“来源卡随目标环同步闪烁”；此前只闪材质、v.fade 恒 1）
      v.fade = f
      for (let k = 0; k < v.mats.length; k++) {
        const mat = v.mats[k] as THREE.MeshBasicMaterial
        const target = v.baseOpacities[k] * f
        if (mat.opacity !== target) mat.opacity = target
      }
    }
  }

  function labelSources(): readonly MarkerLabelSource[] {
    const out: MarkerLabelSource[] = []
    for (const v of active.values()) {
      if (!v.card) continue
      // 目标位姿暂隐（ring.visible=false）时卡与环同显隐——不外推（评审 P2 的卡层对应）
      if (v.event.kind === 'target' && v.ring && v.ring.visible === false) continue
      // 末段淡出到完全透明：标记本体已不可见，卡随之消失（评审 P2——卡不继承淡出）
      if (v.fade === 0) continue
      // fade 系数随卡下发（0 < fade < 1 时卡同步渐进透明，不在端点瞬间消失——复核 P2）
      out.push({ key: v.event.id, kind: v.event.kind, intent: v.event.kind === 'target' ? v.event.intent : undefined,
        fade: v.fade, player: v.card.player, tank: v.card.tank, target: v.card.target, ...v.anchor })
    }
    return out
  }

  /**
   * 0x2f 指令 → 场景事件（仅 §2.3 已闭合位置/目标语义的子集；联册失败逐条丢弃）：
   * - attack_enemy（payload = 目标 accountId，eid/account 两域）：联到名册 → target 环；
   * - help_me / help_me_ex / follow_me / support_me_with_fire（payload 0，自机位置）：
   *   sender 联到名册 → help（sender 车辆位置 ping）。
   */
  function buildCommandEvents(chat: readonly Partial<AgentChatEvent>[] | null | undefined): MarkerSceneEvent[] {
    const out: MarkerSceneEvent[] = []
    for (const ev of chat || []) {
      const t = ev?.t
      if (typeof t !== 'number' || !Number.isFinite(t)) continue
      const name = ev.command_name
      const senderDef = ev.sender ? deps.findByNickname?.(ev.sender, t) ?? null : null
      if (name === 'attack_enemy') {
        const target = ev.target
        if (!isPositiveInt(target)) continue
        // eid/account 两域 + 指令时刻：账号兜底必须取该时刻的活动实体（AoI 重入/复活换 eid）
        const def = deps.describeSource(target, target, t)
        if (!def) continue   // 目标联不到名册：仅滚动流，不猜坐标
        // 发起者 = sender 昵称联册（卡的身份两行）；联不到仍出目标卡（动作章含目标车型）
        out.push({
          id: '', t, kind: 'target', intent: 'attack', eid: def.eid,
          srcEid: senderDef?.eid ?? 0, srcAccount: senderDef?.account_id ?? 0,
          srcName: (ev.sender || '').trim() || undefined,
        })
      } else if (name === 'help_me' || name === 'help_me_ex' || name === 'follow_me' || name === 'support_me_with_fire') {
        if (!senderDef) continue   // sender 联不到名册：仅滚动流
        out.push({ id: '', t, kind: 'help', eid: senderDef.eid, srcEid: senderDef.eid, srcAccount: senderDef.account_id })
      }
      // 其余指令无已闭合的位置/目标语义：不落 3D。
    }
    return out
  }

  return {
    buildSession(data, mapKey) {
      clear()
      events = [...buildMarkerEvents(data, mapKey), ...buildCommandEvents(data?.chat_events)]
      events.sort((a, b) => a.t - b.t)
      for (let i = 0; i < events.length; i++) events[i] = { ...events[i], id: `${i}` } as MarkerSceneEvent
    },
    update,
    labelSources,
    setEnabled(on) {
      enabled = !!on
      if (!enabled) {
        for (const v of active.values()) disposeVisual(v)
        active.clear()
        deps.invalidate()
      } else {
        update(deps.getT())
      }
    },
    clear,
  }
}
