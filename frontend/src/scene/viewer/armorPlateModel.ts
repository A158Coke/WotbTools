import * as THREE from 'three'
import type { Mesh, Object3D, Vector3 } from 'three'
import { SHELL_TOKEN_KIND } from '../penetration.js'

export interface TankArmorData {
  armor_model?: {
    hull?: { plates?: Record<string, number | null>; spaced?: readonly (string | number)[] | null }
    chassis?: { left_track?: number; right_track?: number }
    gun?: unknown
  } | null
  hull_spaced?: readonly (string | number)[] | null
  model_origins?: { track?: number[]; turret?: number[] } | null
  [key: string]: unknown
}

export interface TankArmorConfig {
  turret_plates?: Record<string, number | null>
  gun_plates?: Record<string, number | null>
  gun_thickness?: number | null
  turret_spaced?: readonly (string | number)[] | null
  gun_spaced?: readonly (string | number)[] | null
  gun_origin?: number[]
  gun_mask?: number | null
  gun_index?: number
  turret_index?: number
  [key: string]: unknown
}

const GUN_ARMOR_NAME = /^(gun_\d+)(?:_state_\d+)?_armor_/
const TURRET_ARMOR_NAME = /^(turret_\d+)(?:_state_\d+)?_armor_/

export function plateThickness(tankData: TankArmorData, cfg: TankArmorConfig | null | undefined, section: string, plateId: string | number): number {
  const am = tankData.armor_model || {}
  const id = String(plateId)
  if (section === 'hull') return am.hull?.plates?.[id] ?? 0
  if (section === 'turret') return cfg?.turret_plates?.[id] ?? 0
  if (section === 'gun') return cfg?.gun_plates?.[id] ?? 0
  if (section === 'chassis') {
    const ch = am.chassis
    if (!ch) return 0
    if (plateId === 'leftTrack') return ch.left_track ?? 0
    if (plateId === 'rightTrack') return ch.right_track ?? 0
  }
  if (section === 'gunBarrel') {
    return cfg?.gun_thickness ?? 0
  }
  return 0
}

export function isRealArmorThickness(t: unknown): boolean {
  return typeof t === 'number' && t >= 0
}

export function retagSpacedSections(root: Object3D, tankData: TankArmorData, cfg: TankArmorConfig | null | undefined): void {
  const am = tankData.armor_model || {}
  const hullSpaced = new Set((tankData.hull_spaced ?? am.hull?.spaced ?? []).map(String))
  const turretSpaced = new Set((cfg?.turret_spaced ?? []).map(String))
  const gunSpaced = new Set((cfg?.gun_spaced ?? []).map(String))
  root.traverse(function(node) {
    const n = node as Mesh
    if (!n.isMesh) return
    const section = n.userData.armorSectionOrig
    if (section !== 'hull' && section !== 'turret' && section !== 'gun') return
    const plateId = String(node.userData.armorPlateId)
    const spaced = (section === 'hull' && hullSpaced.has(plateId)) ||
                   (section === 'turret' && turretSpaced.has(plateId)) ||
                   (section === 'gun' && gunSpaced.has(plateId))
    n.userData.armorSection = spaced ? 'spaced' : (section === 'gun' ? 'turret' : section)
  })
}

export function tagArmorPlates(model: Object3D, thicknessOf: (section: string, plateId: string) => number | null): void {
  model.traverse(function(node) {
    const n = node as Mesh
    if (!n.isMesh) return
    const name = node.name || ''
    if (/state_01/.test(name)) {
      node.userData.armorSection = 'deco'
      n.userData.armorPlateId = ''
      n.userData.armorThickness = 0
      return
    }
    const m = name.match(/(hull|turret|gun)_\w*?_?armor_(\d+)/)
    if (m) {
      const section = m[1], plateId = m[2]
      const t = thicknessOf(section, plateId)
      if (!isRealArmorThickness(t)) {
        n.userData.armorSection = 'deco'
        n.userData.armorPlateId = plateId
        n.userData.armorThickness = 0
        return
      }
      n.userData.armorSectionOrig = section
      n.userData.armorPlateId = plateId
      n.userData.armorThickness = t
      n.userData.armorSection = section
    }
  })
}

export function useFaceNormals(model: Object3D): void {
  model.traverse(function(node) {
    const n = node as Mesh
    if (n.isMesh && n.geometry) {
      if (n.geometry.index) n.geometry = n.geometry.toNonIndexed()
      n.geometry.computeVertexNormals()
    }
  })
}

function moduleDoubleSided(node: Mesh): boolean {
  const mat = Array.isArray(node.material) ? node.material[0] : node.material
  return !!mat && mat.side === THREE.DoubleSide
}

