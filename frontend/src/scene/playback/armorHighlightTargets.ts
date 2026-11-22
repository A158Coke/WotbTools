// 装甲着色目标生命周期（buildTarget / targetArmor / syncPose / syncUniforms /
// disposeTarget）——自 armorHighlight.ts 出仓（2026-11-21 #LOC 结构拆分：代码与搬移前
// 逐字一致；工厂闭包读数改经 ctx 注入，GPU/模板缓存 owner 仍在宿主工厂）。
import * as THREE from 'three'
import type { Material, Mesh, Object3D, PerspectiveCamera, Scene } from 'three'
import {
  armorPivots, applyArmorConfigVisible, collectArmorPrefixes, gunMaskOriginModel, installArmorPivots,
  partitionArmorMeshes, plateThickness, populatePrimaryArmorScene, populateSpacedArmorScene,
  populateSpacedStateScene, retagSpacedSections, rolledPenetration, selectExternalMeshes,
  tagArmorPlates, tagModuleMeshes,
} from '../viewer/armorPlateModel.js'
import type { TankArmorConfig, TankArmorData } from '../viewer/armorPlateModel.js'
import { armorPosePart, armorWorldMatrix, shellUniforms } from './armorHighlightPick.js'
import type { AimedVehicleCandidate } from './armorHighlightPick.js'
import type { ArmorHighlightFrame } from './armorHighlightTypes.js'

/** 工厂闭包注入（getter 快照；owner = createArmorHighlight）。 */
export interface ArmorTargetsCtx {
  shaders: {
    externalMaterial: (...args: never[]) => Material
    moduleStateMaterial: (...args: never[]) => Material
    spacedMaterial: (...args: never[]) => Material
    spacedStateMaterial: (...args: never[]) => Material
    penetrationMaterial: (...args: never[]) => Material
  }
  depthMaterials: { omit: Material; spacedOmit: Material; externalDepth: Material }
  excludeMaterial: Material
  targets: Map<number, { glb: Object3D; armor: BuiltTarget | null }>
  pending: Set<number>
  templateRetry: { allowed(key: number): boolean; succeed(key: number): void; fail(key: number): void }
  isDisposed(): boolean
  loadTemplate(tankId: number, url: string): Promise<Object3D | null>
  /** 零分配暂存（owner = 宿主工厂；syncPose/syncUniforms 消费）。 */
  identity: THREE.Matrix4
  clipNormal: THREE.Vector3
  clipPoint: THREE.Vector3
  clipMatrix: THREE.Matrix4
  world: THREE.Vector3
}

/** 已构建的目标（三个辅助场景 + 克隆清单 + gun_mask 裁切面）。 */
export interface BuiltTarget {
  state: Scene
  thickness: Scene
  color: Scene
  clones: Mesh[]
  clipPlane: THREE.Plane | null
  maskOrigin: number | null
}

export function buildTarget(ctx: ArmorTargetsCtx, template: Object3D, vehicle: AimedVehicleCandidate, tankData: TankArmorData, cfg: TankArmorConfig): BuiltTarget | null {
    const pivots = armorPivots(tankData, cfg)
    if (!pivots) return null
    const model = template.clone(true)
    const thicknessOf = (section: string, plateId: string): number => plateThickness(tankData, cfg, section, plateId)
    tagArmorPlates(model, thicknessOf)
    applyArmorConfigVisible(model, cfg, collectArmorPrefixes(model))
    retagSpacedSections(model, tankData, cfg)
    model.traverse((node) => { const mesh = node as Mesh; if (mesh.isMesh && mesh.userData.armorSection === 'deco') mesh.visible = false })
    installArmorPivots(model, pivots)
    model.updateMatrixWorld(true)

    const moduleMeshes = tagModuleMeshes(vehicle.glb, thicknessOf)
    const glbParts = vehicle.glbParts
    const gunName = (glbParts?.gunNodes ?? []).map((n) => (n.name || '').match(/^gun_(\d+)$/)).find(Boolean)
    const { primary, spaced } = partitionArmorMeshes(model)
    const external = selectExternalMeshes(moduleMeshes, gunName ? parseInt(gunName[1], 10) : null, cfg)
    const meshes = { primary, spaced, external }
    const maskOrigin = gunMaskOriginModel(tankData, cfg)
    const clipPlane = maskOrigin == null ? null : new THREE.Plane()
    const materials = {
      ...ctx.depthMaterials, exclude: ctx.excludeMaterial,
      externalMaterial: ctx.shaders.externalMaterial, moduleStateMaterial: ctx.shaders.moduleStateMaterial,
      spacedMaterial: ctx.shaders.spacedMaterial, spacedStateMaterial: ctx.shaders.spacedStateMaterial,
      penetrationMaterial: ctx.shaders.penetrationMaterial,
    }
    const state = new THREE.Scene(), thickness = new THREE.Scene(), color = new THREE.Scene()
    populateSpacedStateScene(state, meshes, materials, 200, clipPlane)
    populateSpacedArmorScene(thickness, meshes, materials, 200, clipPlane)
    populatePrimaryArmorScene(color, meshes, materials)
    const clones: Mesh[] = []
    for (const scene of [state, thickness, color]) {
      scene.traverse((node) => {
        const meshNode = node as Mesh
        if (!meshNode.isMesh) return
        const src = meshNode.userData._src as Mesh
        node.userData._external = external.includes(src)
        node.userData._part = armorPosePart((src as Mesh).name || '')
        if (!node.userData._external) node.userData._rest = src.matrixWorld.clone()
        clones.push(node as Mesh)
      })
    }
    return { state, thickness, color, clones, clipPlane, maskOrigin }
  }


