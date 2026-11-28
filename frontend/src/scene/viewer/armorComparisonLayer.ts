import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { disposeObject3D } from '../materialDispose.js'
import {
  applyArmorConfigVisible, armorPivots, collectArmorPrefixes, installArmorPivots,
  hasGunMask, partitionArmorMeshes, retagSpacedSections, tagArmorPlates, tagModuleMeshes,
  plateThickness, useFaceNormals,
} from './armorPlateModel.js'
import { thicknessToColor } from './armorThicknessPalette.js'
import { armorPlateKey } from './armorComparisonModel.js'
import type { ArmorComparisonChoice, ComparisonSide, ComparisonTank } from './armorComparisonModel.js'

export type Source = { tank: ComparisonTank; collision: string; chassis: string | null }
export type Models = { collision: THREE.Object3D; chassis: THREE.Object3D | null }

/** 引线端点的候选附着点：板件表面上的采样点（世界坐标 + 面法线）。 */
export type SurfaceSample = { pos: THREE.Vector3; normal: THREE.Vector3 }

/**
 * useFaceNormals 会把索引几何换成新分配的 toNonIndexed 几何；这些几何只属于当前对比层，
 * 必须在 dispose 时释放（否则每次 setChoice 都留下旧的 GPU buffer）。
 */
function convertFaceNormals(node: THREE.Object3D, owned: THREE.BufferGeometry[]): void {
  const before = new Set<THREE.BufferGeometry>()
  node.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh && mesh.geometry) before.add(mesh.geometry)
  })
  useFaceNormals(node)
  node.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh && mesh.geometry && !before.has(mesh.geometry)) owned.push(mesh.geometry)
  })
}
export type ComparisonLayer = ReturnType<typeof createArmorThicknessScene>

async function readModel(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Armor mesh HTTP ' + response.status)
  const bytes = await response.arrayBuffer()
  signal.throwIfAborted()
  return (await new GLTFLoader().parseAsync(bytes, new URL('.', new URL(url, document.baseURI)).href)).scene
}

export async function loadArmorComparisonModels(sources: [Source, Source], signal: AbortSignal): Promise<[Models, Models]> {
  const requests = sources.flatMap(source => [
    readModel(source.collision, signal),
    source.chassis ? readModel(source.chassis, signal) : Promise.resolve(null),
  ])
  const results = await Promise.allSettled(requests)
  const failure = results.find(result => result.status === 'rejected')
  if (failure || signal.aborted) {
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) disposeObject3D(result.value)
    }
    throw failure?.reason ?? signal.reason
  }
  const scenes = results.map(result => result.status === 'fulfilled' ? result.value : null)
  return [{ collision: scenes[0]!, chassis: scenes[1] }, { collision: scenes[2]!, chassis: scenes[3] }]
}

export function disposeArmorComparisonModels(models: [Models, Models]) {
  for (const { collision, chassis } of models) {
    disposeObject3D(collision)
    if (chassis) disposeObject3D(chassis)
  }
}

/**
 * 板件表面的采样点（世界坐标）：三角形质心 + 面法线，上限 48 个。
 * 引线端点从这些样本里挑"朝向相机的最近点"——保证锚点永远钉在板件表面上，
 * （bbox 中心会埋进模型体积或落在薄壳之间，射线打不中，这是此前"标注不附着"的根因）。
 */
