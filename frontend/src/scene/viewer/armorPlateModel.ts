// 装甲模型的共享语义（装甲查看器与 3D 回放 Sniper 着色共用，自 tankViewer 闭包搬出）：
// 板厚解析、板/外部模块分类、配置可见性、枢轴装配、弹道参数与穿透场景构建。
// 本模块不持有状态：tankData/config/材质都由调用方传入，两个场景各有自己的实例。
import * as THREE from 'three'
import type { Mesh, Object3D, Vector3 } from 'three'
import { SHELL_TOKEN_KIND } from '../penetration.js'

/** tank/{id}.json 顶级装甲摘要中本模块消费的字段（数据面由 assetProvider 提供）。 */
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

/** tank/{id}.json configs[] 条目中本模块消费的字段（当前选中配置）。 */
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
  // BlitzKit resolveArmor 语义：thickness = armor.thickness[index] ?? 0。
  // 炮塔有两套（stock/top）：唯一权威来源是当前 config 的逐炮塔
  // tank/{id}.json configs[].turret_plates（models.pb 逐炮塔透出）；
  // 缺失即 0mm fail-closed，不回退到顶级炮塔摘要 armor_model。
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
    // 炮管外部模块厚度：当前 config 的 gun_thickness 是唯一权威来源（models.pb
    // 按主炮透出）；armor_model 的 'gun' 是顶级炮塔摘要，不再作为回退。
    return cfg?.gun_thickness ?? 0
  }
  return 0
}

export function isRealArmorThickness(t: unknown): boolean {
  // BlitzKit resolveArmor：缺失/0 厚度按 0mm 渲染（thickness[index] ?? 0），
  // 仅 null（两份数据源都缺失）才视为 deco 跳过
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

/** 逐面法线：热力图着色法线必须与点击判定 raycast 的 hit.face.normal 同源。 */
export function useFaceNormals(model: Object3D): void {
  model.traverse(function(node) {
    const n = node as Mesh
    if (n.isMesh && n.geometry) {
      // 逐面法线（非索引化 + 逐面重算）：热力图着色的法线必须与点击判定
      // 的 raycast 面法线同源——hit.face.normal 是几何面法线，若保留 GLB
      // 平滑法线，曲面/棱线处热力图入射角会偏离判定入射角（实测 T110E5
      // p90 差 6°，约 11% 表面击穿概率结论相反）。代价是逐面块状着色。
      if (n.geometry.index) n.geometry = n.geometry.toNonIndexed()
      n.geometry.computeVertexNormals()
    }
  })
}

/** 模块是否双面：履带上表面绕序朝内，FrontSide 下会被剔除成空洞。 */
function moduleDoubleSided(node: Mesh): boolean {
  const mat = Array.isArray(node.material) ? node.material[0] : node.material
  return !!mat && mat.side === THREE.DoubleSide
}

/** 给视觉模型的履带/炮管打外部模块标记，返回模块网格列表。 */
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
      // BlitzKit 口径：有 mask 的炮把 gun_0X* 全部网格并入外部模块（含
      // gun_XX_mask_nc 等辅助件），由裁切面统一裁掉炮根；active 配置无
      // mask 时这些辅助件在 collectPenetrationMeshes/applyCategoryFilters
      // 被过滤，只保留精确 gun_0X（与 `mask ? startsWith : ===` 一致）。
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

/** 装甲模型里的炮/炮塔前缀（按编号升序；与 configs[].gun_index/turret_index 同序）。 */
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
  // cfg.gun_index 缺失时与旧 JS 同语义：NaN 下标取不到前缀 → activeGun null → 全部可见
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

/** models.pb 权威原点链：hull / turret / gun 枢轴（模型系）；数据缺失返回 null。 */
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
    // 正则容忍动态装甲的 state_XX 段（turret_01_state_01_armor_12 等）——
    // 否则可控板装不上枢轴：位置错、不随炮塔旋转
    if (/^turret_\d+(?:_state_\d+)?_armor/.test(nm)) installPivot(node, pivots.turret)
    else if (/^gun_\d+(?:_state_\d+)?_armor/.test(nm)) installPivot(node, pivots.gun)
    else if (/^hull(?:_state_\d+)?_armor/.test(nm)) installPivot(node, pivots.hull)
  })
}

