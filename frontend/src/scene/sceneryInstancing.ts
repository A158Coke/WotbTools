import * as THREE from 'three'
import type { BufferGeometry, InstancedMesh, Material, Matrix4, Mesh, Object3D, Sphere, Vector3 } from 'three'

export interface InstanceEntry {
  node: Mesh
  name: string
  geometry: BufferGeometry
  material: Material
  matrix: Matrix4
  x: number
  y: number
  z: number
  lm: number[] | null
}

export function hasTransparentMaterial(material: Material | Material[] | null | undefined): boolean {
  const ms = Array.isArray(material) ? material : [material]
  return ms.some((m) => !!(m && m.transparent))
}

const MATERIAL_SIGNATURE_FIELDS: ReadonlyArray<string> = Object.freeze([
  'type', 'map', 'lightMap', 'aoMap', 'alphaMap', 'normalMap', 'emissiveMap', 'envMap',
  'color', 'emissive', 'specular', 'shininess', 'roughness', 'metalness',
  'opacity', 'transparent', 'alphaTest', 'side', 'vertexColors', 'flatShading',
  'blending', 'depthWrite', 'depthTest', 'wireframe',
  'premultipliedAlpha', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits',
])

const RENDER_STATE_FIELDS: ReadonlyArray<string> = Object.freeze([
  'transparent', 'opacity', 'alphaTest', 'side', 'blending', 'vertexColors', 'flatShading',
  'depthWrite', 'depthTest', 'colorWrite', 'premultipliedAlpha',
  'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits',
  'visible',
])

function materialProp(m: Material, key: string): unknown {
  return Reflect.get(m, key)
}

function colorSignature(color: { r: number, g: number, b: number }): string {
  return `c:${color.r.toFixed(6)},${color.g.toFixed(6)},${color.b.toFixed(6)}`
}

function definesSignature(m: Material): string {
  const defines = materialProp(m, 'defines')
  if (!defines || typeof defines !== 'object') return '-'
  const record = defines as Record<string, unknown>
  return Object.keys(record).sort().map((k) => `${k}=${String(record[k])}`).join(',')
}

function renderStateSignature(m: Material): string {
  return RENDER_STATE_FIELDS.map((f) => `${f}=${materialSignatureValue(m, f)}`).join(',')
}

function annotationPolicySignature(m: Material): string {
  const userData = materialProp(m, 'userData')
  const policy = userData && typeof userData === 'object'
    ? (userData as { annotationSurface?: unknown }).annotationSurface
    : undefined
  return policy === false ? 'annotation:false' : 'annotation:true'
}

function materialSignatureValue(m: Material, field: string): string {
  const value = materialProp(m, field)
  if (value == null) return '-'
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return String(value)
  if (typeof value === 'object' && 'uuid' in (value as object)) return `tex:${(value as { uuid: string }).uuid}`
  if (typeof value === 'object' && (value as { isColor?: boolean }).isColor === true) {
    return colorSignature(value as { r: number, g: number, b: number })
  }
  return String(value)
}

function uniformValueSignature(value: unknown): string {
  if (value == null) return 'null'
  const v = value as Record<string, unknown>
  if (v.isTexture === true) return `tex:${String(v.uuid)}`
  if (v.isColor === true) return colorSignature(value as { r: number, g: number, b: number })
  if (v.isVector2 === true || v.isVector3 === true || v.isVector4 === true) {
    return `v:${(value as { toArray?(): number[] }).toArray?.().join(',') ?? String(value)}`
  }
  if (v.isMatrix3 === true || v.isMatrix4 === true) {
    return `m:${Array.from((value as { elements: number[] }).elements).join(',')}`
  }
  if (Array.isArray(value)) return `a:${value.join(',')}`
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return String(value)
  return `opaque:${String(value)}`
}

const DEFAULT_ON_BEFORE_COMPILE = THREE.Material.prototype.onBeforeCompile

function hasCustomProgramHook(m: Material): boolean {
  const hook = materialProp(m, 'onBeforeCompile')
  return typeof hook === 'function' && hook !== DEFAULT_ON_BEFORE_COMPILE
}

function shaderMaterialSignature(m: Material): string | null {
  const uniforms = materialProp(m, 'uniforms')
  if (!uniforms || typeof uniforms !== 'object') return null
  const parts = [
    'shader',
    String(materialProp(m, 'vertexShader') ?? ''),
    String(materialProp(m, 'fragmentShader') ?? ''),
    `defines:${definesSignature(m)}`,
    `state:${renderStateSignature(m)}`,
    annotationPolicySignature(m),
  ]
  for (const name of Object.keys(uniforms as Record<string, unknown>).sort()) {
    const uniform = (uniforms as Record<string, { value?: unknown } | undefined>)[name]
    parts.push(`${name}=${uniformValueSignature(uniform?.value)}`)
  }
  return parts.join('|')
}

