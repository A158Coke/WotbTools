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
export const MARKER_FADE_S = 2
export const MARKER_FLASH_S = 1.6
export const MARKER_FLASH_PERIOD_S = 0.4
export const TARGET_FLASH_S = 2.4
export const TARGET_FLASH_PERIOD_S = 0.5
export const TARGET_FLASH_MIN = 0.2
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
const SECTOR_FLASH_MIN = 0.45
const PING_LABEL_LIFT = 2.5


export type MarkerSceneEvent =
  | { id: string; t: number; kind: 'ping'; x: number; z: number; srcEid: number; srcAccount: number }
  | { id: string; t: number; kind: 'help'; eid: number; srcEid: number; srcAccount: number }
  | { id: string; t: number; kind: 'target'; intent: 'attack' | 'retreat'; eid: number; srcEid: number; srcAccount: number; srcName?: string }
  | { id: string; t: number; kind: 'sector'; region: number; rect: MarkerSectorRect; source: string }

export interface MarkerData {
  markers?: Array<Partial<AgentBattleMarkerEvent>> | null
  chat_events?: Array<Partial<AgentChatEvent>> | null
}

const isFiniteTriple = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0

function attentionRegionOf(ev: Partial<AgentChatEvent> | null | undefined): number | null {
  if (!ev || ev.kind !== 'command' || ev.command_name !== 'attention_to_cell') return null
  const target = ev.target
  return typeof target === 'number' && Number.isInteger(target) && target >= 1 && target <= 9 ? target : null
}

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
  for (let i = 0; i < events.length; i++) events[i] = { ...events[i], id: `${i}` } as MarkerSceneEvent
  return events
}

export type VehiclePoseLookup = (eid: number, t: number, out: Vector3) => boolean

export interface MarkerSourceDef {
  eid: number
  account_id: number
  nickname?: string | null
  tank_name?: string | null
  tank_id?: number | null
}
export type MarkerSourceLookup = (eid: number, accountId: number, t?: number) => MarkerSourceDef | null

export type MarkerSenderLookup = (nickname: string, t?: number) => MarkerSourceDef | null

export interface MarkerRuntimeDeps {
  getScene: () => Scene
  groundY: (x: number, z: number) => number
  getVehiclePose: VehiclePoseLookup
  getPoseAt?: VehiclePoseLookup
  describeSource: MarkerSourceLookup
  findByNickname?: MarkerSenderLookup
  tankNameOf?: (tankId: number) => string | undefined
  getT: () => number
  invalidate: () => void
}

export interface MarkerRuntimeHandle {
  buildSession: (data: MarkerData | null | undefined, mapKey: string | null | undefined) => void
  update: (t: number) => void
  labelSources: () => readonly MarkerLabelSource[]
  setEnabled: (on: boolean) => void
  clear: () => void
}

export interface MarkerLabelSource {
  key: string
  kind: 'ping' | 'help' | 'target' | 'sector'
  intent?: 'attack' | 'retreat'
  fade: number
  player: string
  tank: string
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
  fade: number
  card: MarkerSourceCard | null
  anchor: { x: number; y: number; z: number }
  eid?: number
  ring?: Mesh
}

export function createMarkerRuntime(deps: MarkerRuntimeDeps): MarkerRuntimeHandle {
  const poseTmp = new THREE.Vector3()
  let events: MarkerSceneEvent[] = []
  let enabled = true
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

  function makeRing(color: number | string, cx: number, cz: number, radius: number, seg: number): Mesh {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: RING_OPACITY,
      depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
    return new THREE.Mesh(makeGroundedRing(deps.groundY, cx, cz, radius, seg), mat)
  }

  function resolveCard(ev: MarkerSceneEvent): MarkerSourceCard | null {
    if (ev.kind === 'target') {
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
      if (!deps.getVehiclePose(ev.eid, deps.getT(), poseTmp)) return
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

  function windowEvents(t: number): MarkerSceneEvent[] {
    const inWindow = events.filter((ev) => ev.t <= t && t <= ev.t + MARKER_LIFETIME_S)
    return inWindow.length > MARKER_MAX_ACTIVE ? inWindow.slice(inWindow.length - MARKER_MAX_ACTIVE) : inWindow
  }

  function update(t: number): void {
    if (!events.length && !active.size) return
    const wanted = enabled ? windowEvents(t) : []
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
        const phase = Math.max(0, t - ev.t)
        f *= SECTOR_FLASH_MIN + (1 - SECTOR_FLASH_MIN) * Math.abs(Math.sin((phase / MARKER_FLASH_PERIOD_S) * Math.PI))
      } else if (ev.kind === 'target' && t - ev.t < TARGET_FLASH_S) {
        const phase = Math.max(0, t - ev.t)
        f *= TARGET_FLASH_MIN + (1 - TARGET_FLASH_MIN) * Math.abs(Math.sin((phase / TARGET_FLASH_PERIOD_S) * Math.PI))
      }
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
      if (v.event.kind === 'target' && v.ring && v.ring.visible === false) continue
      if (v.fade === 0) continue
      out.push({ key: v.event.id, kind: v.event.kind, intent: v.event.kind === 'target' ? v.event.intent : undefined,
        fade: v.fade, player: v.card.player, tank: v.card.tank, target: v.card.target, ...v.anchor })
    }
    return out
  }

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
        const def = deps.describeSource(target, target, t)
        if (!def) continue
        out.push({
          id: '', t, kind: 'target', intent: 'attack', eid: def.eid,
          srcEid: senderDef?.eid ?? 0, srcAccount: senderDef?.account_id ?? 0,
          srcName: (ev.sender || '').trim() || undefined,
        })
      } else if (name === 'help_me' || name === 'help_me_ex' || name === 'follow_me' || name === 'support_me_with_fire') {
        if (!senderDef) continue
        out.push({ id: '', t, kind: 'help', eid: senderDef.eid, srcEid: senderDef.eid, srcAccount: senderDef.account_id })
      }
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