export function tagModuleMeshes(model: Object3D, thicknessOf: (section: string, plateId: string) => number | null): Mesh[] {
  const moduleMeshes: Mesh[] = []
  model.traverse(function(node) {
    const n = node as Mesh
    if (!n.isMesh) return
    const parent = n.parent
    const parentName = parent ? (parent.name || '') : ''
    let trackNode: string | null = null
    for (let p: Object3D | null = n; p; p = p.parent) {
      const nm = p.name || ''
      if (/^chassis_track_/.test(nm) || /^chassis_wheel_/.test(nm)) { trackNode = nm; break }
    }
    if (trackNode) {
      const isRight = /(^|_)R(_|$)/.test(trackNode)
      n.userData.armorSection = 'chassis'
      n.userData.armorPlateId = isRight ? 'rightTrack' : 'leftTrack'
      n.userData.armorThickness = thicknessOf('chassis', n.userData.armorPlateId)
      n.userData.moduleDoubleSided = moduleDoubleSided(n)
      moduleMeshes.push(n)
    } else if (/^gun_\d+$/.test(parentName)) {
      n.userData.armorSection = 'gunBarrel'
      n.userData.armorPlateId = 'gun'
      n.userData.armorThickness = thicknessOf('gunBarrel', 'gun')
      n.userData.gunMaskPart = false
      n.userData.moduleDoubleSided = moduleDoubleSided(n)
      const gm = parentName.match(/^gun_(\d+)/)
      n.userData.gunConfig = gm ? parseInt(gm[1], 10) : null
      moduleMeshes.push(n)
    } else if (/^gun_\d+_mask$/.test(parentName)) {
      n.userData.armorSection = 'gunBarrel'
      n.userData.armorPlateId = 'gun'
      n.userData.armorThickness = thicknessOf('gunBarrel', 'gun')
      n.userData.gunMaskPart = true
      n.userData.moduleDoubleSided = moduleDoubleSided(n)
      const gm = parentName.match(/^gun_(\d+)/)
      n.userData.gunConfig = gm ? parseInt(gm[1], 10) : null
      moduleMeshes.push(n)
    } else if (/^gun_\d+_/.test(parentName)) {
      n.userData.armorSection = 'gunBarrel'
      n.userData.armorPlateId = 'gun'
      n.userData.armorThickness = thicknessOf('gunBarrel', 'gun')
      n.userData.gunMaskPart = true
      n.userData.moduleDoubleSided = moduleDoubleSided(n)
      const gm = parentName.match(/^gun_(\d+)/)
      n.userData.gunConfig = gm ? parseInt(gm[1], 10) : null
      moduleMeshes.push(n)
    }
  })
  return moduleMeshes
}

export function collectArmorPrefixes(model: Object3D): { gun: string[]; turret: string[] } {
  const gunSet = new Set<string>(), turSet = new Set<string>()
  model.traverse(n => {
    const name = n.name || ''
    const gm = name.match(GUN_ARMOR_NAME)
    if (gm) gunSet.add(gm[1])
    const tm = name.match(TURRET_ARMOR_NAME)
    if (tm) turSet.add(tm[1])
  })
  const sortPk = (set: Set<string>): string[] => Array.from(set).sort((a, b) => (parseInt(a.match(/\d+/)?.[0] ?? '', 10) | 0) - (parseInt(b.match(/\d+/)?.[0] ?? '', 10) | 0))
  return { gun: sortPk(gunSet), turret: sortPk(turSet) }
}

export function applyArmorConfigVisible(model: Object3D, cfg: TankArmorConfig, prefixes: { gun: string[]; turret: string[] }): void {
  const gunPk = prefixes.gun, turPk = prefixes.turret
  const activeGun = gunPk.length ? gunPk[(cfg.gun_index as number) % gunPk.length] : null
  const activeTur = turPk.length ? turPk[(cfg.turret_index as number) % turPk.length] : null
  model.traverse(function(node) {
    const n = node as Mesh
    if (!n.isMesh) return
    const name = node.name || ''
    const gm = name.match(GUN_ARMOR_NAME)
    const tm = name.match(TURRET_ARMOR_NAME)
    if (gm) {
      const visible = activeGun ? gm[1] === activeGun : true
      n.visible = visible
      n.userData.configHidden = !visible
      if (visible) n.userData.armorSection = n.userData.armorSection || 'gun'
    } else if (tm) {
      const visible = activeTur ? tm[1] === activeTur : true
      n.visible = visible
      n.userData.configHidden = !visible
      if (visible) n.userData.armorSection = n.userData.armorSection || 'turret'
    }
  })
}

export function armorPivots(tankData: TankArmorData | null | undefined, cfg: TankArmorConfig | null | undefined): { hull: Vector3; turret: Vector3; gun: Vector3 } | null {
  const mo = tankData && tankData.model_origins
  if (!(mo && mo.track && mo.turret)) return null
  const hull = new THREE.Vector3(mo.track[0], mo.track[1], mo.track[2])
  const turret = hull.clone().add(new THREE.Vector3(mo.turret[0], mo.turret[1], mo.turret[2]))
  const gun = (cfg && cfg.gun_origin)
    ? turret.clone().add(new THREE.Vector3(cfg.gun_origin[0], cfg.gun_origin[1], cfg.gun_origin[2]))
    : turret.clone()
  return { hull, turret, gun }
}

