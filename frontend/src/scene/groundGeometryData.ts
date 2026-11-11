// 地形几何**纯数据阶段**（无 THREE 依赖）：自适应细分 + 底图 UV + 顶点法线 + 包围球。
// 独立成模块的原因：地形 LOD 重建在 Worker 里跑（playback/terrainBuild.worker.ts），Worker 不能把整个
// three 打进来；groundPass.js 再导出本模块，主线程/烘焙脚本的调用面不变。
import { buildAdaptiveTerrain, groundMapUv } from './terrainMesh.js';

/** 地形几何**纯数据阶段**（无 THREE 依赖，可在 Worker 里跑）：自适应细分 + 底图 UV + 顶点法线 + 包围球。
 *  产出全是 TypedArray / 纯对象，调用方可把 `transferables(data)` 作为 Transferable 回传。
 *  法线是 `BufferGeometry.computeVertexNormals`（带索引分支）的**逐步等价**实现：面法线 =
 *  (C−B)×(A−B)，按面积加权累加进 Float32 数组（每步 float32 舍入，与 three 一致），最后逐点归一，
 *  因此与同步路径逐字节相等（见 groundPass.test.js）。包围球同理等价 `computeBoundingSphere`。
 *  @param {boolean} [measure] true 时填 `diagnostics` 分段耗时 */
export interface GroundGeometryDataArgs {
  field: Float32Array | null
  n: number
  span: number
  cam: { x: number; y: number; z: number }
  fovY: number
  aspect?: number
  hFovDeg?: number | null
  refineMask?: unknown
  cx?: number
  cz?: number
  measure?: boolean
}
export interface GroundGeometryData {
  positions: Float32Array
  uvs: Float32Array
  normals: Float32Array
  indices: Uint16Array | Uint32Array
  boundingSphere: { center: number[]; radius: number }
  terrainBuild: Record<string, unknown>
  diagnostics: Record<string, unknown> | null
}

export function buildGroundGeometryData({
  field, n, span, cam, fovY, aspect = 16 / 9, hFovDeg = null, refineMask = null, cx = 0, cz = 0,
  measure = false,
}: GroundGeometryDataArgs): GroundGeometryData {
  let start = measure ? performance.now() : 0;
  const { positions, indices, sizeAt, originIAt, originJAt, vertexIndexAt, morphRaw, quads, overBudget } = buildAdaptiveTerrain({
    field, n, span, cam, fovY, aspect, hFovDeg, refineMask,
  } as Parameters<typeof buildAdaptiveTerrain>[0]);
  const adaptiveMs = measure ? performance.now() - start : 0;
  if (measure) start = performance.now();
  // 底图 UV：回退档（无分层）把 `ground.webp` 直接摊在地形上——分层着色的 UV 在
  // 片元由世界坐标反推，但回退材质吃几何 `uv`，缺了整张图退化成单 texel 常量（2026-10-10 review P1）
  const uvs = groundMapUv(positions, span, cx, cz);
  const assemblyMs = measure ? performance.now() - start : 0;
  if (measure) start = performance.now();
  const normals = computeIndexedVertexNormals(positions, indices);
  const normalsMs = measure ? performance.now() - start : 0;
  if (measure) start = performance.now();
  const boundingSphere = computeBoundingSphereData(positions);
  const boundsMs = measure ? performance.now() - start : 0;
  return {
    positions, uvs, normals, indices, boundingSphere,
    terrainBuild: { positions, sizeAt, originIAt, originJAt, vertexIndexAt, morphRaw, quads, overBudget, n, span },
    diagnostics: measure
      ? { adaptiveMs, assemblyMs, normalsMs, boundsMs, vertices: positions.length / 3, triangles: indices.length / 3, overBudget }
      : null,
  };
}

/** three `computeVertexNormals`（indexed）的逐步等价：float32 累加 → 逐点归一。 */
function computeIndexedVertexNormals(positions: Float32Array, indices: ArrayLike<number>): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0, il = indices.length; i < il; i += 3) {
    const vA = indices[i] * 3, vB = indices[i + 1] * 3, vC = indices[i + 2] * 3;
    const ax = positions[vA], ay = positions[vA + 1], az = positions[vA + 2];
    const bx = positions[vB], by = positions[vB + 1], bz = positions[vB + 2];
    const cx = positions[vC], cy = positions[vC + 1], cz = positions[vC + 2];
    const cbx = cx - bx, cby = cy - by, cbz = cz - bz;
    const abx = ax - bx, aby = ay - by, abz = az - bz;
    // cb = cb × ab（three: cb.cross(ab)）
    const nx = cby * abz - cbz * aby;
    const ny = cbz * abx - cbx * abz;
    const nz = cbx * aby - cby * abx;
    normals[vA] = normals[vA] + nx; normals[vA + 1] = normals[vA + 1] + ny; normals[vA + 2] = normals[vA + 2] + nz;
    normals[vB] = normals[vB] + nx; normals[vB + 1] = normals[vB + 1] + ny; normals[vB + 2] = normals[vB + 2] + nz;
    normals[vC] = normals[vC] + nx; normals[vC + 1] = normals[vC + 1] + ny; normals[vC + 2] = normals[vC + 2] + nz;
  }
  for (let i = 0, il = normals.length; i < il; i += 3) {
    const x = normals[i], y = normals[i + 1], z = normals[i + 2];
    const inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    normals[i] = x * inv; normals[i + 1] = y * inv; normals[i + 2] = z * inv;
  }
  return normals;
}

/** three `computeBoundingSphere` 的逐步等价：包围盒中心 + 到各点最大距离。 */
function computeBoundingSphereData(positions: Float32Array): { center: number[]; radius: number } {
  const count = positions.length;
  if (!count) return { center: [0, 0, 0], radius: 0 };
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }
  const ccx = (minX + maxX) * 0.5, ccy = (minY + maxY) * 0.5, ccz = (minZ + maxZ) * 0.5;
  let maxRadiusSq = 0;
  for (let i = 0; i < count; i += 3) {
    const dx = positions[i] - ccx, dy = positions[i + 1] - ccy, dz = positions[i + 2] - ccz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > maxRadiusSq) maxRadiusSq = d;
  }
  return { center: [ccx, ccy, ccz], radius: Math.sqrt(maxRadiusSq) };
}

/** 纯数据阶段产物里全部可转移的 ArrayBuffer（Worker 回传用；去重，positions 被 terrainBuild 共享）。 */
export function groundGeometryTransferables(data: GroundGeometryData): ArrayBufferLike[] {
  const set = new Set<ArrayBufferLike>();
  const tb = data.terrainBuild as Record<string, ArrayBufferView | undefined>;
  for (const a of [data.positions, data.uvs, data.normals, data.indices, tb.sizeAt, tb.originIAt, tb.originJAt, tb.vertexIndexAt, tb.morphRaw]) {
    if (a && a.buffer) set.add(a.buffer);
  }
  return [...set];
}

