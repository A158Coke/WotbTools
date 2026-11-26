import * as THREE from 'three'
import type { Object3D } from 'three'

export interface GlbStaticData {
  configs?: Array<{ turret_index: number; gun_index: number; gun_origin?: number[] }> | null
  model_origins?: { track?: number[]; turret?: number[] } | null
  initial_turret_rotation?: { pitch?: number; roll?: number; yaw?: number } | null
}

export interface GlbVariantSelection {
  turret_index: number | null
  gun_index: number | null
}

export interface GlbParts {
  turretNode: Object3D | null
  gunNodes: Object3D[]
  tP: [number, number, number]
  gP: [number, number, number]
  hullGroup: THREE.Group | null
  poseT: THREE.Matrix4
  poseG: THREE.Matrix4
  itr: { pitch?: number; roll?: number; yaw?: number } | null
}

export function collectGlbParts(model: Object3D, sd: GlbStaticData | null, sel: GlbVariantSelection | null): GlbParts | null {
  const byGroup = new Map<number, Object3D[]>(); const turrets: Object3D[] = []
  model.traverse(n => {
    const nm = n.name || ''
    const gm = nm.match(/^gun_(\d+)/)
    const tm = nm.match(/^turret_(\d+)$/)
    if (gm) { const g = parseInt(gm[1], 10); if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g)!.push(n) }
    else if (tm) turrets.push(n)
  })
  const gunGroups = Array.from(byGroup.keys()).sort((a, b) => a - b)
    .map(k => byGroup.get(k)!.sort((a, b) => ((a.name || '') < (b.name || '') ? -1 : 1)))
  const turretNo = (n: Object3D) => parseInt(n.name.match(/\d+/)?.[0] ?? '', 10) || 0
  turrets.sort((a, b) => (turretNo(a) - turretNo(b)))
  const cfgs = (sd && sd.configs && sd.configs.length) ? sd.configs : null
  const gi = (sel && sel.gun_index != null) ? sel.gun_index
    : (cfgs ? cfgs[cfgs.length - 1].gun_index : 0)
  const ti = (sel && sel.turret_index != null) ? sel.turret_index
    : (cfgs ? cfgs[cfgs.length - 1].turret_index : 0)
  gunGroups.forEach((grp, i) => grp.forEach(n => n.visible = (i === (gi % gunGroups.length))))
  turrets.forEach((n, i) => n.visible = (i === (ti % turrets.length)))
  const turretNode = turrets.length ? turrets[ti % turrets.length] : null
  const grp = gunGroups.length ? gunGroups[gi % gunGroups.length] : []
  const barrelNodes = grp.filter(n => /^gun_\d+(_mask)?$/.test(n.name || ''))
  const gunNodes = barrelNodes.length ? barrelNodes : grp
  const mo = sd && sd.model_origins
  if (!mo || !mo.track || !mo.turret) {
    console.warn('[playback] glb parts incomplete: turret=' + !!turretNode + ' origins=' + !!(mo && mo.track))
    return null
  }
  if (!turretNode && !gunNodes.length) {
    console.warn('[playback] GLB 部位不全，保留代理车（无炮塔且无炮管组）')
    return null
  }
  const tP: [number, number, number] = [mo.track[0] + mo.turret[0], mo.track[1] + mo.turret[1], mo.track[2] + mo.turret[2]]
  const cfg = cfgs ? (cfgs.find(c => c.turret_index === ti && c.gun_index === gi) || cfgs[cfgs.length - 1]) : null
  const gP: [number, number, number] = (cfg && cfg.gun_origin)
    ? [tP[0] + cfg.gun_origin[0], tP[1] + cfg.gun_origin[1], tP[2] + cfg.gun_origin[2]]
    : [tP[0], tP[1], tP[2]]
  let hullGroup: THREE.Group | null = null
  const chassisNode = (() => {
    let hit: Object3D | null = null
    model.traverse((n) => {
      if (!hit && /^chassis_(track|wheel)_/i.test(n.name || '')) hit = n
    })
    return hit as Object3D | null
  })()
  const modelRoot = chassisNode && chassisNode.parent ? chassisNode.parent : null
  if (modelRoot) {
    hullGroup = new THREE.Group()
    hullGroup.name = '__hullGroup'
    for (const child of [...modelRoot.children]) {
      if (/^chassis_(track|wheel)_/i.test(child.name || '')) continue
      hullGroup.add(child)
    }
    modelRoot.add(hullGroup)
  }
  return { turretNode, gunNodes, tP, gP, hullGroup,
           poseT: new THREE.Matrix4(), poseG: new THREE.Matrix4(),
           itr: (sd && sd.initial_turret_rotation) || null }
}
