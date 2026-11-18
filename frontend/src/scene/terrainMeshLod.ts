/** 客户端补片宽度（四边形数）：`PATCH_SIZE_VERTICES - 1`。 */
export const PATCH_QUADS = 8
/** 引擎 `SubdivisionMetrics` 默认值（`LandscapeSubdivision.h:44-58`：两套 fov 预设）。 */
export const SUBDIVISION_METRICS = Object.freeze({
  normalFov: 70, zoomFov: 6.5,
  normalMaxHeightError: 0.014, normalMaxPatchRadiusError: 0.45, normalMaxAbsoluteHeightError: 3,
  zoomMaxHeightError: 0.03, zoomMaxPatchRadiusError: 0.9, zoomMaxAbsoluteHeightError: 3,
})
/** 节点数保护上限（异常 fov/距离下不炸内存；命中即停止细分、按当前层出几何，**不留空洞**）。 */
export const MAX_QUADS = 400000

/** 客户端"正常相机"（TPS / 回放自由相机）的**水平** fov = 引擎 `SubdivisionMetrics::normalFov`。
 *
 *  引擎 `PrepareSubdivision`（`LandscapeSubdivision.cpp`）用 `camera->GetFOV()` 直接做阈值插值
 *  ——引擎口径下 `GetFOV()` 是**水平** fov（`tanFovY = tanf(fov/2)/aspect ≡ tan(vfov/2)` 的
 *  推导只在该口径下自洽），而且它取自相机配置：**宽高比只进投影项 tanFovY，不影响 fovLerp**。
 *  zoom 端（6.5°）是狙击镜档；回放自由相机没有该模式 ⇒ 本渲染器恒按 normal 档求阈值。
 *  ⚠️ 若将来加真正的变焦/狙击相机，必须把该相机自己的**水平** fov 传进来。 */
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

/** 相机 LOD 状态快照——**必须与 `buildAdaptiveTerrain` 的判据输入同源**（相机三维位置、视距、
 *  视轴、FOV、aspect）：滞回只看视距时，"绕目标水平旋转、视距不变"会让网格永远跳过重建、
 *  停在旧相机位置的 LOD 分布上（2026-10-10 review P2）。`d` = 相机到 `target` 的视距，
 *  `u` = 视轴单位向量（target → camera）。 */
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

/** 地形 LOD 是否已过期（返回 true = 应重建）。输入为 `terrainLodState` 快照，判据与
 *  `buildAdaptiveTerrain` 一致——**凡判据读的输入变了就必须重建**，否则网格可比客户端
 *  （同一相机位置）允许的层级更粗：
 *  - 视距（**单向滞回**）：拉近 ≥5% 一律细化；拉远 ≥40% 才允许变粗（双向 25% 的旧实现会让网格
 *    长期停在更粗层级，粗格插值把地形抬到贴地薄结构之上，且随重建时机时有时无——2026-10-10
 *    用户"铁轨被盖、转视角又正常"）；
 *  - **侧向位移**（垂直于视轴的分量 ≥5%·视距）：贴片到相机的距离随之改变 ⇒ 细分判据变。
 *    水平绕转（轨道旋转）视距恒等，仅凭上面两条会永远跳过；
 *  - **FOV / aspect**（相对变化 >0.1%）：阈值随水平 FOV 插值、投影系数随 aspect；`onResize`
 *    只改投影不重建地形，窗口/名册布局变化后同样会残留过期 LOD。
 *  全部触发共用 `minIntervalMs` 节流（重建 ≈ 一次四叉遍历，帧预算上限 ≈1 次/120 ms）。 */
export function terrainLodStale(prev: unknown, cur: TerrainLodSnapshot, sinceMs: number, minIntervalMs = 120): boolean {
  return terrainLodStaleReason(prev, cur, sinceMs, minIntervalMs) !== null;
}

/** 两次地形 LOD 重建的最小间隔。调用方的节流判据与「换装后的最终姿态复查」共用同一个值。 */
export const TERRAIN_LOD_MIN_INTERVAL_MS = 120;

/** 纯姿态判据（不含节流）：返回命中的判据原因，未过期返回 null。
 *  `terrainLodStaleReason` 在它之上只加节流门；换装后需要知道「当前相机是否仍不符合已换装快照」
 *  时不传 sinceMs，直接用本函数。 */
export function terrainLodPoseReason(prev: unknown, cur: TerrainLodSnapshot): string | null {
  if (!prev || !((prev as TerrainLodSnapshot).d > 0)) return 'first';                 // 首帧
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

/** `terrainLodStale` 的原因旁路：返回命中的判据（`first` / `distance` / `lateral` / `fov` / `aspect`），
 *  不过期或被节流挡住时返回 null。判据数值与先后顺序是 `terrainLodStale` 的唯一来源——
 *  布尔结果由本函数派生（`!== null`），诊断只读原因，不影响是否重建。 */
export function terrainLodStaleReason(prev: unknown, cur: TerrainLodSnapshot, sinceMs: number, minIntervalMs = TERRAIN_LOD_MIN_INTERVAL_MS): string | null {
  const reason = terrainLodPoseReason(prev, cur);
  if (!reason || reason === 'first') return reason;           // 首帧不等节流
  return sinceMs >= minIntervalMs ? reason : null;
}

/** 底图贴图 UV（低档/均衡档与分层材质不可用时回退：**契约化的 `ground.webp`** 摊在**地形网格**上）。
 *  契约 = 旧 `PlaneGeometry(size, size) + rotation.set(−π/2, 0, π)` + TextureLoader(flipY=true)
 *  的逐点等价（并见上游 `tools/composite_overhead.py` 底图侧注释「左列 = +X_scene、顶行 = +Z_scene」）：
 *    `u = 0.5 − (X − cx)/span`、`v = 0.5 + (Z − cz)/span`
 *  实测锚定（梯度结构相关，高度图 ↔ ground.webp，4 候选 × 3 张强结构图）：只在本式下命中地面结构
 *  （erlenberg +0.111 / medvedkovo +0.163 / malinovka +0.097；其余候选 ≤ 0.024 或为负）。
 *  ⚠️ 别照分层着色器的 `tc`（`v = 0.5 − Z/span`）写：`cm.webp` 与 `ground.webp` 在导出侧本就
 *  v 互翻（直接互比：同图仅差行翻转）⇒ 两套公式各自只对自己的文件成立。 */
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
