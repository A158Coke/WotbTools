import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface WaterMergeResult {
  groups: number
  merged: number
  dropped: number
  failed: number
}

const KEEP_ATTRS = new Set(['position', 'normal', 'uv'])
const CONTAIN_EPS = 1e-4

type Vec2 = readonly [number, number]

interface WaterPart {
  mesh: THREE.Mesh
  geo: THREE.BufferGeometry
  tris: Array<readonly [Vec2, Vec2, Vec2]>
  area: number
}

function segDist2D(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0
    ? 0
    : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function pointInTri2D(p: Vec2, a: Vec2, b: Vec2, c: Vec2, eps = CONTAIN_EPS): boolean {
  const cross = (o: Vec2, u: Vec2, v: Vec2) =>
    (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0])
  const d1 = cross(a, b, p)
  const d2 = cross(b, c, p)
  const d3 = cross(c, a, p)
  if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) return true
  return Math.min(segDist2D(p, a, b), segDist2D(p, b, c), segDist2D(p, c, a)) <= eps
}

function triArea2D(a: Vec2, b: Vec2, c: Vec2): number {
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
}

function analyzeGeometry(geo: THREE.BufferGeometry): { tris: Array<readonly [Vec2, Vec2, Vec2]>; area: number } {
  const pos = geo.getAttribute('position')
  if (!pos) return { tris: [], area: 0 }
  const index = geo.getIndex()
  const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3)
  const tris: Array<readonly [Vec2, Vec2, Vec2]> = []
  let area = 0
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
    const a: Vec2 = [pos.getX(i0), pos.getY(i0)]
    const b: Vec2 = [pos.getX(i1), pos.getY(i1)]
    const c: Vec2 = [pos.getX(i2), pos.getY(i2)]
    tris.push([a, b, c])
    area += triArea2D(a, b, c)
  }
  return { tris, area }
}

function selectContainedParts(parts: WaterPart[]): Set<number> {
  const order = parts
    .map((p, i) => ({ i, area: p.area }))
    .sort((a, b) => (b.area - a.area) || (a.i - b.i))
  const kept: number[] = []
  const drop = new Set<number>()
  for (const { i } of order) {
    const b = parts[i]
    let covered = false
    for (const j of kept) {
      const a = parts[j]
      if (a.area + 1e-6 < b.area) continue
      const pos = b.geo.getAttribute('position')!
      let inside = true
      for (let v = 0; v < pos.count && inside; v++) {
        const p: Vec2 = [pos.getX(v), pos.getY(v)]
        inside = a.tris.some((tri) => pointInTri2D(p, tri[0], tri[1], tri[2]))
      }
      if (inside) { covered = true; break }
    }
    if (covered) drop.add(i)
    else kept.push(i)
  }
  return drop
}

export function mergeCoincidentWaterMeshes(root: THREE.Object3D): WaterMergeResult {
  root.updateMatrixWorld(true)
  const byMaterial = new Map<THREE.Material, THREE.Mesh[]>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
      | (THREE.Material & { userData?: { water?: boolean } })
      | undefined
    if (!mat || !mat.userData || !mat.userData.water) return
    const list = byMaterial.get(mat) || []
    list.push(mesh)
    byMaterial.set(mat, list)
  })
  const sourceGeometries = new Set<THREE.BufferGeometry>()
  for (const list of byMaterial.values()) for (const m of list) sourceGeometries.add(m.geometry)
  let groups = 0
  let merged = 0
  let dropped = 0
  let failed = 0
  for (const [material, meshes] of byMaterial) {
    if (meshes.length < 2) continue
    groups++
    const parts: WaterPart[] = meshes.map((mesh) => {
      const geo = mesh.geometry.clone()
      geo.applyMatrix4(mesh.matrixWorld)
      for (const name of Object.keys(geo.attributes)) {
        if (!KEEP_ATTRS.has(name)) geo.deleteAttribute(name)
      }
      if (!geo.getAttribute('normal')) geo.computeVertexNormals()
      if (!geo.getAttribute('uv')) {
        const count = geo.getAttribute('position').count
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(count * 2).fill(0), 2))
      }
      const { tris, area } = analyzeGeometry(geo)
      return { mesh, geo, tris, area }
    })
    const dropIdx = selectContainedParts(parts)
    const kept: WaterPart[] = []
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (dropIdx.has(i)) {
        dropped++
        if (part.mesh.parent) part.mesh.parent.remove(part.mesh)
      } else {
        kept.push(part)
      }
    }
    if (kept.length < 2) {
      for (const part of kept) part.geo.dispose()
      continue
    }
    const mergedGeo = mergeGeometries(kept.map((p) => p.geo), false)
    for (const p of kept) p.geo.dispose()
    if (!mergedGeo) {
      failed++
      continue
    }
    const out = new THREE.Mesh(mergedGeo, material)
    out.name = 'water_merged'
    out.userData.annotationSurface = false
    out.renderOrder = 10
    root.add(out)
    for (const part of kept) {
      if (part.mesh.parent) part.mesh.parent.remove(part.mesh)
    }
    merged += kept.length
  }
  if (merged > 0 || dropped > 0) {
    const inUse = new Set<THREE.BufferGeometry>()
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh && mesh.geometry) inUse.add(mesh.geometry)
    })
    for (const g of sourceGeometries) if (!inUse.has(g)) g.dispose()
  }
  return { groups, merged, dropped, failed }
}
