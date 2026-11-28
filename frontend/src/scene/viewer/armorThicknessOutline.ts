import * as THREE from 'three'
import { thicknessOutlineColor, type ThicknessClass } from './armorThicknessPalette.js'

const OUTLINE_ANGLE = 45
const OUTLINE_RENDER_ORDER = 1

type ThicknessColorOf = (thickness: number | null | undefined) => number

export function outlineOf(mesh: THREE.Mesh): THREE.LineSegments | null {
  return (mesh.userData.collisionOutline as THREE.LineSegments | undefined) ?? null
}

export function setOutlineVisible(mesh: THREE.Mesh, visible: boolean): void {
  const line = outlineOf(mesh)
  if (line) line.visible = visible
}

/**
 * 每块板/模块一条 45° 硬边勾线；重复调用只更新颜色，不重建几何。
 * 颜色取自当前表面材质（动态装甲切态后表面已换色），缺材质时退回厚度色阶。
 */
export function ensureThicknessOutline(
  mesh: THREE.Mesh,
  kind: ThicknessClass,
  thicknessToColor: ThicknessColorOf,
): void {
  if (!mesh.geometry) return
  let line = outlineOf(mesh)
  if (!line) {
    line = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, OUTLINE_ANGLE),
      new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }),
    )
    // 勾线是纯视觉轮廓，必须从 intersectObjects 的装甲/模块拾取链里消失；
    // Line 命中沿父网格仍能读到 armorSection，漏掉会污染厚度点选与判定。
    line.raycast = () => {}
    line.renderOrder = OUTLINE_RENDER_ORDER
    mesh.add(line)
    mesh.userData.collisionOutline = line
  }
  const surface = mesh.material
  const baseColor = !Array.isArray(surface) && surface && (surface as THREE.MeshBasicMaterial).color
    ? (surface as THREE.MeshBasicMaterial).color.getHex()
    : thicknessToColor(mesh.userData.armorThickness)
  const material = line.material as THREE.LineBasicMaterial
  const color = thicknessOutlineColor(kind, baseColor)
  if (material.color.getHex() !== color) material.color.setHex(color)
  // 炮管勾线与实体共用 gun_mask 裁剪面；其余模块清空，避免重进厚度视图时残留旧平面。
  const solid = mesh.userData.collisionSolidMaterial as THREE.MeshBasicMaterial | undefined
  const clipPlanes = kind === 'external' && mesh.userData.armorSection === 'gunBarrel' && solid
    ? (solid.clippingPlanes ?? null)
    : null
  const hadClip = !!(material.clippingPlanes && material.clippingPlanes.length)
  if (hadClip !== !!clipPlanes) {
    material.clippingPlanes = clipPlanes
    material.needsUpdate = true
  } else if (clipPlanes) {
    material.clippingPlanes = clipPlanes
  }
}

export function disposeThicknessOutline(mesh: THREE.Mesh): void {
  const line = outlineOf(mesh)
  if (!line) return
  mesh.remove(line)
  line.geometry.dispose()
  const material = line.material
  if (Array.isArray(material)) material.forEach(item => item.dispose())
  else material.dispose()
  delete mesh.userData.collisionOutline
}

export function clearThicknessOutlines(
  armorModel: THREE.Object3D | null,
  moduleMeshes: readonly THREE.Object3D[],
): void {
  const roots: THREE.Object3D[] = []
  if (armorModel) roots.push(armorModel)
  roots.push(...moduleMeshes)
  for (const root of roots) {
    root.traverse(function(node: THREE.Object3D) {
      const mesh = node as THREE.Mesh
      if (mesh.isMesh) disposeThicknessOutline(mesh)
    })
  }
}

/** 参与高亮/勾线的全部网格：非 deco 装甲板 + 外部模块。 */
export function collectArmorMeshes(
  armorModel: THREE.Object3D | null,
  moduleMeshes: readonly THREE.Object3D[],
): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  if (armorModel) {
    armorModel.traverse(function(node: THREE.Object3D) {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh || mesh.userData.armorSection === 'deco') return
      meshes.push(mesh)
    })
  }
  for (const node of moduleMeshes) meshes.push(node as THREE.Mesh)
  return meshes
}

/**
 * 建齐当前模型的勾线并同步选中可见性：有选中时只显示选中集合，无选中时全部显示。
 * 勾线几何/材质缓存挂在 mesh.userData.collisionOutline，切态或重建材质不会丢。
 */
export function syncThicknessOutlines(
  armorModel: THREE.Object3D | null,
  moduleMeshes: readonly THREE.Object3D[],
  highlighted: THREE.Object3D | null,
  selectedSet: ReadonlySet<THREE.Object3D>,
  thicknessToColor: ThicknessColorOf,
): void {
  if (!armorModel) return
  armorModel.traverse(function(node: THREE.Object3D) {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || mesh.userData.armorSection === 'deco') return
    ensureThicknessOutline(mesh, mesh.userData.armorSection === 'spaced' ? 'spaced' : 'primary', thicknessToColor)
  })
  for (const node of moduleMeshes) {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) continue
    ensureThicknessOutline(mesh, 'external', thicknessToColor)
  }
  for (const mesh of collectArmorMeshes(armorModel, moduleMeshes)) {
    setOutlineVisible(mesh, !highlighted || selectedSet.has(mesh))
  }
}