function materialSignature(m: Material | Material[]): string | null {
  if (Array.isArray(m)) return null
  if (hasCustomProgramHook(m)) return null
  const uniforms = materialProp(m, 'uniforms')
  if (uniforms && typeof uniforms === 'object') return shaderMaterialSignature(m)
  return [...MATERIAL_SIGNATURE_FIELDS.map((f) => materialSignatureValue(m, f)),
    `defines:${definesSignature(m)}`, annotationPolicySignature(m)].join('|')
}

export function canonicalizeEntryMaterials<T extends { material: Material | Material[] }>(entries: T[]): T[] {
  const byKey = new Map<string, Material>()
  for (const e of entries) {
    const key = materialSignature(e.material)
    if (key === null) continue
    const rep = byKey.get(key)
    if (rep === undefined) { byKey.set(key, e.material as Material); continue }
    if (rep !== e.material) e.material = rep
  }
  return entries
}

export function collectInstanceEntries(root: Object3D): InstanceEntry[] {
  const out: InstanceEntry[] = []
  const stack: Array<{ node: Object3D; parent: Matrix4 }> = [{ node: root, parent: new THREE.Matrix4() }]
  while (stack.length) {
    const top = stack.pop()
    if (!top) break
    const { node, parent } = top
    if (node.matrixAutoUpdate) node.updateMatrix()
    const world = parent.clone().multiply(node.matrix)
    for (const child of node.children) stack.push({ node: child, parent: world })
    const mesh = node as Mesh
    if (!mesh.isMesh || !mesh.geometry) continue
    const e = world.elements
    out.push({
      node: mesh,
      name: mesh.name || '',
      geometry: mesh.geometry,
      material: mesh.material as Material,
      matrix: world,
      x: e[12], y: e[13], z: e[14],
      lm: (mesh.userData && Array.isArray(mesh.userData.lm)) ? mesh.userData.lm : null,
    })
  }
  return out
}

function combineSparseRegions(
  batches: Iterable<InstanceEntry[]>, regionSize: number, trisEach: number, maxTris: number, minBatches: number,
): InstanceEntry[][] {
  const regions = new Map<string, InstanceEntry[][]>()
  for (const batch of batches) {
    const key = Math.floor(batch[0].x / regionSize) + ',' + Math.floor(batch[0].y / regionSize)
    const region = regions.get(key)
    if (region) region.push(batch)
    else regions.set(key, [batch])
  }
  const out: InstanceEntry[][] = []
  for (const region of regions.values()) {
    const count = region.reduce((sum, batch) => sum + batch.length, 0)
    if (region.length >= minBatches && trisEach * count <= maxTris) {
      out.push(region.flat())
    } else {
      for (const batch of region) out.push(batch)
    }
  }
  return out
}

export interface InstanceBatch {
  geometry: BufferGeometry
  material: Material
  items: InstanceEntry[]
}

export const SCENERY_COLLAPSE_MAX_TRIS = 20000

function geometryTriCount(geometry: BufferGeometry): number {
  const idx = geometry.index
  if (idx) return idx.count / 3
  const pos = geometry.attributes?.position
  return pos ? pos.count / 3 : 0
}

export function groupInstanceBatches(
  entries: readonly InstanceEntry[],
  cellSize = Infinity,
  opts: { maxCollapseTris?: number } = {},
): InstanceBatch[] {
  const maxCollapseTris = opts.maxCollapseTris ?? SCENERY_COLLAPSE_MAX_TRIS
  const out: InstanceBatch[] = []
  const byGeoMat = new Map<string, { geometry: BufferGeometry; material: Material; cells: Map<string, InstanceEntry[]> }>()
  for (const e of entries) {
    const gk = `${e.geometry.uuid}|${e.material.uuid}`
    let g = byGeoMat.get(gk)
    if (!g) {
      g = { geometry: e.geometry, material: e.material, cells: new Map() }
      byGeoMat.set(gk, g)
    }
    const cx = cellSize === Infinity ? 0 : Math.floor(e.x / cellSize)
    const cy = cellSize === Infinity ? 0 : Math.floor(e.y / cellSize)
    const ck = `${cx},${cy}`
    let items = g.cells.get(ck)
    if (!items) { items = []; g.cells.set(ck, items) }
    items.push(e)
  }
  for (const g of byGeoMat.values()) {
    if (maxCollapseTris > 0 && g.cells.size > 1) {
      const trisEach = geometryTriCount(g.geometry)
      let total = 0
      for (const items of g.cells.values()) total += items.length
      if (trisEach * total <= maxCollapseTris) {
        const items: InstanceEntry[] = []
        for (const cell of g.cells.values()) items.push(...cell)
        out.push({ geometry: g.geometry, material: g.material, items })
        continue
      }
      const pairs = combineSparseRegions(g.cells.values(), cellSize * 2, trisEach, maxCollapseTris, 2)
      for (const items of combineSparseRegions(pairs, cellSize * 4, trisEach, maxCollapseTris, 3)) {
        out.push({ geometry: g.geometry, material: g.material, items })
      }
      continue
    }
    for (const items of g.cells.values()) {
      out.push({ geometry: g.geometry, material: g.material, items })
    }
  }
  return out
}