export function installArmorPivots(model: Object3D, pivots: { hull: Vector3; turret: Vector3; gun: Vector3 }): void {
  const installPivot = (mesh: Mesh, pivot: Vector3): void => {
    if (!mesh.userData.origPos) mesh.userData.origPos = mesh.position.clone()
    mesh.position.copy(mesh.userData.origPos).add(pivot)
    mesh.updateMatrix()
  }
  model.traverse(n => {
    const node = n as Mesh
    if (!node.isMesh) return
    const nm = node.name || ''
    if (/^turret_\d+(?:_state_\d+)?_armor/.test(nm)) installPivot(node, pivots.turret)
    else if (/^gun_\d+(?:_state_\d+)?_armor/.test(nm)) installPivot(node, pivots.gun)
    else if (/^hull(?:_state_\d+)?_armor/.test(nm)) installPivot(node, pivots.hull)
  })
}

export function hasGunMask(cfg: TankArmorConfig | null | undefined): boolean {
  return !!cfg && typeof cfg.gun_mask === 'number' && cfg.gun_mask !== 0
}

export function gunMaskOriginModel(tankData: TankArmorData | null | undefined, cfg: TankArmorConfig | null | undefined): number | null {
  const mo = tankData && tankData.model_origins
  if (!cfg || !mo || !mo.track || !mo.turret || !cfg.gun_origin || !hasGunMask(cfg) || cfg.gun_mask == null) return null
  return cfg.gun_mask + mo.track[1] + mo.turret[1] + cfg.gun_origin[1]
}

export function partitionArmorMeshes(model: Object3D): { primary: Mesh[]; spaced: Mesh[] } {
  const primary: Mesh[] = [], spaced: Mesh[] = []
  model.traverse(function(node) {
    const n = node as Mesh
    if (!n.isMesh) return
    if (n.userData.configHidden) return
    if (n.userData.armorStateHidden === true) {
      const sec2 = n.userData.armorStateSection || 'hull'
      ;(sec2 === 'spaced' ? spaced : primary).push(n)
      return
    }
    if (n.visible === false) return
    const sec = n.userData.armorSection
    if (sec === 'deco') return
    if (sec === 'spaced') spaced.push(n)
    else primary.push(n)
  })
  return { primary, spaced }
}

export function selectExternalMeshes(moduleMeshes: readonly Mesh[], activeGun: number | null | undefined, cfg: TankArmorConfig | null | undefined): Mesh[] {
  const hasMask = hasGunMask(cfg)
  const out: Mesh[] = []
  moduleMeshes.forEach(function(node) {
    if (!node.isMesh) return
    if (node.visible === false) return
    if (node.userData.gunConfig != null && activeGun != null && node.userData.gunConfig !== activeGun) return
    if (node.userData.gunMaskPart && !hasMask) return
    out.push(node)
  })
  return out
}

export type ShellKind = 'ap' | 'apcr' | 'heat' | 'he'

export function shellTypeOf(sh: { type_id?: unknown; type?: unknown } | null | undefined): ShellKind | null {
  const id = sh && sh.type_id
  if (typeof id === 'number') {
    if (id === 0) return 'ap'
    if (id === 1) return 'apcr'
    if (id === 2) return 'heat'
    if (id === 3) return 'he'
  }
  const t = (((sh && sh.type) as string | null | undefined) || '').toLowerCase()
  return (SHELL_TOKEN_KIND as Record<string, ShellKind>)[t] || null
}

export function calibratedPenMul(shellType: ShellKind | null | undefined): number {
  if (!shellType) return 1.0
  return (shellType === 'ap' || shellType === 'apcr') ? 1.06 : 1.07
}

export const ENHANCED_ARMOR_THICK_MUL = 1.04

export function shellAngles(sh: { normalization?: number | null; ricochet?: number | null }, isExplosive: boolean): { norm: number; rico: number } {
  return {
    norm: (sh.normalization != null ? sh.normalization : 0) * Math.PI / 180,
    rico: (isExplosive ? 90 : (sh.ricochet != null ? sh.ricochet : 70)) * Math.PI / 180,
  }
}

export function rolledPenetration(near: number, farRaw: number | null | undefined, distance: number, isHE: boolean): number {
  const far = (typeof farRaw === 'number' && farRaw > 0) ? farRaw : near
  if (isHE || distance <= 100.0) return near
  return Math.max(0, near + (far - near) * (distance - 100.0) / 400.0)
}

export { addClone, populateSpacedArmorScene, populateSpacedStateScene, populatePrimaryArmorScene } from './armorPenetrationScenes.js'
export type { SpacedArmorSceneMats } from './armorPenetrationScenes.js'
