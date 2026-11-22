import * as THREE from 'three'
import type { Material, Mesh, Object3D, Plane, Side } from 'three'
import { assignSpacedStencilBits, isClosedSurfaceGeometry, spacedDedupKey, SPACED_STENCIL_BIT_LIMIT } from '../armorMeshTopology.js'

// 穿透场景克隆工厂：调用点传各自材质
export function addClone(scene: Object3D, src: Mesh, mat: Material, renderOrder: number): Mesh {
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
function tagStateClone(clone: Mesh, src: Mesh | null | undefined): void {
  if (src && src.userData.armorStateKey) {
    clone.userData._armorStateKey = src.userData.armorStateKey
    clone.visible = src.userData.armorStateHidden !== true
  }
}

/**
 * 厚度通道场景：`meshes` = {primary, spaced, external}；`mats` = {omit, spacedOmit, externalDepth,
 * spacedMaterial, externalMaterial}（深度占位由调用方给：回放的辅助通道必须保持标准深度）。
 */
/** 厚度/状态通道场景装配的材质工厂与占位材质（createArmorShaderContext 的运行态投影）。 */
export interface SpacedArmorSceneMats {
  omit: Material
  spacedOmit: Material
  externalDepth: Material
  spacedMaterial(t: number, pen: number, side: Side): Material
  externalMaterial(t: number, pen: number, clip: Plane | null): Material
}

// 开放间隙板厚度通道的同板去重（stencil front 写 / back 测）。
// 语义权威 = 点击链 collectJudgmentHits 调用的 resolveSpacedHitMask（armorMeshTopology）：
// 按整条射线的命中集合判定——同键有入射面命中时只计入射面，没有入射面命中时才计入
// 出射面；与穿越顺序（front→back / back→front）无关。开放壳体（炮盾等）的出射面属
// 同一块板，不得当第二块板再计一次厚度。front clone 先于 back clone（renderOrder
// 2 → 2.1），stencil 位按像素汇总，因此片元的深度先后不影响结果。
function applySpacedFrontStencil(m: Material, bit: number): void {
  m.stencilWrite = true
  m.stencilFunc = THREE.AlwaysStencilFunc
  m.stencilRef = bit
  m.stencilWriteMask = bit
  m.stencilFail = THREE.KeepStencilOp
  m.stencilZFail = THREE.KeepStencilOp
  m.stencilZPass = THREE.ReplaceStencilOp
}
function applySpacedBackStencil(m: Material, bit: number): void {
  // three.js 以 stencilWrite 使能 stencil test；writeMask=0 + 全 Keep = 只测不写。
  m.stencilWrite = true
  m.stencilWriteMask = 0
  m.stencilFunc = THREE.NotEqualStencilFunc
  m.stencilFuncMask = bit
  m.stencilRef = bit
  m.stencilFail = THREE.KeepStencilOp
  m.stencilZFail = THREE.KeepStencilOp
  m.stencilZPass = THREE.KeepStencilOp
}
/** 开放间隙板 mesh 的去重键（armorSectionOrig:plateId，与点击链同粒度）。 */
function openSpacedKey(node: Mesh): string {
  return spacedDedupKey(node.userData.armorSectionOrig, node.userData.armorSection, node.userData.armorPlateId)
}

export function populateSpacedArmorScene(scene: Object3D, meshes: { primary: readonly Mesh[]; spaced: readonly Mesh[]; external: readonly Mesh[] }, mats: SpacedArmorSceneMats, pen: number, gunClipPlane: Plane | null | undefined): void {
  meshes.primary.forEach(function(node) {
    const c = addClone(scene, node, mats.omit, 0)
    tagStateClone(c, node)
  })
  // 开放间隙板键位分配（8 位 stencil 容量）：超限时整车开放网格回退现行双面
  // 累计并显式报告（fail-closed；不做逐网格半修——部分板精确、部分板双计会产出
  // 无判别口径的画面）。目标 RT 必须带 stencilBuffer（tankViewer penetrationRT /
  // 回放 armorHighlight spacedRT）；无 stencil 附件的 target 上 GL 使测试恒通过，
  // 行为退化为修复前（可观测：横扫热力图复现双计红带）。
  const openSpacedKeys = meshes.spaced
    .filter(function(node) { return !isClosedSurfaceGeometry(node.geometry) })
    .map(openSpacedKey)
  const openBits = assignSpacedStencilBits(openSpacedKeys)
  if (openBits.overflow) {
    console.error('[armor-heatmap] spaced dedup keys exceed ' + SPACED_STENCIL_BIT_LIMIT +
      ' stencil bits — falling back to double-sided accumulation (known double-count on open shells):' +
      ' keys=' + JSON.stringify([...new Set(openSpacedKeys)]))
  }
  /** 单 clone 计厚路径（闭合网格 / 溢出或键缺失回退）+ 深度占位。 */
  const addSingleSpacedClone = (node: Mesh, t: number, side: Side) => {
    const cm = addClone(scene, node, mats.spacedMaterial(t, pen, side), 2)
    cm.userData._baseThickness = t
    tagStateClone(cm, node)
    // 间隙甲深度占位（renderOrder 5，着色之后）：供 HEAT gap 衰减读取最近
    // 间隙板深度；状态通道另有自己的最近层深度测试。
    const od = addClone(scene, node, mats.spacedOmit, 5)
    tagStateClone(od, node)
  }
  meshes.spaced.forEach(function(node) {
    const t = node.userData.armorThickness || 0
    const closed = isClosedSurfaceGeometry(node.geometry)
    // 闭合网格只着色最近正面（每像素一块板一次，背面被剔除）；additive 层之间
    // 不写深度，多块间隙板仍按层累加，不会被前板遮挡。
    if (closed || openBits.overflow) {
      addSingleSpacedClone(node, t, closed ? THREE.FrontSide : THREE.DoubleSide)
      return
    }
    const bit = openBits.bits.get(openSpacedKey(node))
    if (bit == null) {
      // 键位分配与筛选同源，不该发生；fail-closed 回退双面（宁可见已知双计，不静默丢板）。
      addSingleSpacedClone(node, t, THREE.DoubleSide)
      return
    }
    // 开放网格 front clone：入射面（含绕序朝内的单面屏的迎光面）照常计厚并置本键位。
    const fm = mats.spacedMaterial(t, pen, THREE.FrontSide)
    applySpacedFrontStencil(fm, bit)
    const cf = addClone(scene, node, fm, 2)
    cf.userData._baseThickness = t
    tagStateClone(cf, node)
    // 开放网格 back clone：出射面仅当本键位未置位时计厚（同键入射面已计 → 抑制）。
    // 从背面看的单面屏入射面即背面：位未置 → 照常计入（与点击链一致）。
    const bm = mats.spacedMaterial(t, pen, THREE.BackSide)
    applySpacedBackStencil(bm, bit)
    const cb = addClone(scene, node, bm, 2.1)
    cb.userData._baseThickness = t
    tagStateClone(cb, node)
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
        m.clippingPlanes = (clipped ? [gunClipPlane] : null) as Plane[] | null
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
export function populateSpacedStateScene(scene: Object3D, meshes: { primary: readonly Mesh[]; spaced: readonly Mesh[]; external: readonly Mesh[] }, mats: {
  omit: Material
  spacedStateMaterial(t: number, pen: number): Material
  moduleStateMaterial(clip: Plane | null): Material
}, pen: number, gunClipPlane: Plane | null | undefined): void {
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

export function populatePrimaryArmorScene(scene: Object3D, meshes: { primary: readonly Mesh[] }, mats: {
  exclude: Material
  penetrationMaterial(t: number): Material
}): void {
  meshes.primary.forEach(function(node) {
    const t = node.userData.armorThickness
    const d = addClone(scene, node, mats.exclude, 0)               // 正面深度遮罩
    const cm = addClone(scene, node, mats.penetrationMaterial(t == null ? 0 : t), 1)  // 着色
    cm.userData._baseThickness = t == null ? 0 : t
    tagStateClone(d, node)
    tagStateClone(cm, node)
  })
}