function sampleSurfacePoints(mesh: THREE.Mesh, matrixWorld: THREE.Matrix4, limit = 48): SurfaceSample[] {
  const geometry = mesh.geometry
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const triangleCount = index ? index.count / 3 : position.count / 3
  const stride = Math.max(1, Math.ceil(triangleCount / limit))
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const centroid = new THREE.Vector3()
  const edge1 = new THREE.Vector3()
  const edge2 = new THREE.Vector3()
  const samples: SurfaceSample[] = []
  for (let triangle = 0; triangle < triangleCount; triangle += stride) {
    const base = triangle * 3
    const ia = index ? index.getX(base) : base
    const ib = index ? index.getX(base + 1) : base + 1
    const ic = index ? index.getX(base + 2) : base + 2
    a.fromBufferAttribute(position, ia)
    b.fromBufferAttribute(position, ib)
    c.fromBufferAttribute(position, ic)
    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3)
    edge1.subVectors(c, b)
    edge2.subVectors(a, b)
    const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize()
    samples.push({
      pos: centroid.clone().applyMatrix4(matrixWorld),
      normal: normal.applyMatrix3(normalMatrix).normalize(),
    })
    if (samples.length >= limit) break
  }
  return samples
}

/** Show marked plate surfaces at full strength and keep the rest as faint context. */
export function applyArmorComparisonFocus(plates: readonly THREE.Object3D[], selected: ReadonlySet<string> | null) {
  for (const plate of plates) {
    const mesh = plate as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
    const key: string = mesh.userData.armorKey
    const emphasized = selected ? selected.has(key) : mesh.userData.armorChanged === true
    const material = mesh.material
    const transparent = !emphasized
    if (material.transparent !== transparent) {
      material.transparent = transparent
      material.needsUpdate = true
    }
    material.opacity = emphasized ? 1 : mesh.userData.armorModule ? 0.15 : 0.18
    material.depthWrite = emphasized
  }
}

