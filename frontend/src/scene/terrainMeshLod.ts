export const PATCH_QUADS = 8
export const SUBDIVISION_METRICS = Object.freeze({
  normalFov: 70, zoomFov: 6.5,
  normalMaxHeightError: 0.014, normalMaxPatchRadiusError: 0.45, normalMaxAbsoluteHeightError: 3,
  zoomMaxHeightError: 0.03, zoomMaxPatchRadiusError: 0.9, zoomMaxAbsoluteHeightError: 3,
})
export const MAX_QUADS = 400000

export const CLIENT_NORMAL_CAMERA_FOV_H = 70

interface TerrainPoint { x: number; y: number; z: number }
interface TerrainLodSnapshot {
  d: number
  ux: number
  uy: number
  uz: number
  fovY: number
  aspect: number
  px: number
  py: number
  pz: number
}
export interface SubdivisionMetrics {
  tanFovY: number
  fovLerp: number
  maxHeightError: number
  maxPatchRadiusError: number
  maxAbsoluteHeightError: number
}

/** 贴地薄构件走廊的足迹采样点 → 逐 texel 细分掩码（B 方案「走廊强制细分」的输入）。
 *
 *  为什么需要：贴地薄构件（客户端 `MATERIAL_DECAL`，"objects colored with landscape"——
 *  铁轨基板/压顶/铺装这类，导出物带 `extras.decal`）只有 0.3 m 上下厚度、净空常仅 3–30 cm，
 *  而自适应网格在远处跨它们插值 ⇒ 插值面抬到构件顶面之上就把它盖住（2026-10-14 用户报障
 *  "拉远后铁轨被白色盖住"：250 m 机位实测 rails_003 39.7% / rails_002 6.7% 的钢条顶点被盖）。
 *  **判据是语义的**：材质 `extras.decal` 命中即整件标记（不按亮度/占比做统计判定）；掩码只用于
 *  *强制细分*，不改任何高度值。
 *
 *  @param pointsXZ 足迹点列 `[x0, z0, x1, z1, …]`（**场景系**世界坐标；调用方按 ≤1 texel 间距
 *                  取样构件的外缘与内部，自带轮廓覆盖）
 *  @param n        高度场边长（texel）
 *  @param span     地形世界跨度（米）
 *  @param marginTexels 足迹外扩（texel；补片边界按"最粗相邻层"缝合，留 1–2 texel 让边界也落在细侧）
 *  @returns `Uint8Array(n*n)`：1 = 该 texel 属于走廊（其所在补片将被强制细分到最细层）。 */
export function buildRefineMask(pointsXZ: ArrayLike<number>, n: number, span: number, marginTexels = 2): Uint8Array {
  const mask = new Uint8Array(n * n)
  const m = Math.max(0, Math.floor(marginTexels))
  for (let k = 0; k + 1 < pointsXZ.length; k += 2) {
    const x = pointsXZ[k], z = pointsXZ[k + 1]
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue
    const j = Math.round((x / span + 0.5) * n)
    const i = Math.round((z / span + 0.5) * n)
    for (let di = -m; di <= m; di++) {
      const ii = i + di
      if (ii < 0 || ii >= n) continue
      for (let dj = -m; dj <= m; dj++) {
        const jj = j + dj
        if (jj >= 0 && jj < n) mask[ii * n + jj] = 1
      }
    }
  }
  return mask
}

/** 当前 fov 下的细分阈值与投影系数（客户端 `PrepareSubdivision` 的等价物）。
 *  @param fovYRad 相机**竖直** fov（three.js 口径，弧度）——只决定投影项 `tanFovY`
 *  @param aspect  宽/高
 *  @param tolScale 阈值系数（1 = 客户端原口径；越小越细——`?terrainlod`）
 *  @param hFovDegOverride 阈值插值用的**水平** fov（引擎 `Camera::GetFOV()` 口径）；缺省由
 *   fovY×aspect 折算（纯函数语义）。客户端该值来自相机配置、不随画布宽高比变化 ⇒ 运行时传
 *   `CLIENT_NORMAL_CAMERA_FOV_H`（否则窄画布会把我们的水平角折算小、滑动到狙击镜档的宽阈值）。 */
