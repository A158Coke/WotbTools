// 录像者 Sniper 视角的单目标穿深着色。装甲规则与着色器全部复用装甲查看器
// （viewer/armorPlateModel.js + viewer/armorShaders.js），本模块只负责：资格判定、
// 选目标、把 armor 网格摆到**画面上那台车的实际姿态**，以及在主渲染之后叠加 pass。
//
// 主渲染完全不动：关闭/不满足资格时零额外 pass。叠加顺序：
//   ① 间隙甲状态/厚度 RT（标准深度）
//   ② 清深度后重画不透明世界的深度——装甲网格在视觉外壳内侧，若沿用主渲染深度，
//      目标自己的车模会把装甲挡住；重画时排除目标，遮挡就只来自真实世界几何
//   ③ primary 排除深度 + 着色
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { dynamicDeclarationByTankId } from '../../data/armorStates.js'
import { createArmorShaderContext, standardDepthMaterial } from '../viewer/armorShaders.js'
import {
  applyArmorConfigVisible, armorPivots, calibratedPenMul, collectArmorPrefixes,
  ENHANCED_ARMOR_THICK_MUL, gunMaskOriginModel, installArmorPivots, partitionArmorMeshes,
  plateThickness, populatePrimaryArmorScene, populateSpacedArmorScene, populateSpacedStateScene,
  retagSpacedSections, rolledPenetration, selectExternalMeshes, shellAngles, shellTypeOf,
  tagArmorPlates, tagModuleMeshes, useFaceNormals,
} from '../viewer/armorPlateModel.js'

/** 重画世界深度专用 layer（0 = 默认，1 = 开镜隐藏本车）。 */
const OCCLUDER_LAYER = 2
const EQ_CALIBRATED_SHELLS = 103
const EQ_ENHANCED_ARMOR = 110