export function buildInstancedMesh(batch: InstanceBatch): InstancedMesh {
  const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.items.length)
  if (batch.items.some((it) => it.lm)) {
    const arr = new Float32Array(batch.items.length * 4)
    batch.items.forEach((it, i) => {
      const v = it.lm || [1, 1, 0, 0]
      arr[i * 4] = v[0]; arr[i * 4 + 1] = v[1]; arr[i * 4 + 2] = v[2]; arr[i * 4 + 3] = v[3]
    })
    const attr = new THREE.InstancedBufferAttribute(arr, 4)
    attr.setUsage(THREE.StaticDrawUsage)
    const g = new THREE.BufferGeometry()
    for (const name in batch.geometry.attributes) g.setAttribute(name, batch.geometry.attributes[name])
    if (batch.geometry.index) g.setIndex(batch.geometry.index)
    g.setAttribute('aLm', attr)
    mesh.geometry = g
    mesh.userData.lmInstances = batch.items.length
  }
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  batch.items.forEach((it, i) => mesh.setMatrixAt(i, it.matrix))
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  mesh.matrixAutoUpdate = false
  return mesh
}

/**
 * 不可合批（透明排序/单独节点）但带逐节点光照图变换的网格：用**单实例 InstancedMesh**
 * 承载。这样既保留"一个 object 一个透明排序单位"，又复用 buildInstancedMesh 的 aLm
 * 逐实例 UV 变换（否则非实例路径按原始 uv1 采样，会读错 atlas 区域）。
 * @returns {entry, mesh} 列表（单实例 InstancedMesh 与其来源 entry）
 */
export function buildStandaloneLightmappedMeshes(entries: readonly InstanceEntry[], target: Object3D): Array<{ entry: InstanceEntry; mesh: InstancedMesh }> {
  const out: Array<{ entry: InstanceEntry; mesh: InstancedMesh }> = []
  for (const e of entries) {
    if (!e || !e.lm || !e.geometry || !e.material) continue
    const mesh = buildInstancedMesh({ geometry: e.geometry, material: e.material, items: [e] })
    target.add(mesh)
    e.node.removeFromParent()
    out.push({ entry: e, mesh })
  }
  return out
}

export function writeHiddenInstance(mesh: InstancedMesh, idx: number): void {
  _m.compose(_hiddenPos, _idQ, _tinyScale)
  mesh.setMatrixAt(idx, _m)
}

const _m = new THREE.Matrix4()
const _hiddenPos = new THREE.Vector3(0, -1e6, 0)
const _idQ = new THREE.Quaternion()
const _tinyScale = new THREE.Vector3(1e-6, 1e-6, 1e-6)

export function fallMatrix(base: Matrix4, pivotX: number, pivotY: number, pivotZ: number, axis: Vector3, angle: number, out: Matrix4): Matrix4 {
  _t1.makeTranslation(-pivotX, -pivotY, -pivotZ)
  _t2.makeTranslation(pivotX, pivotY, pivotZ)
  _r.makeRotationAxis(axis, angle)
  return out.copy(_t2).multiply(_r).multiply(_t1).multiply(base)
}
const _t1 = new THREE.Matrix4()
const _t2 = new THREE.Matrix4()
const _r = new THREE.Matrix4()

export function refreshBatchSphere(
  mesh: InstancedMesh,
  batch: Pick<InstanceBatch, 'geometry' | 'items'>,
  isHidden?: (it: InstanceEntry) => boolean,
): Sphere {
  const sph = new THREE.Sphere()
  sph.makeEmpty()
  if (!batch.geometry.boundingSphere) batch.geometry.computeBoundingSphere()
  if (!batch.geometry.boundingBox) batch.geometry.computeBoundingBox()
  const geoSphere = batch.geometry.boundingSphere as Sphere
  const box = new THREE.Box3()
  box.makeEmpty()
  const m = new THREE.Matrix4()
  const tmp = new THREE.Sphere()
  const tmpBox = new THREE.Box3()
  batch.items.forEach((it, i) => {
    if (isHidden && isHidden(it)) m.copy(it.matrix)
    else mesh.getMatrixAt(i, m)
    tmp.copy(geoSphere).applyMatrix4(m)
    sph.union(tmp)
    tmpBox.copy(batch.geometry.boundingBox as THREE.Box3).applyMatrix4(m)
    box.union(tmpBox)
  })
  if (mesh.boundingSphere) mesh.boundingSphere.copy(sph)
  else mesh.boundingSphere = sph
  if (mesh.userData.occluderBox) mesh.userData.occluderBox.copy(box)
  else mesh.userData.occluderBox = box
  return mesh.boundingSphere
}
