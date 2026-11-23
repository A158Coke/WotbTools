// 3D 快捷标记的扇区/环形几何（从 markerRuntime.ts 拆出，2026-11-20 行数预算 500）：
// 扇区矩形（语义档案九宫格聚合）、扇区面/描边带几何、目标光环贴地重摆。
// 坐标系：游戏/回放系 → 场景系 x 取负（battleRuntime / vehicleRuntime / bases 同一镜像规则）。
import * as THREE from 'three'
import type { BufferGeometry } from 'three'
import { mapGridProfile } from '../../data/mapSemantics.js'

const SECTOR_LIFT = 0.6
const SECTOR_BORDER_LIFT = 0.7
const SECTOR_BORDER_WIDTH = 2.5

export interface MarkerSectorRect {
  xMin: number
  zMin: number
  xMax: number
  zMax: number
}

/** 语义档案扇区面（toMapOverview 的 MapGridCell 消费面）。 */
export interface SectorGridCell {
  nineGridRegion?: number
  bounds?: { xMin: number; yMin: number; xMax: number; yMax: number } | null
}

/**
 * 区域矩形 = 该 nineGridRegion 全部单元 bounds 的并集（语义系：x = 回放 x，y = 回放 z）。
 * 与 MapOverview.vue gridRegions computed 同一聚合口径；无格 / 脏值 fail-closed 返回 null。
 */
export function sectorRectFromCells(cells: readonly SectorGridCell[] | null | undefined, region: number): MarkerSectorRect | null {
  if (!Array.isArray(cells) || !Number.isInteger(region)) return null
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
  for (const cell of cells) {
    if (!cell || cell.nineGridRegion !== region) continue
    const b = cell.bounds
    if (!b || ![b.xMin, b.yMin, b.xMax, b.yMax].every((v) => Number.isFinite(v))) continue
    xMin = Math.min(xMin, b.xMin); yMin = Math.min(yMin, b.yMin)
    xMax = Math.max(xMax, b.xMax); yMax = Math.max(yMax, b.yMax)
  }
  if (xMin > xMax || yMin > yMax) return null
  // 语义系 → 场景系：x 取负（xMin/xMax 互换），z = 语义 y 原样；+0 归一（镜像 0 会得 -0）
  return { xMin: -xMax + 0, zMin: yMin + 0, xMax: -xMin + 0, zMax: yMax + 0 }
}

/** 按资产面地图 key 取语义档案的扇区矩形（缺档 fail-closed → null，不猜坐标）。 */
export function sectorRectForMapKey(mapKey: string | null | undefined, region: number): MarkerSectorRect | null {
  const profile = mapKey ? mapGridProfile(mapKey) : null
  if (!profile) return null
  return sectorRectFromCells(profile.gridCells, region)
}


export function sectorQuadGeometry(groundY: (x: number, z: number) => number, rect: MarkerSectorRect, grid = 4): BufferGeometry {
  const n = grid + 1
  const pos = new Float32Array(n * n * 3)
  const idx: number[] = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j
      const x = rect.xMin + ((rect.xMax - rect.xMin) * j) / grid
      const z = rect.zMin + ((rect.zMax - rect.zMin) * i) / grid
      pos[k * 3] = x; pos[k * 3 + 1] = groundY(x, z) + SECTOR_LIFT; pos[k * 3 + 2] = z
    }
  }
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const a = i * n + j, b = a + 1, c = a + n, d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setIndex(idx)
  return geo
}

/**
 * 扇区描边带（四条贴地 ribbon，宽 SECTOR_BORDER_WIDTH，沿周界 8 点/边采样地形高度）。
 * LineLoop 在 WebGL 恒为 1px——远观几乎不可见；描边带与基地环带同一「逐顶点贴地 +
 * 双侧偏移」结构，起伏地形上也能勾勒出清晰区域边界。
 */
export function sectorBorderGeometry(groundY: (x: number, z: number) => number, rect: MarkerSectorRect, perEdge = 8): BufferGeometry {
  const corners: Array<[number, number]> = [
    [rect.xMin, rect.zMin], [rect.xMax, rect.zMin], [rect.xMax, rect.zMax], [rect.xMin, rect.zMax],
  ]
  const half = SECTOR_BORDER_WIDTH / 2
  const pos: number[] = []
  const idx: number[] = []
  let base = 0
  for (let e = 0; e < 4; e++) {
    const [ax, az] = corners[e], [bx, bz] = corners[(e + 1) % 4]
    const dx = bx - ax, dz = bz - az
    const len = Math.hypot(dx, dz) || 1
    const nx = (-dz / len) * half, nz = (dx / len) * half   // 边界外法线方向（逆时针周界的左侧）
    for (let i = 0; i < perEdge; i++) {
      const f0 = i / perEdge, f1 = (i + 1) / perEdge
      const x0 = ax + dx * f0, z0 = az + dz * f0
      const x1 = ax + dx * f1, z1 = az + dz * f1
      // 每段 4 顶点：两端各内/外侧一点，高度各自贴地
      pos.push(x0 - nx, groundY(x0 - nx, z0 - nz) + SECTOR_BORDER_LIFT, z0 - nz)
      pos.push(x0 + nx, groundY(x0 + nx, z0 + nz) + SECTOR_BORDER_LIFT, z0 + nz)
      pos.push(x1 - nx, groundY(x1 - nx, z1 - nz) + SECTOR_BORDER_LIFT, z1 - nz)
      pos.push(x1 + nx, groundY(x1 + nx, z1 + nz) + SECTOR_BORDER_LIFT, z1 + nz)
      const a = base + i * 4
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2)
    }
    base += perEdge * 4
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
  geo.setIndex(idx)
  return geo
}

/**
 * 就地重摆贴地环带顶点（与 bases.makeGroundedRing 同一布局：(seg+1)*2 顶点，外圈 r /
 * 内圈 0.9r，高度 +0.08）——目标光环逐帧跟随车辆时避免逐帧重建 geometry。
 */
export function regroundRingInPlace(geo: BufferGeometry, groundY: (x: number, z: number) => number, cx: number, cz: number, radius: number, seg: number): void {
  const attr = geo.getAttribute('position') as THREE.BufferAttribute | null
  if (!attr || attr.count !== (seg + 1) * 2) return
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2
    const ca = Math.cos(a), sa = Math.sin(a)
    const xo = cx + ca * radius, zo = cz + sa * radius
    const xi = cx + ca * radius * 0.9, zi = cz + sa * radius * 0.9
    attr.setXYZ(i * 2, xo, groundY(xo, zo) + 0.08, zo)
    attr.setXYZ(i * 2 + 1, xi, groundY(xi, zi) + 0.08, zi)
  }
  attr.needsUpdate = true
  // 世界坐标顶点原地改写：包围球必须同步重算——THREE 的视锥剔除首次绘制后缓存
  // geometry.boundingSphere，mesh 自身不移动时永远用初始球（评审 P2：光环随旧位置
  // 出视锥而消失）。环带仅 2×(seg+1) 顶点，逐帧重算成本可忽略。
  geo.computeBoundingSphere()
}