/** 目标生命周期闭包（宿主工厂按 ctx 一次性装配；原闭包函数逐字迁入）。 */
export function createArmorTargets(ctx: ArmorTargetsCtx) {
  /** 目标 armor 就绪则返回，否则懒加载（完成后 `onReady` 让场景补一帧）并返回 null。 */
  function targetArmor(vehicle: ArmorHighlightFrame['vehicle'], tankData: ArmorHighlightFrame['tankData'], cfg: import('../viewer/armorPlateModel.js').TankArmorConfig | null | undefined, onReady: () => void): BuiltTarget | null {
    const eid = vehicle.def.eid
    const known = ctx.targets.get(eid)
    if (known && known.glb === vehicle.glb) return known.armor
    if (known) { disposeTarget(known.armor); ctx.targets.delete(eid) }   // GLB 重建后外部模块引用已失效
    const tankId = vehicle.def.tank_id
    if (tankId == null || ctx.pending.has(eid) || !tankData.model_url || !ctx.templateRetry.allowed(tankId)) return null
    ctx.pending.add(eid)
    ctx.loadTemplate(tankId, tankData.model_url).then((template) => {
      ctx.pending.delete(eid)
      if (ctx.isDisposed() || !vehicle.glb || !template) return
      ctx.targets.set(eid, { glb: vehicle.glb, armor: buildTarget(ctx, template, vehicle, tankData, cfg as TankArmorConfig) })  // cfg 形状由 armorHighlightBlock 验证在场
      onReady()
    })
    return null
  }

  function syncPose(target: BuiltTarget, vehicle: ArmorHighlightFrame['vehicle']): void {
    const root = vehicle.glb.matrixWorld
    const { poseT, poseG } = (vehicle as { glbParts: { poseT: THREE.Matrix4; poseG: THREE.Matrix4 } }).glbParts
    for (const clone of target.clones) {
      if (clone.userData._external) { clone.matrix.copy(clone.userData._src.matrixWorld); continue }
      const part = clone.userData._part
      const pose = part === 'turret' ? poseT : part === 'gun' ? poseG : ctx.identity
      armorWorldMatrix(root, pose, clone.userData._rest, clone.matrix)
    }
    if (target.clipPlane && target.maskOrigin != null) {
      target.clipPlane.setFromNormalAndCoplanarPoint(ctx.clipNormal, ctx.clipPoint.set(0, target.maskOrigin, 0))
      target.clipPlane.applyMatrix4(ctx.clipMatrix.multiplyMatrices(root, poseG))
    }
  }

  function syncUniforms(target: BuiltTarget, camera: PerspectiveCamera, { shell, caliber, penMul, thickMul }: Pick<ArmorHighlightFrame, 'shell' | 'caliber' | 'penMul' | 'thickMul'>): void {
    const s = shellUniforms(shell, caliber)
    for (const clone of target.clones) {
      const u = (clone.material as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms
      if (!u) continue
      if (u.thickness && clone.userData._baseThickness != null) u.thickness.value = clone.userData._baseThickness * thickMul
      if (u.penetration) {
        if (!clone.geometry.boundingSphere) clone.geometry.computeBoundingSphere()
        const sphere0 = clone.geometry.boundingSphere as THREE.Sphere
        ctx.world.copy(sphere0.center).applyMatrix4(clone.matrix)
        const distance = camera.position.distanceTo(ctx.world)
        u.penetration.value = rolledPenetration((shell as { penetration?: number }).penetration || 0, (shell as { penetration_far?: number }).penetration_far, distance, s.isHE) * penMul
      }
      if (u.caliber) u.caliber.value = s.caliber
      if (u.ricochet) u.ricochet.value = s.rico
      if (u.normalization) u.normalization.value = s.norm
      if (u.isExplosive) u.isExplosive.value = s.isExplosive
      if (u.canSplash) u.canSplash.value = s.isHE
      if (u.damage) u.damage.value = (shell as { damage?: number }).damage || 0
      if (u.explosionRadius) u.explosionRadius.value = (shell as { explosion_radius?: number }).explosion_radius || 0
      if (u.heatmapMask) u.heatmapMask.value = true   // 没有点击爆点：HE 只显示可直穿像素
    }
  }
  function disposeTarget(target: BuiltTarget | null): void {
    if (!target) return
    const released = new Set()
    for (const clone of target.clones) {
      if (released.has(clone.material)) continue
      released.add(clone.material)
      ;(clone.material as Material).dispose()
    }
  }

  return {
    targetArmor,
    syncPose,
    syncUniforms,
    disposeTarget,
    buildTarget: (template: Object3D, vehicle: AimedVehicleCandidate, tankData: TankArmorData, cfg: TankArmorConfig) => buildTarget(ctx, template, vehicle, tankData, cfg),
  }
}