export function createArmorThicknessScene(source: Source, models: Models, choice: ArmorComparisonChoice, side: ComparisonSide) {
  const config = choice.configs[side]
  const tank = source.tank
  const pivots = armorPivots(tank, config)
  if (!pivots) throw new Error('Missing armor model pivots')
  const ownedGeometries: THREE.BufferGeometry[] = []
  const collision = models.collision.clone(true)
  const thicknessOf = (section: string, id: string) => {
    const plates = section === 'hull' ? tank.armor_model?.hull?.plates
      : section === 'turret' ? config.turret_plates : config.gun_plates
    return plates?.[id] ?? null
  }
  tagArmorPlates(collision, thicknessOf)
  applyArmorConfigVisible(collision, config, collectArmorPrefixes(collision))
  retagSpacedSections(collision, tank, config)
  installArmorPivots(collision, pivots)
  collision.rotation.x = -Math.PI / 2
  collision.updateMatrixWorld(true)

  const { primary, spaced } = partitionArmorMeshes(collision)
  const meshes = [...primary, ...spaced].filter(mesh => mesh.userData.armorSectionOrig)
  // 厚度模式下的模块网格（炮管 + 履带），可见性与装甲查看器 rig.applyConfigVisible 同口径：
  // gun_N / turret_N 组按 N 排序，cfg.gun_index / turret_index 是 0 基组序号——
  // 之前拿组号 N 直接比 gun_index，导致主炮被错误隐藏。
  if (models.chassis) {
    const chassis = models.chassis.clone(true)
    chassis.rotation.x = collision.rotation.x
    const gunGroups = new Map<number, THREE.Object3D[]>()
    const turretNodes: THREE.Object3D[] = []
    chassis.traverse(node => {
      const gm = node.name.match(/^gun_(\d+)/)
      const tm = node.name.match(/^turret_(\d+)$/)
      if (gm) {
        const g = parseInt(gm[1], 10)
        if (!gunGroups.has(g)) gunGroups.set(g, [])
        gunGroups.get(g)!.push(node)
      } else if (tm) {
        turretNodes.push(node)
      }
    })
    const gunKeys = [...gunGroups.keys()].sort((a, b) => a - b)
    const gunIndex = config.gun_index ?? 0
    const activeGun = gunKeys.length ? gunKeys[gunIndex % gunKeys.length] : null
    const turretNumbers = turretNodes
      .map(node => parseInt(node.name.match(/\d+/)![0], 10))
      .sort((a, b) => a - b)
    const turretIndex = config.turret_index ?? 0
    const activeTurret = turretNumbers.length ? turretNumbers[turretIndex % turretNumbers.length] : null
    chassis.traverse(node => {
      const gm = node.name.match(/^gun_(\d+)/)
      const tm = node.name.match(/^turret_(\d+)$/)
      if (gm) node.visible = activeGun != null && parseInt(gm[1], 10) !== activeGun ? false : node.visible
      else if (tm) node.visible = activeTurret != null && parseInt(tm[1], 10) !== activeTurret ? false : node.visible
    })
    convertFaceNormals(chassis, ownedGeometries)
    chassis.updateMatrixWorld(true)
    const hasMask = hasGunMask(config)
    meshes.push(...tagModuleMeshes(chassis, (section, id) => plateThickness(tank, config, section, id))
      .filter(mesh => {
        const section = mesh.userData.armorSection
        if (section !== 'chassis' && section !== 'gunBarrel') return false
        if (mesh.userData.gunMaskPart && !hasMask) return false
        // 组被配置可见性隐藏的网格不再上屏
        for (let parent: THREE.Object3D | null = mesh; parent; parent = parent.parent) {
          if (parent.visible === false) return false
        }
        return true
      }))
  }
  if (!meshes.length) throw new Error('No armor plates for selected configuration')

  const scene = new THREE.Scene()
  const objects = new THREE.Group()
  const materials: THREE.Material[] = []

  let matched = 0
  const anchors: Array<{
    key: string; samples: SurfaceSample[]; object: THREE.Mesh
    left: number | null; right: number | null
    kind: string | null; plate: string; module: string
  }> = []
  for (const mesh of meshes) {
    // 直接突出板面，厚度仍由同一套调色板表达。
    const sourceGeometry = mesh.geometry
    useFaceNormals(mesh)
    if (mesh.geometry !== sourceGeometry) ownedGeometries.push(mesh.geometry)
    const section = mesh.userData.armorSectionOrig ?? mesh.userData.armorSection
    const key = armorPlateKey(section, mesh.userData.armorPlateId)
    const marked = choice.highlights[side].has(key)
    const isModule = !mesh.userData.armorSectionOrig
    const material = new THREE.MeshBasicMaterial({
      color: thicknessToColor(mesh.userData.armorThickness),
      toneMapped: false,
      side: mesh.userData.armorSection === 'spaced' ? THREE.DoubleSide : THREE.FrontSide,
    })
    materials.push(material)
    const plate = new THREE.Mesh(mesh.geometry, material)
    plate.userData.armorThickness = mesh.userData.armorThickness
    plate.userData.armorKey = key
    plate.userData.armorChanged = marked
    plate.userData.armorModule = isModule
    plate.userData.armorSection = mesh.userData.armorSection
    plate.userData.armorSectionOrig = mesh.userData.armorSectionOrig
    plate.userData.armorPlateId = mesh.userData.armorPlateId
    plate.matrix.copy(mesh.matrixWorld)
    plate.matrixAutoUpdate = false
    objects.add(plate)
    if (!marked) continue
    matched++
    // 每一块改动的装甲面都给旁注锚点（板件表面采样点）。
    anchors.push({
      key,
      samples: sampleSurfacePoints(plate, plate.matrix),
      object: plate,
      left: choice.changes.get(key)?.left ?? null,
      right: choice.changes.get(key)?.right ?? null,
      kind: choice.changes.get(key)?.kind ?? null,
      plate: String(mesh.userData.armorPlateId),
      module: String(section),
    })
  }
  scene.add(objects)
  applyArmorComparisonFocus(objects.children, null)
  return {
    scene, plates: objects.children, bounds: new THREE.Box3().setFromObject(objects), matched, anchors,
    gunLine: pivots.gun.z,
    dispose() {
      for (const geometry of ownedGeometries) geometry.dispose()
      for (const material of materials) material.dispose()
    },
  }
}