/** 时刻 t 的当前弹种（`timeline` 时间升序）；首条之前未知，返回 null。 */
export function authorShellAt(timeline, t) {
  if (!timeline || !timeline.length || !(t >= timeline[0].t)) return null
  let lo = 0, hi = timeline.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (timeline[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return timeline[lo].shell_id
}

/** 配置弹表里的弹种（caliber 取弹体，缺失回退该炮口径）；不在表内返回 null。 */
export function mountedShell(cfg, shellId) {
  const i = (cfg?.shell_global_ids || []).indexOf(shellId)
  const shell = i >= 0 ? cfg.shells?.[i] : null
  if (!shell) return null
  const caliber = [shell.caliber, cfg.caliber].find((v) => Number.isFinite(v) && v > 0) ?? 0
  return { shell, caliber }
}

/**
 * 资格判定：返回第一个不满足的原因码，全部满足返回 null。每一项都是「证据不足就不显示」，
 * 不存在回退分支——颜色本身就是结论，错的配置/弹种只会给出错的结论。
 */
export function armorHighlightBlock({
  targetTankId, targetConfig, authorConfig, shellId, targetEquipment, authorEquipment,
}) {
  if (dynamicDeclarationByTankId(targetTankId)) return 'dynamic_armor'
  if (!targetConfig) return 'target_config_unknown'
  if (!authorConfig) return 'author_config_unknown'
  if (shellId == null) return 'shell_unknown'
  const mounted = mountedShell(authorConfig, shellId)
  if (!mounted) return 'shell_not_mounted'
  if (!shellTypeOf(mounted.shell)) return 'shell_type_unknown'
  if (!(mounted.caliber > 0)) return 'caliber_unknown'
  if (!Array.isArray(targetEquipment) || !Array.isArray(authorEquipment)) return 'equipment_unknown'
  return null
}

const _aimNdc = new THREE.Vector3()
/**
 * 屏幕准星那条线的方向：相机 → Type39 瞄准点。进入录像者视角的过渡期相机朝向与它不同，
 * 准星才是画面上指着的地方。瞄准点投影不到（与准星隐藏同判据）时返回 null。
 */
export function reticleAimDirection(camera, aimPoint, out) {
  _aimNdc.copy(aimPoint).project(camera)
  if (![_aimNdc.x, _aimNdc.y, _aimNdc.z].every((n) => Number.isFinite(n) && Math.abs(n) <= 1)) return null
  out.subVectors(aimPoint, camera.position)
  return out.lengthSq() > 0 ? out.normalize() : null
}

function collectVisibleMeshes(node, out) {
  if (!node.visible) return
  if (node.isMesh) out.push(node)
  for (const child of node.children) collectVisibleMeshes(child, out)
}

/**
 * 顶点被改写后调用（悬挂形变）。这里只打标记、由拾取时重算：直接置空 bounds 会让视锥剔除
 * 每帧为所有行驶中的车遍历顶点，而 Mesh.raycast 的粗筛用的正是这份 bounds。
 */
export function markPickBoundsStale(geometry) {
  geometry.userData.pickBoundsStale = true
}

function refreshPickBounds(geometry) {
  if (!geometry.userData.pickBoundsStale) return
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.userData.pickBoundsStale = false
}

const _pickRaycaster = new THREE.Raycaster()
const _pickMeshes = []
const _pickHits = []
/**
 * 视线最先碰到的车辆：对当前帧可见网格精确求交，炮塔转动、炮管俯仰都按实际姿态算。
 * Mesh.raycast 自带逐网格包围球/盒粗筛；只是选目标，遮挡由深度 pass 决定。
 */
export function aimedVehicle(origin, direction, vehicles) {
  _pickRaycaster.set(origin, direction)
  let best = null, bestDistance = Infinity
  for (const v of vehicles) {
    _pickMeshes.length = 0
    _pickHits.length = 0
    collectVisibleMeshes(v.glb, _pickMeshes)
    for (const mesh of _pickMeshes) {
      refreshPickBounds(mesh.geometry)
      mesh.raycast(_pickRaycaster, _pickHits)
    }
    for (const hit of _pickHits) {
      if (hit.distance < bestDistance) { best = v; bestDistance = hit.distance }
    }
  }
  return best
}

/** 能挡住炮弹视线的世界几何：不透明、写深度，且不是植被（树丛不挡弹）。 */
export function isSolidOccluder(object) {
  const materials = Array.isArray(object.material) ? object.material : [object.material]
  return materials.every((m) => !!m && !m.transparent && m.depthWrite !== false && !m.uniforms?.uFoliageClip)
}

/** 炮塔/炮管 armor 网格跟随的姿态：与 glbParts 的 poseT/poseG 一一对应。 */
export function armorPosePart(name) {
  if (/^turret_\d+/.test(name)) return 'turret'
  if (/^gun_\d+/.test(name)) return 'gun'
  return 'hull'
}

/** armor 世界矩阵 = GLB 根 × 部件姿态 × armor 静止矩阵（画面上的车摆在哪，装甲就在哪）。 */
export function armorWorldMatrix(root, pose, rest, out) {
  return out.copy(root).multiply(pose).multiply(rest)
}

function shellUniforms(shell, caliber) {
  const type = shellTypeOf(shell)
  const isHE = type === 'he'
  const isExplosive = isHE || type === 'heat'
  return { type, isHE, isExplosive, caliber, ...shellAngles(shell, isExplosive) }
}

export function createArmorHighlight({ renderer, assetProvider }) {
  const shaders = createArmorShaderContext()
  const templates = new Map()    // tankId → Promise<armor 模板 | null>
  const targets = new Map()      // eid → 已构建的目标（外部模块引用该车的 GLB 实例）
  const pending = new Set()
  const excludeMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true })
  const occluderMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })
  const depthMaterials = {
    omit: standardDepthMaterial(),
    spacedOmit: standardDepthMaterial(THREE.DoubleSide),
    externalDepth: standardDepthMaterial(),
  }
  let stateRT = null, spacedRT = null
  const size = new THREE.Vector2()
  const clearColor = new THREE.Color()
  const world = new THREE.Vector3()
  const clipMatrix = new THREE.Matrix4()
  const identity = new THREE.Matrix4()
  const clipNormal = new THREE.Vector3(0, 1, 0)
  const clipPoint = new THREE.Vector3()

  function loadTemplate(tankId, url) {
    if (templates.has(tankId)) return templates.get(tankId)
    const promise = assetProvider.bytes(url)
      .then((bytes) => new Promise((resolve) => {
        new GLTFLoader().parse(bytes.buffer, '', (gltf) => resolve(gltf.scene), () => resolve(null))
      }))
      .then((model) => { if (model) useFaceNormals(model); return model })
      .catch((error) => { console.warn('[playback] armor 模型加载失败 tank_id=' + tankId + ':', error); return null })
    templates.set(tankId, promise)
    return promise
  }

  function buildTarget(template, vehicle, tankData, cfg) {
    const pivots = armorPivots(tankData, cfg)
    if (!pivots) return null
    const model = template.clone(true)
    const thicknessOf = (section, plateId) => plateThickness(tankData, cfg, section, plateId)
    tagArmorPlates(model, thicknessOf)
    applyArmorConfigVisible(model, cfg, collectArmorPrefixes(model))
    retagSpacedSections(model, tankData, cfg)
    model.traverse((node) => { if (node.isMesh && node.userData.armorSection === 'deco') node.visible = false })
    installArmorPivots(model, pivots)
    model.updateMatrixWorld(true)

    const moduleMeshes = tagModuleMeshes(vehicle.glb, thicknessOf)
    const gunName = vehicle.glbParts.gunNodes.map((n) => (n.name || '').match(/^gun_(\d+)$/)).find(Boolean)
    const { primary, spaced } = partitionArmorMeshes(model)
    const external = selectExternalMeshes(moduleMeshes, gunName ? parseInt(gunName[1], 10) : null, cfg)
    const meshes = { primary, spaced, external }
    const maskOrigin = gunMaskOriginModel(tankData, cfg)
    const clipPlane = maskOrigin == null ? null : new THREE.Plane()
    const materials = {
      ...depthMaterials, exclude: excludeMaterial,
      externalMaterial: shaders.externalMaterial, moduleStateMaterial: shaders.moduleStateMaterial,
      spacedMaterial: shaders.spacedMaterial, spacedStateMaterial: shaders.spacedStateMaterial,
      penetrationMaterial: shaders.penetrationMaterial,
    }
    const state = new THREE.Scene(), thickness = new THREE.Scene(), color = new THREE.Scene()
    populateSpacedStateScene(state, meshes, materials, 200, clipPlane)
    populateSpacedArmorScene(thickness, meshes, materials, 200, clipPlane)
    populatePrimaryArmorScene(color, meshes, materials)
    const clones = []
    for (const scene of [state, thickness, color]) {
      scene.traverse((node) => {
        if (!node.isMesh) return
        const src = node.userData._src
        node.userData._external = external.includes(src)
        node.userData._part = armorPosePart(src.name || '')
        if (!node.userData._external) node.userData._rest = src.matrixWorld.clone()
        clones.push(node)
      })
    }
    return { state, thickness, color, clones, clipPlane, maskOrigin }
  }

  /** 目标 armor 就绪则返回，否则懒加载（完成后 `onReady` 让场景补一帧）并返回 null。 */
  function targetArmor(vehicle, tankData, cfg, onReady) {
    const eid = vehicle.def.eid
    const known = targets.get(eid)
    if (known && known.glb === vehicle.glb) return known.armor
    if (known) { disposeTarget(known.armor); targets.delete(eid) }   // GLB 重建后外部模块引用已失效
    if (pending.has(eid) || !tankData.model_url) return null
    pending.add(eid)
    loadTemplate(vehicle.def.tank_id, tankData.model_url).then((template) => {
      pending.delete(eid)
      if (disposed || !vehicle.glb) return
      targets.set(eid, {
        glb: vehicle.glb,
        armor: template ? buildTarget(template, vehicle, tankData, cfg) : null,
      })
      onReady()
    })
    return null
  }

  function syncPose(target, vehicle) {
    const root = vehicle.glb.matrixWorld
    const { poseT, poseG } = vehicle.glbParts
    for (const clone of target.clones) {
      if (clone.userData._external) { clone.matrix.copy(clone.userData._src.matrixWorld); continue }
      const part = clone.userData._part
      const pose = part === 'turret' ? poseT : part === 'gun' ? poseG : identity
      armorWorldMatrix(root, pose, clone.userData._rest, clone.matrix)
    }
    if (target.clipPlane) {
      target.clipPlane.setFromNormalAndCoplanarPoint(clipNormal, clipPoint.set(0, target.maskOrigin, 0))
      target.clipPlane.applyMatrix4(clipMatrix.multiplyMatrices(root, poseG))
    }
  }

  function syncUniforms(target, camera, { shell, caliber, penMul, thickMul }) {
    const s = shellUniforms(shell, caliber)
    for (const clone of target.clones) {
      const u = clone.material.uniforms
      if (!u) continue
      if (u.thickness && clone.userData._baseThickness != null) u.thickness.value = clone.userData._baseThickness * thickMul
      if (u.penetration) {
        if (!clone.geometry.boundingSphere) clone.geometry.computeBoundingSphere()
        world.copy(clone.geometry.boundingSphere.center).applyMatrix4(clone.matrix)
        const distance = camera.position.distanceTo(world)
        u.penetration.value = rolledPenetration(shell.penetration || 0, shell.penetration_far, distance, s.isHE) * penMul
      }
      if (u.caliber) u.caliber.value = s.caliber
      if (u.ricochet) u.ricochet.value = s.rico
      if (u.normalization) u.normalization.value = s.norm
      if (u.isExplosive) u.isExplosive.value = s.isExplosive
      if (u.canSplash) u.canSplash.value = s.isHE
      if (u.damage) u.damage.value = shell.damage || 0
      if (u.explosionRadius) u.explosionRadius.value = shell.explosion_radius || 0
      if (u.heatmapMask) u.heatmapMask.value = true   // 没有点击爆点：HE 只显示可直穿像素
    }
  }

  function ensureTargets() {
    renderer.getDrawingBufferSize(size)
    if (stateRT && stateRT.width === size.x && stateRT.height === size.y) return
    disposeTargets()
    const floatCapable = renderer.extensions.has('EXT_color_buffer_float')
      || renderer.extensions.has('EXT_color_buffer_half_float')
    const options = () => ({
      type: floatCapable ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthTexture: new THREE.DepthTexture(size.x, size.y),
    })
    stateRT = new THREE.WebGLRenderTarget(size.x, size.y, options())
    spacedRT = new THREE.WebGLRenderTarget(size.x, size.y, options())
    shaders.resUniform.value.copy(size)
  }

  function bindBuffers(target, camera) {
    const satGuard = stateRT.texture.type === THREE.HalfFloatType ? 0 : 1
    target.color.traverse((node) => {
      const u = node.isMesh && node.material.uniforms
      if (!u || !u.spacedArmorBuffer) return
      u.spacedArmorBuffer.value = spacedRT.texture
      u.spacedStateBuffer.value = stateRT.texture
      u.spacedArmorDepth.value = spacedRT.depthTexture
      u.spacedSatGuard.value = satGuard
      u.inverseProjectionMatrix.value = camera.projectionMatrixInverse
    })
  }

  /** 目标整棵子树不进遮挡集：否则目标车模自己挡住装甲。 */
  function markOccluders(scene, camera, vehicle) {
    scene.traverseVisible((object) => {
      if (!object.isMesh) return
      if (object.layers.test(camera.layers) && isSolidOccluder(object)) object.layers.enable(OCCLUDER_LAYER)
      else object.layers.disable(OCCLUDER_LAYER)
    })
    vehicle.glb.traverse((node) => node.layers.disable(OCCLUDER_LAYER))
    vehicle.group.traverse((node) => node.layers.disable(OCCLUDER_LAYER))
  }

  function drawOccluderDepth(scene, camera, vehicle) {
    markOccluders(scene, camera, vehicle)
    const mask = camera.layers.mask, background = scene.background
    camera.layers.set(OCCLUDER_LAYER)
    scene.background = null
    scene.overrideMaterial = occluderMaterial
    renderer.render(scene, camera)
    scene.overrideMaterial = null
    scene.background = background
    camera.layers.mask = mask
  }

  let disposed = false
  /**
   * 主渲染之后调用。`frame` = {scene, camera, vehicle, tankData, config, shell, caliber,
   * penMul, thickMul, onReady}；目标 armor 未就绪时不画（本帧画面与关闭时相同）。
   */
  function render(frame) {
    const { scene, camera, vehicle } = frame
    const target = targetArmor(vehicle, frame.tankData, frame.config, frame.onReady)
    if (!target) return
    ensureTargets()
    syncPose(target, vehicle)
    syncUniforms(target, camera, frame)
    bindBuffers(target, camera)

    const autoClear = renderer.autoClear, clipping = renderer.localClippingEnabled
    const shadows = renderer.shadowMap.autoUpdate, clearAlpha = renderer.getClearAlpha()
    renderer.getClearColor(clearColor)
    renderer.localClippingEnabled = true
    renderer.shadowMap.autoUpdate = false
    renderer.setClearColor(0x000000, 0)
    renderer.autoClear = true
    renderer.setRenderTarget(stateRT)
    renderer.render(target.state, camera)
    renderer.setRenderTarget(spacedRT)
    renderer.render(target.thickness, camera)
    renderer.setRenderTarget(null)
    renderer.autoClear = false
    renderer.clearDepth()
    drawOccluderDepth(scene, camera, vehicle)
    renderer.render(target.color, camera)
    renderer.autoClear = autoClear
    renderer.localClippingEnabled = clipping
    renderer.shadowMap.autoUpdate = shadows
    renderer.setClearColor(clearColor, clearAlpha)
  }

  function disposeTargets() {
    for (const rt of [stateRT, spacedRT]) {
      if (!rt) continue
      rt.depthTexture?.dispose()
      rt.dispose()
    }
    stateRT = spacedRT = null
  }

  function disposeTarget(target) {
    if (!target) return
    const released = new Set()
    for (const clone of target.clones) {
      if (released.has(clone.material)) continue
      released.add(clone.material)
      clone.material.dispose()
    }
  }

  function dispose() {
    disposed = true
    for (const target of targets.values()) disposeTarget(target.armor)
    targets.clear()
    for (const promise of templates.values()) {
      promise.then((model) => model?.traverse((node) => node.geometry?.dispose()))
    }
    templates.clear()
    disposeTargets()
    for (const material of [excludeMaterial, occluderMaterial, ...Object.values(depthMaterials)]) material.dispose()
    shaders.dispose()
  }

  return { render, dispose }
}

/** 回放 equipment 原值 → 着色系数（调用方已确认双方 equipment 在场）。 */
export function armorEquipmentCoeffs(shell, authorEquipment, targetEquipment) {
  return {
    penMul: authorEquipment.includes(EQ_CALIBRATED_SHELLS) ? calibratedPenMul(shellTypeOf(shell)) : 1.0,
    thickMul: targetEquipment.includes(EQ_ENHANCED_ARMOR) ? ENHANCED_ARMOR_THICK_MUL : 1.0,
  }
}
