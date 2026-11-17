// 共面水面合并 / 显示去重（2026-11-17 用户报"较远处移动视角水面闪烁"）。
//
// 两个层次的问题，都在这里收口：
// 1) **显示重复**：客户端场景里 6 张图的 `WaterRenderObject` 各有 2 个 render batch，
//    是同一水面的两套三角化（材质逐键相同；实测一块的顶点 100% 落在另一块的三角化
//    内/边界，覆盖面积是超集）。导出按"原样"保留两套数据（用户 2026-11-17 决定），
//    但显示端只画覆盖更大的那块：两层共面透明水面若都画，同一像素有时混合 1 次、
//    有时 2 次（两层深度仅差 ~1e-5 m，深度量化边界随相机移动漂移）⇒ 逐像素闪烁。
// 2) **透明排序**：同材质但互不包含的水面网格各自是一个透明排序单位，three 按物体
//    中心距离排序，相机移动时顺序互换。合并成**一个 draw** 后三角形提交顺序由索引
//    缓冲固定，不再随相机翻转。
//
// 判据全部是**精确几何包含**（顶点落在另一块三角化内或边界 1e-4 m 内，且覆盖面积不
// 更大），不做任何内容统计/亮度阈值；无包含关系的水面（不同水体/不同材质）保持原样。
// 只处理 `ShaderMaterial` 且 `userData.water=true` 且材质实例相同的水面网格。
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface WaterMergeResult {
  /** 参与处理的材质组数（组内水面网格 ≥2） */
  groups: number
  /** 被合并掉的原始网格数 */
  merged: number
  /** 作为重复覆盖被隐藏的网格数（不参与合并，直接从场景移除） */
  dropped: number
  /** 合并失败的材质组（保留原网格；fail-closed） */
  failed: number
}

const KEEP_ATTRS = new Set(['position', 'normal', 'uv'])
const CONTAIN_EPS = 1e-4 // m：共享边界顶点的浮点容差

type Vec2 = readonly [number, number]

interface WaterPart {
  mesh: THREE.Mesh
  /** 世界变换已烘焙的几何（准备合并） */
  geo: THREE.BufferGeometry
  /** 导出坐标系水平面 (x,y) 的三角形（水面是水平面；点/面积都按 2D 判） */
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

/** 点是否在三角形内或边上（eps 只吸收共享边界顶点的浮点误差）。 */
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
    // 世界坐标 → 水面平面 (x, y)。合并发生在 gltf.scene 仍处于导出坐标系时
    // （水平面 = XY，Z 为高度；mapScenery 的 Y-up 旋转在其后才挂上）。
    const a: Vec2 = [pos.getX(i0), pos.getY(i0)]
    const b: Vec2 = [pos.getX(i1), pos.getY(i1)]
    const c: Vec2 = [pos.getX(i2), pos.getY(i2)]
    tris.push([a, b, c])
    area += triArea2D(a, b, c)
  }
  return { tris, area }
}

/** 返回应隐藏的下标：某块的全部顶点都落在另一块（面积不小于自己）的三角化内。 */
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
    // 先烘焙世界变换并分析覆盖：同一水面的重复三角化只保留覆盖超集（用户口径：
    // 数据原样导出，显示端只画一个）。
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
      // 只留下一块：无需合并（原网格保持原变换即可），克隆几何释放。
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
    // 装配段给水面分配的固定顺序带从 10 起；合并网格继承该带起点（透明队列先按
    // renderOrder 排序），保证与其余不同材质的水面之间顺序也稳定。
    out.renderOrder = 10
    root.add(out)
    for (const part of kept) {
      if (part.mesh.parent) part.mesh.parent.remove(part.mesh)
    }
    merged += kept.length
  }
  if (merged > 0 || dropped > 0) {
    // 原几何若不再被任何网格引用则释放；仍被引用的（同几何多节点）保持不动。
    const inUse = new Set<THREE.BufferGeometry>()
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh && mesh.geometry) inUse.add(mesh.geometry)
    })
    for (const g of sourceGeometries) if (!inUse.has(g)) g.dispose()
  }
  return { groups, merged, dropped, failed }
}