export function subdivisionMetrics(fovYRad: number, aspect = 16 / 9, tolScale = 1, hFovDegOverride: number | null = null): SubdivisionMetrics {
  const v = Number.isFinite(fovYRad) && fovYRad > 0 ? fovYRad : 0.96;
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const tanFovY = Math.tan(v / 2);
  const hFovDeg = Number.isFinite(hFovDegOverride) && (hFovDegOverride as number) > 0
    ? hFovDegOverride as number
    : (2 * Math.atan(tanFovY * a) * 180) / Math.PI;
  const M = SUBDIVISION_METRICS;
  const fovLerp = Math.min(1, Math.max(0, (hFovDeg - M.zoomFov) / (M.normalFov - M.zoomFov)));
  const lerp = (z: number, nm: number) => z + (nm - z) * fovLerp;
  const sc = Number.isFinite(tolScale) ? Math.max(0, tolScale) : 1;
  return {
    tanFovY,
    fovLerp,
    maxHeightError: lerp(M.zoomMaxHeightError, M.normalMaxHeightError) * sc,
    maxPatchRadiusError: lerp(M.zoomMaxPatchRadiusError, M.normalMaxPatchRadiusError) * sc,
    maxAbsoluteHeightError: lerp(M.zoomMaxAbsoluteHeightError, M.normalMaxAbsoluteHeightError),
  };
}

export function terrainLodState(camera: { position: TerrainPoint; fov?: number }, target: TerrainPoint, aspect: number): TerrainLodSnapshot {
  const px = camera.position.x, py = camera.position.y, pz = camera.position.z;
  const dx = px - target.x, dy = py - target.y, dz = pz - target.z;
  const d = Math.hypot(dx, dy, dz);
  return {
    d, px, py, pz,
    ux: d > 1e-9 ? dx / d : 0, uy: d > 1e-9 ? dy / d : 0, uz: d > 1e-9 ? dz / d : 0,
    fovY: Number.isFinite(camera.fov) ? ((camera.fov as number) * Math.PI) / 180 : 0.8,
    aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9,
  };
}

export function terrainLodStale(prev: unknown, cur: TerrainLodSnapshot, sinceMs: number, minIntervalMs = 120): boolean {
  return terrainLodStaleReason(prev, cur, sinceMs, minIntervalMs) !== null;
}

export const TERRAIN_LOD_MIN_INTERVAL_MS = 120;

export function terrainLodPoseReason(prev: unknown, cur: TerrainLodSnapshot): string | null {
  if (!prev || !((prev as TerrainLodSnapshot).d > 0)) return 'first';
  const rel = (cur.d - (prev as TerrainLodSnapshot).d) / Math.max(1, (prev as TerrainLodSnapshot).d);
  if (rel <= -0.05 || rel >= 0.40) return 'distance';
  const dx = cur.px - (prev as TerrainLodSnapshot).px, dy = cur.py - (prev as TerrainLodSnapshot).py, dz = cur.pz - (prev as TerrainLodSnapshot).pz;
  const along = dx * cur.ux + dy * cur.uy + dz * cur.uz;
  const lat = Math.hypot(dx - along * cur.ux, dy - along * cur.uy, dz - along * cur.uz);
  if (lat >= 0.05 * Math.max(1, cur.d)) return 'lateral';
  if (Math.abs(cur.fovY - (prev as TerrainLodSnapshot).fovY) > 1e-3 * Math.max(1e-3, (prev as TerrainLodSnapshot).fovY)) return 'fov';
  if (Math.abs(cur.aspect - (prev as TerrainLodSnapshot).aspect) > 1e-3 * Math.max(1e-3, (prev as TerrainLodSnapshot).aspect)) return 'aspect';
  return null;
}

export function terrainLodStaleReason(prev: unknown, cur: TerrainLodSnapshot, sinceMs: number, minIntervalMs = TERRAIN_LOD_MIN_INTERVAL_MS): string | null {
  const reason = terrainLodPoseReason(prev, cur);
  if (!reason || reason === 'first') return reason;
  return sinceMs >= minIntervalMs ? reason : null;
}

export function groundMapUv(positions: ArrayLike<number>, span: number, cx = 0, cz = 0): Float32Array {
  const s = Number.isFinite(span) && span > 0 ? span : 600;
  const ocx = Number.isFinite(cx) ? cx : 0;
  const ocz = Number.isFinite(cz) ? cz : 0;
  const count = Math.floor(positions.length / 3);
  const uv = new Float32Array(count * 2);
  for (let k = 0; k < count; k++) {
    uv[k * 2] = 0.5 - (positions[k * 3] - ocx) / s;
    uv[k * 2 + 1] = 0.5 + (positions[k * 3 + 2] - ocz) / s;
  }
  return uv;
}