/** BlitzKit 真值语义：mask=0 视同无 mask（SpacedArmorScene `gunModelDefinition.mask ?`）。 */
export function hasGunMask(cfg: TankArmorConfig | null | undefined): boolean {
  return !!cfg && typeof cfg.gun_mask === 'number' && cfg.gun_mask !== 0
}

/** gun_mask 裁切面在模型前向 +Y 上的位置（模型系）；无 mask 或原点缺失返回 null。 */
export function gunMaskOriginModel(tankData: TankArmorData | null | undefined, cfg: TankArmorConfig | null | undefined): number | null {
  const mo = tankData && tankData.model_origins
  if (!cfg || !mo || !mo.track || !mo.turret || !cfg.gun_origin || !hasGunMask(cfg) || cfg.gun_mask == null) return null
  return cfg.gun_mask + mo.track[1] + mo.turret[1] + cfg.gun_origin[1]
}

/** 主装甲/间隙甲分组（动态装甲非激活板构建进场景但 clone 初始隐藏，切态零重建）。 */
export function partitionArmorMeshes(model: Object3D): { primary: Mesh[]; spaced: Mesh[] } {
  const primary: Mesh[] = [], spaced: Mesh[] = []
  model.traverse(function(node) {
    const n = node as Mesh
    if (!n.isMesh) return
    if (n.userData.configHidden) return
    // 动态装甲可控板（含非激活态）：构建进热力图场景但 clone 初始隐藏——
    // 切态只翻 clone 可见性，零材质/着色器重建（消除切态闪烁）；
    // 点击/跳弹的源网格口径不受影响（deco + visible=false 照旧排除）
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
    // BlitzKit 选择规则（models.pb mask 注释同义）：mask 有值 → gun_0X* 全部
    // 网格都渲染并一起裁切；mask 无值 → 只渲染精确 gun_0X（辅助件不参与）。
    if (node.userData.gunMaskPart && !hasMask) return
    out.push(node)
  })
  return out
}

/** 弹种归类：type_id（field9 枚举，0=AP/1=APCR/2=HEAT/3=HE）优先，缺 id 才回退 icon 串词表。
 *  未知弹种 fail-closed 返回 null，不交给穿透判定的「未知 → HE」兜底。
 *  词表与判定链共用 `penetration.js` 的 `SHELL_TOKEN_KIND`（未知 token 的默认值差异是
 *  两条链的契约：判定链兜底 'he'、查看器 fail-closed null）。 */
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

/** 校准弹穿深系数；未知弹种没有可用口径，不猜 1.07。 */
export function calibratedPenMul(shellType: ShellKind | null | undefined): number {
  if (!shellType) return 1.0
  return (shellType === 'ap' || shellType === 'apcr') ? 1.06 : 1.07
}

export const ENHANCED_ARMOR_THICK_MUL = 1.04

/** 炮弹角度参数（弧度）：BlitzKit degToRad(shell.normalization ?? 0)；爆炸弹不跳弹。 */
export function shellAngles(sh: { normalization?: number | null; ricochet?: number | null }, isExplosive: boolean): { norm: number; rico: number } {
  return {
    norm: (sh.normalization != null ? sh.normalization : 0) * Math.PI / 180,
    rico: (isExplosive ? 90 : (sh.ricochet != null ? sh.ricochet : 70)) * Math.PI / 180,
  }
}

/** 交战距离衰减（0x719740）：d≤100 或 HE 恒 near；d>100 非 HE 线性至 far，clamp≥0。 */
export function rolledPenetration(near: number, farRaw: number | null | undefined, distance: number, isHE: boolean): number {
  const far = (typeof farRaw === 'number' && farRaw > 0) ? farRaw : near
  if (isHE || distance <= 100.0) return near
  return Math.max(0, near + (far - near) * (distance - 100.0) / 400.0)
}

export { addClone, populateSpacedArmorScene, populateSpacedStateScene, populatePrimaryArmorScene } from './armorPenetrationScenes.js'
export type { SpacedArmorSceneMats } from './armorPenetrationScenes.js'
