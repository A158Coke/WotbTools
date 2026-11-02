// 装甲模型的共享语义（装甲查看器与 3D 回放 Sniper 着色共用，自 tankViewer 闭包搬出）：
// 板厚解析、板/外部模块分类、配置可见性、枢轴装配、弹道参数与穿透场景构建。
// 本模块不持有状态：tankData/config/材质都由调用方传入，两个场景各有自己的实例。
import * as THREE from 'three'
import { isClosedSurfaceGeometry } from '../armorMeshTopology.js'

const GUN_ARMOR_NAME = /^(gun_\d+)(?:_state_\d+)?_armor_/
const TURRET_ARMOR_NAME = /^(turret_\d+)(?:_state_\d+)?_armor_/

export function plateThickness(tankData, cfg, section, plateId) {
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

export function isRealArmorThickness(t) {
  // BlitzKit resolveArmor：缺失/0 厚度按 0mm 渲染（thickness[index] ?? 0），
  // 仅 null（两份数据源都缺失）才视为 deco 跳过
  return typeof t === 'number' && t >= 0
}

export function retagSpacedSections(root, tankData, cfg) {
  const am = tankData.armor_model || {}
  const hullSpaced = new Set((tankData.hull_spaced ?? am.hull?.spaced ?? []).map(String))
  const turretSpaced = new Set((cfg?.turret_spaced ?? []).map(String))
  const gunSpaced = new Set((cfg?.gun_spaced ?? []).map(String))
  root.traverse(function(node) {
    if (!node.isMesh) return
    const section = node.userData.armorSectionOrig
    if (section !== 'hull' && section !== 'turret' && section !== 'gun') return
    const plateId = String(node.userData.armorPlateId)
    const spaced = (section === 'hull' && hullSpaced.has(plateId)) ||
                   (section === 'turret' && turretSpaced.has(plateId)) ||
                   (section === 'gun' && gunSpaced.has(plateId))
    node.userData.armorSection = spaced ? 'spaced' : (section === 'gun' ? 'turret' : section)
  })
}

export function tagArmorPlates(model, thicknessOf) {
  model.traverse(function(node) {
    if (!node.isMesh) return
    const name = node.name || ''
    if (/state_01/.test(name)) {
      node.userData.armorSection = 'deco'
      node.userData.armorPlateId = ''
      node.userData.armorThickness = 0
      return
    }
    const m = name.match(/(hull|turret|gun)_\w*?_?armor_(\d+)/)
    if (m) {
      const section = m[1], plateId = m[2]
      const t = thicknessOf(section, plateId)
      if (!isRealArmorThickness(t)) {
        node.userData.armorSection = 'deco'
        node.userData.armorPlateId = plateId
        node.userData.armorThickness = 0
        return
      }
      node.userData.armorSectionOrig = section
      node.userData.armorPlateId = plateId
      node.userData.armorThickness = t
      node.userData.armorSection = section
    }
  })
}

/** 逐面法线：热力图着色法线必须与点击判定 raycast 的 hit.face.normal 同源。 */
export function useFaceNormals(model) {
  model.traverse(function(node) {
    if (node.isMesh && node.geometry) {
      // 逐面法线（非索引化 + 逐面重算）：热力图着色的法线必须与点击判定
      // 的 raycast 面法线同源——hit.face.normal 是几何面法线，若保留 GLB
      // 平滑法线，曲面/棱线处热力图入射角会偏离判定入射角（实测 T110E5
      // p90 差 6°，约 11% 表面击穿概率结论相反）。代价是逐面块状着色。
      if (node.geometry.index) node.geometry = node.geometry.toNonIndexed()
      node.geometry.computeVertexNormals()
    }
  })
}

/** 模块是否双面：履带上表面绕序朝内，FrontSide 下会被剔除成空洞。 */
function moduleDoubleSided(node) {
  const mat = Array.isArray(node.material) ? node.material[0] : node.material
  return !!mat && mat.side === THREE.DoubleSide
}

/** 给视觉模型的履带/炮管打外部模块标记，返回模块网格列表。 */
export function tagModuleMeshes(model, thicknessOf) {
  const moduleMeshes = []
  model.traverse(function(node) {
    if (!node.isMesh) return
    const parent = node.parent
    const parentName = parent ? (parent.name || '') : ''
    let trackNode = null
    for (let p = node; p; p = p.parent) {
      const nm = p.name || ''
      if (/^chassis_track_/.test(nm) || /^chassis_wheel_/.test(nm)) { trackNode = nm; break }
    }
    if (trackNode) {
      const isRight = /(^|_)R(_|$)/.test(trackNode)
      node.userData.armorSection = 'chassis'
      node.userData.armorPlateId = isRight ? 'rightTrack' : 'leftTrack'
      node.userData.armorThickness = thicknessOf('chassis', node.userData.armorPlateId)
      node.userData.moduleDoubleSided = moduleDoubleSided(node)
      moduleMeshes.push(node)
    } else if (/^gun_\d+$/.test(parentName)) {
      node.userData.armorSection = 'gunBarrel'
      node.userData.armorPlateId = 'gun'
      node.userData.armorThickness = thicknessOf('gunBarrel', 'gun')
      node.userData.gunMaskPart = false
      node.userData.moduleDoubleSided = moduleDoubleSided(node)
      const gm = parentName.match(/^gun_(\d+)/)
      node.userData.gunConfig = gm ? parseInt(gm[1], 10) : null
      moduleMeshes.push(node)
    } else if (/^gun_\d+_mask$/.test(parentName)) {
      node.userData.armorSection = 'gunBarrel'
      node.userData.armorPlateId = 'gun'
      node.userData.armorThickness = thicknessOf('gunBarrel', 'gun')
      node.userData.gunMaskPart = true
      node.userData.moduleDoubleSided = moduleDoubleSided(node)
      const gm = parentName.match(/^gun_(\d+)/)
      node.userData.gunConfig = gm ? parseInt(gm[1], 10) : null
      moduleMeshes.push(node)
    } else if (/^gun_\d+_/.test(parentName)) {
      // BlitzKit 口径：有 mask 的炮把 gun_0X* 全部网格并入外部模块（含
      // gun_XX_mask_nc 等辅助件），由裁切面统一裁掉炮根；active 配置无
      // mask 时这些辅助件在 collectPenetrationMeshes/applyCategoryFilters
      // 被过滤，只保留精确 gun_0X（与 `mask ? startsWith : ===` 一致）。
      node.userData.armorSection = 'gunBarrel'
      node.userData.armorPlateId = 'gun'
      node.userData.armorThickness = thicknessOf('gunBarrel', 'gun')
      node.userData.gunMaskPart = true
      node.userData.moduleDoubleSided = moduleDoubleSided(node)
      const gm = parentName.match(/^gun_(\d+)/)
      node.userData.gunConfig = gm ? parseInt(gm[1], 10) : null
      moduleMeshes.push(node)
    }
  })
  return moduleMeshes
}

/** 装甲模型里的炮/炮塔前缀（按编号升序；与 configs[].gun_index/turret_index 同序）。 */
export function collectArmorPrefixes(model) {
  const gunSet = new Set(), turSet = new Set()
  model.traverse(n => {
    const name = n.name || ''
    const gm = name.match(GUN_ARMOR_NAME)
    if (gm) gunSet.add(gm[1])
    const tm = name.match(TURRET_ARMOR_NAME)
    if (tm) turSet.add(tm[1])
  })
  const sortPk = (set) => Array.from(set).sort((a, b) => (a.match(/\d+/)?.[0] | 0) - (b.match(/\d+/)?.[0] | 0))
  return { gun: sortPk(gunSet), turret: sortPk(turSet) }
}

export function applyArmorConfigVisible(model, cfg, prefixes) {
  const gunPk = prefixes.gun, turPk = prefixes.turret
  const activeGun = gunPk.length ? gunPk[cfg.gun_index % gunPk.length] : null
  const activeTur = turPk.length ? turPk[cfg.turret_index % turPk.length] : null
  model.traverse(function(node) {
    if (!node.isMesh) return
    const name = node.name || ''
    const gm = name.match(GUN_ARMOR_NAME)
    const tm = name.match(TURRET_ARMOR_NAME)
    if (gm) {
      const visible = activeGun ? gm[1] === activeGun : true
      node.visible = visible
      node.userData.configHidden = !visible
      if (visible) node.userData.armorSection = node.userData.armorSection || 'gun'
    } else if (tm) {
      const visible = activeTur ? tm[1] === activeTur : true
      node.visible = visible
      node.userData.configHidden = !visible
      if (visible) node.userData.armorSection = node.userData.armorSection || 'turret'
    }
  })
}

/** models.pb 权威原点链：hull / turret / gun 枢轴（模型系）；数据缺失返回 null。 */
export function armorPivots(tankData, cfg) {
  const mo = tankData && tankData.model_origins
  if (!(mo && mo.track && mo.turret)) return null
  const hull = new THREE.Vector3(mo.track[0], mo.track[1], mo.track[2])
  const turret = hull.clone().add(new THREE.Vector3(mo.turret[0], mo.turret[1], mo.turret[2]))
  const gun = (cfg && cfg.gun_origin)
    ? turret.clone().add(new THREE.Vector3(cfg.gun_origin[0], cfg.gun_origin[1], cfg.gun_origin[2]))
    : turret.clone()
  return { hull, turret, gun }
}

export function installArmorPivots(model, pivots) {
  const installPivot = (mesh, pivot) => {
    if (!mesh.userData.origPos) mesh.userData.origPos = mesh.position.clone()
    mesh.position.copy(mesh.userData.origPos).add(pivot)
    mesh.updateMatrix()
  }
  model.traverse(n => {
    if (!n.isMesh) return
    const nm = n.name || ''
    // 正则容忍动态装甲的 state_XX 段（turret_01_state_01_armor_12 等）——
    // 否则可控板装不上枢轴：位置错、不随炮塔旋转
    if (/^turret_\d+(?:_state_\d+)?_armor/.test(nm)) installPivot(n, pivots.turret)
    else if (/^gun_\d+(?:_state_\d+)?_armor/.test(nm)) installPivot(n, pivots.gun)
    else if (/^hull(?:_state_\d+)?_armor/.test(nm)) installPivot(n, pivots.hull)
  })
}

/** BlitzKit 真值语义：mask=0 视同无 mask（SpacedArmorScene `gunModelDefinition.mask ?`）。 */
export function hasGunMask(cfg) {
  return !!cfg && typeof cfg.gun_mask === 'number' && cfg.gun_mask !== 0
}

/** gun_mask 裁切面在模型前向 +Y 上的位置（模型系）；无 mask 或原点缺失返回 null。 */
export function gunMaskOriginModel(tankData, cfg) {
  const mo = tankData && tankData.model_origins
  if (!cfg || !mo || !mo.track || !mo.turret || !cfg.gun_origin || !hasGunMask(cfg)) return null
  return cfg.gun_mask + mo.track[1] + mo.turret[1] + cfg.gun_origin[1]
}

/** 主装甲/间隙甲分组（动态装甲非激活板构建进场景但 clone 初始隐藏，切态零重建）。 */
export function partitionArmorMeshes(model) {
  const primary = [], spaced = []
  model.traverse(function(node) {
    if (!node.isMesh) return
    if (node.userData.configHidden) return
    // 动态装甲可控板（含非激活态）：构建进热力图场景但 clone 初始隐藏——
    // 切态只翻 clone 可见性，零材质/着色器重建（消除切态闪烁）；
    // 点击/跳弹的源网格口径不受影响（deco + visible=false 照旧排除）
    if (node.userData.armorStateHidden === true) {
      const sec2 = node.userData.armorStateSection || 'hull'
      ;(sec2 === 'spaced' ? spaced : primary).push(node)
      return
    }
    if (node.visible === false) return
    const sec = node.userData.armorSection
    if (sec === 'deco') return
    if (sec === 'spaced') spaced.push(node)
    else primary.push(node)
  })
  return { primary, spaced }
}

export function selectExternalMeshes(moduleMeshes, activeGun, cfg) {
  const hasMask = hasGunMask(cfg)
  const out = []
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
 *  未知弹种 fail-closed 返回 null，不交给穿透判定的「未知 → HE」兜底。 */
export function shellTypeOf(sh) {
  const id = sh && sh.type_id
  if (typeof id === 'number') {
    if (id === 0) return 'ap'
    if (id === 1) return 'apcr'
    if (id === 2) return 'heat'
    if (id === 3) return 'he'
  }
  const t = ((sh && sh.type) || '').toLowerCase()
  if (t === 'hc' || t === 'hc_premium' || t === 'heat' || t === 'atgm_heat') return 'heat'
  if (t === 'ap_cr' || t === 'ap_cr_premium' || t === 'apcr') return 'apcr'
  if (t === 'he' || t === 'he_premium' || t === 'hesh' || t === 'hesh_premium') return 'he'
  if (t === 'ap' || t === 'ap_premium') return 'ap'
  return null
}

/** 校准弹穿深系数；未知弹种没有可用口径，不猜 1.07。 */
export function calibratedPenMul(shellType) {
  if (!shellType) return 1.0
  return (shellType === 'ap' || shellType === 'apcr') ? 1.06 : 1.07
}

export const ENHANCED_ARMOR_THICK_MUL = 1.04

/** 炮弹角度参数（弧度）：BlitzKit degToRad(shell.normalization ?? 0)；爆炸弹不跳弹。 */
export function shellAngles(sh, isExplosive) {
  return {
    norm: (sh.normalization != null ? sh.normalization : 0) * Math.PI / 180,
    rico: (isExplosive ? 90 : (sh.ricochet != null ? sh.ricochet : 70)) * Math.PI / 180,
  }
}

/** 交战距离衰减（0x719740）：d≤100 或 HE 恒 near；d>100 非 HE 线性至 far，clamp≥0。 */
export function rolledPenetration(near, farRaw, distance, isHE) {
  const far = (typeof farRaw === 'number' && farRaw > 0) ? farRaw : near
  if (isHE || distance <= 100.0) return near
  return Math.max(0, near + (far - near) * (distance - 100.0) / 400.0)
}

// 穿透场景克隆工厂：调用点传各自材质
export function addClone(scene, src, mat, renderOrder) {
  const m = new THREE.Mesh(src.geometry, mat)
  m.renderOrder = renderOrder
  m.userData._src = src
  src.updateWorldMatrix(true, false)
  m.matrixAutoUpdate = false
  m.matrix.copy(src.matrixWorld)
  scene.add(m)
  return m
}

// 可控板 clone 打状态标记 + 按当前态设初始可见性（切态零重建的翻面入口）
function tagStateClone(clone, src) {
  if (src && src.userData.armorStateKey) {
    clone.userData._armorStateKey = src.userData.armorStateKey
    clone.visible = src.userData.armorStateHidden !== true
  }
}

/**
 * 厚度通道场景：`meshes` = {primary, spaced, external}；`mats` = {omit, spacedOmit, externalDepth,
 * spacedMaterial, externalMaterial}（深度占位由调用方给：回放的辅助通道必须保持标准深度）。
 */
export function populateSpacedArmorScene(scene, meshes, mats, pen, gunClipPlane) {
  meshes.primary.forEach(function(node) {
    const c = addClone(scene, node, mats.omit, 0)
    tagStateClone(c, node)
  })
  meshes.spaced.forEach(function(node) {
    const t = node.userData.armorThickness || 0
    // 闭合网格只着色最近正面（每像素一块板一次）；开放面片双面着色，背面可见。
    // additive 层之间不写深度，多块间隙板仍按层累加，不会被前板遮挡。
    const side = isClosedSurfaceGeometry(node.geometry) ? THREE.FrontSide : THREE.DoubleSide
    const cm = addClone(scene, node, mats.spacedMaterial(t, pen, side), 2)
    cm.userData._baseThickness = t
    tagStateClone(cm, node)
    // 间隙甲深度占位（renderOrder 5，着色之后）：供 HEAT gap 衰减读取最近
    // 间隙板深度；状态通道另有自己的最近层深度测试。
    const od = addClone(scene, node, mats.spacedOmit, 5)
    tagStateClone(od, node)
  })
  meshes.external.forEach(function(node) {
    // 0 mm 是合法的 fail-closed 厚度，只有缺失/undefined 才使用外部模块兜底值
    const t = node.userData.armorThickness ?? 20
    const clipped = node.userData.armorSection === 'gunBarrel' && gunClipPlane
    const side = node.userData.moduleDoubleSided ? THREE.DoubleSide : THREE.FrontSide
    // 深度/着色 clone 沿用源材质 side（履带双面；轮子单面）：FrontSide 会把
    // 履带上表面（绕序朝内）剔除，热力图在履带顶部变成空洞/露出后方装甲色。
    const dmat = (clipped || side === THREE.DoubleSide)
      ? (() => {
        const m = mats.externalDepth.clone()
        m.side = side
        m.clippingPlanes = clipped ? [gunClipPlane] : null
        return m
      })()
      : mats.externalDepth
    const cmat = mats.externalMaterial(t, pen, clipped ? gunClipPlane : null)
    cmat.side = side
    const od = addClone(scene, node, mats.omit, 3)
    od.material = dmat
    const cm2 = addClone(scene, node, cmat, 4)
    cm2.userData._baseThickness = t
  })
}

/** 状态通道场景（RT1）：主装甲深度（阻挡其后间隙板/模块）→ 间隙板状态（depthWrite
 *  独占最近板；R/G=跳弹/续飞，A=0）→ 外部模块状态（更近时写 A=1，RGB 保留）。
 *  模块不是装甲层：它在前时抑制其后间隙板的跳弹/续飞。 */
export function populateSpacedStateScene(scene, meshes, mats, pen, gunClipPlane) {
  // 主装甲深度：其后间隙板/模块不写状态（防止越过主装甲的板污染本像素状态）
  meshes.primary.forEach(function(node) {
    const c = addClone(scene, node, mats.omit, 0)
    tagStateClone(c, node)
  })
  meshes.spaced.forEach(function(node) {
    const t = node.userData.armorThickness || 0
    const sm = addClone(scene, node, mats.spacedStateMaterial(t, pen), 2)
    sm.userData._baseThickness = t
    tagStateClone(sm, node)
  })
  meshes.external.forEach(function(node) {
    const clipped = node.userData.armorSection === 'gunBarrel' && gunClipPlane
    // 模块在最近间隙板之前时写 A=1（更远则深度测试失败）；RGB 保留间隙板状态。
    const sm = mats.moduleStateMaterial(clipped ? gunClipPlane : null)
    sm.side = node.userData.moduleDoubleSided ? THREE.DoubleSide : THREE.FrontSide
    addClone(scene, node, sm, 3)
  })
}

export function populatePrimaryArmorScene(scene, meshes, mats) {
  meshes.primary.forEach(function(node) {
    const t = node.userData.armorThickness
    const d = addClone(scene, node, mats.exclude, 0)               // 正面深度遮罩
    const cm = addClone(scene, node, mats.penetrationMaterial(t == null ? 0 : t), 1)  // 着色
    cm.userData._baseThickness = t == null ? 0 : t
    tagStateClone(d, node)
    tagStateClone(cm, node)
  })
}
