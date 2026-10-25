/**
 * 地形网格：**客户端同构的补片级自适应细分 + 无裂缝缝合**（镜像引擎 `LandscapeSubdivision`）。
 *
 * 引擎事实（`Sources/Internal/Render/Highlevel/LandscapeSubdivision.{h,cpp}` 逐行核对）：
 *   · 地形是**程序化补片网格**：一个补片 = `PATCH_SIZE_VERTICES = 9` ⇒ **8×8 四边形**；层级 k 的
 *     补片边长 `patchSize = size >> k` texel、补片内顶点间距 `step = patchSize / 8` —— level 0
 *     （最粗）= 整图一个补片、每 64 texel 一个顶点；最细层 `FastLog2(size/8)`（512 ⇒ 7 层，
 *     step = 1 texel）。**终止的补片内部仍是 8×8 四边形**（不是"一个四边形"）。
 *   · **顶点高度 = 两通道按 morph 插值**（`Landscape.cpp:CreateHeightTextureData` +
 *     `Shaders/Landscape/tilemask-vp.sl` 逐行核对）：高度图被引擎打包成 RGBA8，每个 mip 纹素 =
 *     **[本层原始高度 u16, 本层"双抽头均值" u16]**（均值 = 该纹素与相距一个 step 的对侧邻居的均值；
 *     偶数索引或末索引取自身）；顶点着色器里
 *     `height = lerp(sample.zw = averaged, sample.xy = accurate, morphAmount)`，
 *     `morphAmount = 边掩码 · 邻补片 morph + patchMorph ×(无边邻居时)`，`patchMorph` 由误差比算出
 *     （`SubdividePatch` 末尾）：`errorDelta = 1 − max(relR, relH)`、
 *     `error0Delta = max(relR₀, relH₀) − 1`、`subdivMorph = 1 − errorDelta/(error0Delta + errorDelta)`，
 *     再经 `morphFunc(x) = 4(1−x)⁵ − 5(1−x)⁴ + 1` 整形（`Landscape.cpp:1213`）。
 *     ⚠️ **这一层很关键**：误差贴近阈值的补片 morph→1 ⇒ 地形被"双抽头均值"抹平——**这正是客户端在
 *     "地形与挡土墙顶/建筑基础吸附齐平"的缝上不穿出来的原因**（2026-10-10 用户追问"客户端为什么不会"后
 *     定点）；只实现"原始 texel + 层间直线"会保留厘米级 texel 噪声 ⇒ 从俯瞰/掠射视角戳出结构。
 *     地图最外一圈按着色器 `zeroLodMul` 的同款处理退回原始值（`relativePosition ≥ 1` 时取 mip0 零偏移）。
 *   · 细分判据（`SubdividePatch`，`:252-258`）三条**任一命中即细分**；误差量 = 补片内 8×8 个四边形
 *     各自的"一步细分误差"（下一层采样点真值 vs 本层角点均值）的最大值 **及其发生位置**：
 *       ① 屏幕半径 `radius / (patchDistance · tanFovY) ≥ maxPatchRadiusError`
 *          （`radius` = 补片包围盒对角半长；`patchDistance` = 到包围盒中心）；
 *       ② 屏幕高度 `|maxError| / (errorDistance · tanFovY) ≥ maxHeightError`——距离取**最差样本
 *          位置**（不是补片中心）；
 *       ③ 绝对高度 `|maxError| > maxAbsoluteHeightError`（3 m，与距离无关）。
 *     **只有这三条**——没有任何额外"岸线/贴地结构/脚印"类判据（2026-10-11 用户裁示"不要自行
 *     发明处理方法，和客户端对齐"：岸线在客户端同样由这三条判据决定网格，其视觉由水材质处理、
 *     不改地形 tessellation；贴地薄构件在远视距被粗格盖住是客户端同机位的忠实结果）。让位掩码 /
 *     脚印细分 / 岸线强制细分 / morph 修补四类补偿已全部撤销（岸线判据于 2026-10-11 PR 评审删除）。
 *     阈值随 fov 在 zoom/normal 两套预设间线性插值（`PrepareSubdivision`；引擎 `Camera::GetFOV()` 是
 *     **水平** fov）；`tanFovY = tanf(fov/2)/aspect` ≡ `tan(vfov/2)`（竖直半角正切）。
 *   · 层级交界的 T 型接缝由顶点着色器的 neighbour-morph 缝合——**离线网格必须自己解决**
 *     （2026-10-09 用户"这次引入了横竖条纹"：共享边两侧顶点密度不同 ⇒ 细缝）。
 *
 * 本实现（离线、无裂缝）：
 *   ① **补片级**细分（同客户端三条判据 + 同款 8×8 内部网格）；
 *   ② 顶点高度取"最粗相邻四边形"所在层级：两通道各自按该层级的**边界直线/格点值**求值
 *      （= 客户端"细侧采粗侧 mip"的离线等价；边端点自身可能被更粗象限拉扯 ⇒ 端点递归），
 *      再按该层级的 morph 插值 ⇒ 同一 (i,j) 恒得同一高度 ⇒ **不可能有裂缝/T 型接缝**，也不需要
 *      2:1 平衡（客户端同层交界的 morph 取两侧较小值，离线统一取最粗相邻者以保证两侧同高）；
 *   ③ 发射时按 (i,j) 去重顶点（索引网格）⇒ `computeVertexNormals` 法线跨叶连续。
 *
 * 纯函数、无 THREE 依赖，单测看护。
 */

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
export function buildRefineMask(pointsXZ, n, span, marginTexels = 2) {
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
export function subdivisionMetrics(fovYRad, aspect = 16 / 9, tolScale = 1, hFovDegOverride = null) {
  const v = Number.isFinite(fovYRad) && fovYRad > 0 ? fovYRad : 0.96;
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const tanFovY = Math.tan(v / 2);
  const hFovDeg = Number.isFinite(hFovDegOverride) && hFovDegOverride > 0
    ? hFovDegOverride
    : (2 * Math.atan(tanFovY * a) * 180) / Math.PI;
  const M = SUBDIVISION_METRICS;
  const fovLerp = Math.min(1, Math.max(0, (hFovDeg - M.zoomFov) / (M.normalFov - M.zoomFov)));
  const lerp = (z, nm) => z + (nm - z) * fovLerp;
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
export function terrainLodState(camera, target, aspect) {
  const px = camera.position.x, py = camera.position.y, pz = camera.position.z;
  const dx = px - target.x, dy = py - target.y, dz = pz - target.z;
  const d = Math.hypot(dx, dy, dz);
  return {
    d, px, py, pz,
    ux: d > 1e-9 ? dx / d : 0, uy: d > 1e-9 ? dy / d : 0, uz: d > 1e-9 ? dz / d : 0,
    fovY: Number.isFinite(camera.fov) ? (camera.fov * Math.PI) / 180 : 0.8,
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
export function terrainLodStale(prev, cur, sinceMs, minIntervalMs = 120) {
  if (!prev || !(prev.d > 0)) return true;                 // 首帧
  const rel = (cur.d - prev.d) / Math.max(1, prev.d);
  if (rel <= -0.05 || rel >= 0.40) return sinceMs >= minIntervalMs;
  const dx = cur.px - prev.px, dy = cur.py - prev.py, dz = cur.pz - prev.pz;
  const along = dx * cur.ux + dy * cur.uy + dz * cur.uz;
  const lat = Math.hypot(dx - along * cur.ux, dy - along * cur.uy, dz - along * cur.uz);
  if (lat >= 0.05 * Math.max(1, cur.d)) return sinceMs >= minIntervalMs;
  if (Math.abs(cur.fovY - prev.fovY) > 1e-3 * Math.max(1e-3, prev.fovY)) return sinceMs >= minIntervalMs;
  if (Math.abs(cur.aspect - prev.aspect) > 1e-3 * Math.max(1e-3, prev.aspect)) return sinceMs >= minIntervalMs;
  return false;
}

/** 底图贴图 UV（低档/均衡档与分层材质不可用时回退：**契约化的 `ground.webp`** 摊在**地形网格**上）。
 *  契约 = 旧 `PlaneGeometry(size, size) + rotation.set(−π/2, 0, π)` + TextureLoader(flipY=true)
 *  的逐点等价（并见上游 `tools/composite_overhead.py` 底图侧注释「左列 = +X_scene、顶行 = +Z_scene」）：
 *    `u = 0.5 − (X − cx)/span`、`v = 0.5 + (Z − cz)/span`
 *  实测锚定（梯度结构相关，高度图 ↔ ground.webp，4 候选 × 3 张强结构图）：只在本式下命中地面结构
 *  （erlenberg +0.111 / medvedkovo +0.163 / malinovka +0.097；其余候选 ≤ 0.024 或为负）。
 *  ⚠️ 别照分层着色器的 `tc`（`v = 0.5 − Z/span`）写：`cm.webp` 与 `ground.webp` 在导出侧本就
 *  v 互翻（直接互比：同图仅差行翻转）⇒ 两套公式各自只对自己的文件成立。 */
export function groundMapUv(positions, span, cx = 0, cz = 0) {
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

/** `terrain.json` / `X-Terrain-Meta` 的 `terrainLayout`：当前唯一认可的数据布局。 */
export const TERRAIN_LAYOUT_ENGINE_VERTEX = 2

/** 高度场解码所需的元字段必须齐全；缺一项就 fail-closed（不能拿缺省 layout/zmax 猜）。 */
export function terrainFieldMetaValid(meta) {
  if (!meta || typeof meta !== 'object') return false;
  const n = Number(meta.size);
  // size=1 会被解码成单点场，但 buildAdaptiveTerrain 要求 n>=2 会抛错——提前 fail-closed。
  if (!Number.isInteger(n) || n < 2) return false;
  const layout = meta.terrainLayout;
  if (layout !== 1 && layout !== TERRAIN_LAYOUT_ENGINE_VERTEX) return false;
  // 必须先是真正的 number：null / '' / false 经 Number() 会变成 0，会被误认为合法高度范围。
  const zmin = meta.zmin, zmax = meta.zmax;
  if (typeof zmin !== 'number' || typeof zmax !== 'number') return false;
  // 允许 zmax === zmin（完全平坦的地图，k=0）；只拒绝缺失/倒置范围
  return Number.isFinite(zmin) && Number.isFinite(zmax) && zmax >= zmin;
}

/** 当前地形消费口径只支持居中、正方形 worldBounds（±300 契约）；非零中心/非方形 fail-closed。
 *  worldBounds 缺失（旧包）不在此判定，由调用方的 span 校验兜底。 */
export function terrainBoundsOk(meta) {
  const wb = meta && meta.worldBounds;
  if (!wb) return true;
  const min = wb.min, max = wb.max;
  if (!Array.isArray(min) || !Array.isArray(max) || min.length < 2 || max.length < 2) return false;
  const [minX, minZ, maxX, maxZ] = [min[0], min[1], max[0], max[1]];
  if (![minX, minZ, maxX, maxZ].every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const dx = maxX - minX;
  const dy = maxZ - minZ;
  return Math.abs(cx) <= 1e-6 && Math.abs(cz) <= 1e-6
    && dx > 0 && Math.abs(dx - dy) <= 1e-6;
}

/**
 * 解码 `terrain.u16.bin` → 米制高度场（行主序，索引 = row*n+col）。**输出口径 = 场景系引擎顶点**：
 * 列 j / 行 i 恰是世界点 `((j/n − 0.5)·span, (i/n − 0.5)·span)` 处的引擎顶点高度——
 * 引擎 `Heightmap::GetPoint` 与 `tilemask-vp.sl` 都是 corner 口径（顶点 k 在 `k/size`、取 texel k），
 * 本文件网格（`wx`/`wz`）、`sampleHeight`、拾取诊断与水面岸线纹理都按这一口径读取。
 *
 * 布局（上游打包器 `map_assets.rs::parse_heightmap`；场景 x = −游戏 x 的镜像在列上做）：
 *   · `terrainLayout: 2`：上游按 corner 口径镜像（`out[c] = src[min(size−c, size−1)]`）⇒ 原样使用；
 *   · 缺省（旧包）：上游曾按 `out[c] = src[size−1−c]` 离散翻转——corner 口径下翻转后第 c 列的真实
 *     位置是 `((c+1)/n − 0.5)·span`，**整张地形沿场景 −x 偏一格**（span/512，600 m 图 1.17 m；
 *     2026-10-13 用户"墙前多出土包"——挡土墙低侧朝场景 −x 时路基被推出墙面）。读取边界在此平移
 *     一列补正：`field[c] = 旧[max(c−1, 0)]`；
 *   · 其余值：未知布局 ⇒ fail-closed 返回 null（宁可回退 2D，不画错位地形）。
 * ponytail: 两种布局都丢掉场景 +x 边界那一列顶点（源列 0，n 列表示不下 n+1 个顶点）——该列在
 *   地图包围盒边缘、可玩区之外；要逐点精确需把文件扩成 (n+1) 列（上游格式变更）。
 * @returns Float32Array(n*n) | null（尺寸不符 / 未知布局）
 */
export function decodeTerrainField(buf, meta = {}) {
  // 缺 terrain.json / 缺 layout/size/zmax 时**不得**用缺省值猜：layout 1 vs 2 差一列、
  // zmax 缺省会让高度整体缩放错误。旧包没有 layout 标记 ⇒ 同样回退 2D（fail-closed）。
  if (!terrainFieldMetaValid(meta)) return null;
  const n = Number(meta.size);
  if (!buf || buf.byteLength !== n * n * 2) return null;
  const layout = meta.terrainLayout;
  const shift = layout === 1 ? 1 : 0;
  const u16 = new Uint16Array(buf);
  const zmin = Number(meta.zmin);
  const k = (Number(meta.zmax) - zmin) / 65535;
  const field = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    const row = r * n;
    for (let c = 0; c < n; c++) field[row + c] = u16[row + Math.max(c - shift, 0)] * k + zmin;
  }
  return field;
}

/**
 * json/bin 配对（PR #615 review P2）：`terrain.json`（no-cache）与 `terrain.u16.bin`（max-age=3600）是两次
 * 独立请求，布局标记只对同一次发布的 bin 成立——发布切换期"新 json + 浏览器缓存的旧 bin"会跳过补正，
 * "旧 json + 新 bin"会对已修正数据再平移一列。上游 `terrain.json` 带 `terrainBinSha256`（bin 的逐文件
 * sha256，与 manifest 同源）：
 *   · `pairedTerrainBinUrl`：以 sha 作 bin 的缓存键（浏览器 HTTP 缓存按完整 URL 区分；对象存储忽略该
 *     查询参数、Android 原生资产代理按 path 取并逐次 ETag 复验）⇒ 不会复用上一次发布缓存的旧 bin；
 *   · `terrainBinMatchesMeta`：解码前核对字节 sha256 ⇒ 发布进行中（json/bin 尚未同批）fail-closed。
 * 无 `terrainBinSha256` 的旧包：无从配对，沿用原行为；**有 sha 但 WebCrypto 不可用**
 * （非安全上下文/旧 WebView）⇒ fail-closed，不能假装配对成功。
 */
function terrainBinSha(meta) {
  const s = meta && meta.terrainBinSha256;
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s) ? s : null;
}

/** bin URL 附 `sha256=<terrainBinSha256>` 作缓存键；meta 无合法 sha 时原样返回。 */
export function pairedTerrainBinUrl(url, meta) {
  const sha = terrainBinSha(meta);
  if (!url || !sha) return url;
  return `${url}${url.includes('?') ? '&' : '?'}sha256=${sha}`;
}

/** bin 字节与 meta 声明的 sha256 是否一致。
 *  无 sha（旧包）⇒ true（无从校验）；有 sha 但无 WebCrypto/buf ⇒ false（fail-closed）。 */
export async function terrainBinMatchesMeta(buf, meta, subtle = globalThis.crypto?.subtle) {
  const sha = terrainBinSha(meta);
  if (!sha) return true;
  if (!subtle || !buf) return false;
  const digest = new Uint8Array(await subtle.digest('SHA-256', buf));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex === sha;
}

/** 引擎 `Landscape::morphFunc`（Landscape.cpp:1213）：4(1−x)⁵ − 5(1−x)⁴ + 1（x 夹到 [0,1]）。 */
export function morphFunc(x) {
  const y = 1 - Math.max(0, Math.min(1, x));
  const y4 = y * y * y * y;
  return y4 * (4 * y - 5) + 1;
}

/** 引擎 `SubdividePatch` 末尾的 `subdivMorph`（误差比口径；*0 = 父补片的同名误差）。 */
export function subdivMorphOf(heightError, radiusError, heightError0, radiusError0, M) {
  const relH = Math.min(heightError, M.maxHeightError) / M.maxHeightError;
  const relR = Math.min(radiusError, M.maxPatchRadiusError) / M.maxPatchRadiusError;
  const relH0 = Math.max(heightError0, M.maxHeightError) / M.maxHeightError;
  const relR0 = Math.max(radiusError0, M.maxPatchRadiusError) / M.maxPatchRadiusError;
  const d0 = Math.max(relR0, relH0) - 1;
  const d = 1 - Math.max(relR, relH);
  return d0 + d > 0 ? 1 - d / (d0 + d) : 0;
}

/**
 * 构建自适应地形几何（无裂缝）。
 *
 * @param field   Float32Array(n*n)：`decodeTerrainField` 口径（列 j = 场景 x_j 处的引擎顶点高度，
 *                行 0=南），索引 = row*n+col
 * @param n       高度图边长（texel 数，如 512；非 8·2^k 的退化值只影响层级嵌套，仍铺满）
 * @param span    世界跨度（米）；顶点世界坐标 = (i/n − 0.5)·span（角点口径，引擎同构）
 * @param cam     { x, y, z } 相机位置（场景系）
 * @param fovY    相机竖直 fov（弧度）
 * @param aspect  宽/高（阈值插值与投影系数用）
 * @param minStep 最细顶点间距（texel；1 = 引擎最细层）
 * @param tolScale 阈值系数（1 = 客户端口径）
 * @returns { positions, indices, quads, overBudget, sizeAt }
 */
// 补片表（相机无关，按 field 备忘——LOD 重建不重算；约 1.75M 次 texel 采样/图，一次性）。
function buildPatchTableAscending(field, n, span, rootStepNow) {
  const H = (i, j) => field[Math.min(i, n - 1) * n + Math.min(j, n - 1)];
  const wx = (j) => (j / n - 0.5) * span;
  const wz = (i) => (i / n - 0.5) * span;
  const K = Math.round(Math.log2(rootStepNow)) + 1;
  const levels = [];
  for (let L = 0; L < K; L++) {
    const patchSize = 8 * (rootStepNow >> L);
    const perAxis = Math.max(1, Math.ceil(n / patchSize));
    const count = perAxis * perAxis;
    levels.push({
      patchSize, perAxis, step: patchSize / 8,
      maxErr: new Float32Array(count),
      posI: new Int32Array(count), posJ: new Int32Array(count), posH: new Float32Array(count),
      minX: new Float32Array(count), maxX: new Float32Array(count),
      minZ: new Float32Array(count), maxZ: new Float32Array(count),
      minH: new Float32Array(count), maxH: new Float32Array(count),
      radius: new Float32Array(count),
    });
  }
  // ① 各层自身采样（引擎 UpdatePatchInfo 的 5 样本/四边形；最细层不采样 ⇒ maxError = 0）
  for (let L = 0; L < K; L++) {
    const lv = levels[L];
    const step = lv.step;
    const deepest = L === K - 1;
    for (let iy = 0; iy < lv.perAxis; iy++) {
      for (let ix = 0; ix < lv.perAxis; ix++) {
        const idx = iy * lv.perAxis + ix;
        const i0 = iy * lv.patchSize, j0 = ix * lv.patchSize;
        // own 包围盒 = 9×9 格点（引擎只加四边形四角）
        let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
        let mnH = Infinity, mxH = -Infinity;
        for (let a = 0; a <= PATCH_QUADS; a++) {
          const ii = Math.min(i0 + a * step, n), z = wz(ii);
          if (z < mnZ) mnZ = z; if (z > mxZ) mxZ = z;
          for (let b = 0; b <= PATCH_QUADS; b++) {
            const jj = Math.min(j0 + b * step, n), x = wx(jj), y = H(ii, jj);
            if (x < mnX) mnX = x; if (x > mxX) mxX = x;
            if (y < mnH) mnH = y; if (y > mxH) mxH = y;
          }
        }
        lv.minX[idx] = mnX; lv.maxX[idx] = mxX;
        lv.minZ[idx] = mnZ; lv.maxZ[idx] = mxZ;
        lv.minH[idx] = mnH; lv.maxH[idx] = mxH;
        if (!deepest) {
          const h = step >> 1;
          let best = 0, bi = i0, bj = j0;
          for (let a = 0; a < PATCH_QUADS; a++) {
            for (let b = 0; b < PATCH_QUADS; b++) {
              const ci = i0 + a * step, cj = j0 + b * step;
              if (ci >= n || cj >= n) continue;
              const p00 = H(ci, cj), p01 = H(ci, cj + step);
              const p10 = H(ci + step, cj), p11 = H(ci + step, cj + step);
              for (const [pi, pj, ap] of [
                [ci, cj + h, (p00 + p01) / 2],
                [ci + h, cj, (p00 + p10) / 2],
                [ci + h, cj + h, (p00 + p11) / 2],
                [ci + step, cj + h, (p10 + p11) / 2],
                [ci + h, cj + step, (p01 + p11) / 2],
              ]) {
                const e = H(pi, pj) - ap;          // 有符号（引擎保留符号，只按 |·| 比较）
                if (Math.abs(e) > Math.abs(best)) { best = e; bi = pi; bj = pj; }
              }
            }
          }
          lv.maxErr[idx] = best; lv.posI[idx] = bi; lv.posJ[idx] = bj; lv.posH[idx] = H(bi, bj);
        }
      }
    }
  }
  // ② 自底向上：子补片的 maxError/位置/bbox 并入父补片（引擎 UpdatePatchInfo 递归尾部）
  for (let L = K - 2; L >= 0; L--) {
    const lv = levels[L], ch = levels[L + 1];
    for (let iy = 0; iy < lv.perAxis; iy++) {
      for (let ix = 0; ix < lv.perAxis; ix++) {
        const idx = iy * lv.perAxis + ix;
        for (const [di, dj] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
          const cy = Math.min(2 * iy + di, ch.perAxis - 1);
          const cx = Math.min(2 * ix + dj, ch.perAxis - 1);
          const cidx = cy * ch.perAxis + cx;
          if (Math.abs(ch.maxErr[cidx]) > Math.abs(lv.maxErr[idx])) {
            lv.maxErr[idx] = ch.maxErr[cidx];
            lv.posI[idx] = ch.posI[cidx]; lv.posJ[idx] = ch.posJ[cidx]; lv.posH[idx] = ch.posH[cidx];
          }
          if (ch.minX[cidx] < lv.minX[idx]) lv.minX[idx] = ch.minX[cidx];
          if (ch.maxX[cidx] > lv.maxX[idx]) lv.maxX[idx] = ch.maxX[cidx];
          if (ch.minZ[cidx] < lv.minZ[idx]) lv.minZ[idx] = ch.minZ[cidx];
          if (ch.maxZ[cidx] > lv.maxZ[idx]) lv.maxZ[idx] = ch.maxZ[cidx];
          if (ch.minH[cidx] < lv.minH[idx]) lv.minH[idx] = ch.minH[cidx];
          if (ch.maxH[cidx] > lv.maxH[idx]) lv.maxH[idx] = ch.maxH[cidx];
        }
      }
    }
  }
  for (const lv of levels) {
    for (let idx = 0; idx < lv.radius.length; idx++) {
      const bx = (lv.minX[idx] + lv.maxX[idx]) / 2, by = (lv.minH[idx] + lv.maxH[idx]) / 2;
      const bz = (lv.minZ[idx] + lv.maxZ[idx]) / 2;
      lv.radius[idx] = Math.sqrt((lv.maxX[idx] - bx) ** 2 + (lv.maxH[idx] - by) ** 2 + (lv.maxZ[idx] - bz) ** 2);
    }
  }
  return { n, span, rootStep: rootStepNow, levels, K };
}

const patchTableCache = new WeakMap();
function patchTableFor(field, n, span, rootStep) {
  let hit = patchTableCache.get(field);
  if (hit && hit.n === n && hit.span === span && hit.rootStep === rootStep) return hit;
  const built = buildPatchTableAscending(field, n, span, rootStep);
  patchTableCache.set(field, built);
  return built;
}

export function buildAdaptiveTerrain({ field, n, span, cam, fovY, aspect = 16 / 9, minStep = 1, tolScale = 1, hFovDeg = null, refineMask = null }) {
  if (!field || !Number.isFinite(n) || n < 2) throw new Error('buildAdaptiveTerrain: 需 field 与 n ≥ 2')
  const H = (i, j) => field[Math.min(i, n - 1) * n + Math.min(j, n - 1)];
  const wx = (j) => (j / n - 0.5) * span;
  const wz = (i) => (i / n - 0.5) * span;
  const M = subdivisionMetrics(fovY, aspect, tolScale, hFovDeg);
  const camX = Number.isFinite(cam?.x) ? cam.x : 0;
  const camY = Number.isFinite(cam?.y) ? cam.y : 0;
  const camZ = Number.isFinite(cam?.z) ? cam.z : 0;
  const dTo = (x, y, z) => {
    const dx = x - camX, dy = y - camY, dz = z - camZ;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  // ---------- ① 补片级细分（客户端三条判据；终止补片内部 = 8×8 四边形）----------
  const sizeAt = new Int32Array(n * n);   // 逐 texel：所属发射四边形的顶点间距（② 的顶点高度口径要用）
  // 裁剪后的 st 可能不再整除 ci/cj；查询必须复用 emitPatch 实际写出的格子原点。
  const CellOriginArray = n <= 0xffff ? Uint16Array : Uint32Array;
  const originIAt = new CellOriginArray(n * n);
  const originJAt = new CellOriginArray(n * n);
  const morphRaw = new Float32Array(n * n);  // 逐 texel：所属补片的 subdivMorph（未过 morphFunc）
  const leaves = [];
  let overBudget = false;
  let curMorph = 0;                       // emitPatch 期间该补片的 subdivMorph
  const emitPatch = (i0, j0, step) => {
    for (let a = 0; a < PATCH_QUADS; a++) {
      for (let b = 0; b < PATCH_QUADS; b++) {
        const ci = i0 + a * step, cj = j0 + b * step;
        if (ci >= n || cj >= n) continue;
        const st = Math.min(step, n - ci, n - cj);   // 退化 n：末格夹取（H 亦夹到 n−1 = GetHeightClamp）
        leaves.push({ i0: ci, j0: cj, step: st });
        for (let i = ci; i < Math.min(ci + st, n); i++) {
          for (let j = cj; j < Math.min(cj + st, n); j++) {
            sizeAt[i * n + j] = st;
            originIAt[i * n + j] = ci;
            originJAt[i * n + j] = cj;
            morphRaw[i * n + j] = curMorph;
          }
        }
      }
    }
  };
  // 补片预计算表 = 客户端 `UpdatePatchInfo`（`LandscapeSubdivision.cpp:97-208`）的直译：
  // 引擎在载入/换图时**自底向上**为整棵四叉树的每个补片算 maxError/positionOfMaxError/bbox，
  // 子补片的误差与包围盒**并入父补片**（父看到的是整棵子树的最大误差/最广包围盒）；`radius =
  // Distance(bbox.GetCenter(), bbox.max)`。`SubdividePatch`（`:210-290`）每帧只做相机相关的
  // 距离换算与判定。本表相机无关（按 field 备忘，LOD 重建不重算）。
  // ⚠️ 2026-10-11 逐行核对引擎源码的修复：此前只算本层 8×8×5 样本（未聚合子树）⇒ 误差被低估
  // ⇒ subdivMorph 偏小（vertex 更靠 averaged 通道 = 台阶两侧下陷/上浮）+ 提前终止（更粗）。
  const rootStep = Math.max(1, 2 ** Math.floor(Math.log2(Math.max(1, Math.floor(n / PATCH_QUADS)))));
  const table = patchTableFor(field, n, span, rootStep);
  // 走廊掩码金字塔（refineMask ⇒ 逐层"该补片区域内是否有标记 texel"）：第 L 层节点 = 该补片面
  // （patchSize×patchSize texel），与 patchProbe 的行列索引同一口径。自底向上 any-OR（每层 1→4 子）
  // ⇒ 一次 O(n²/64) 预计算，之后每个补片的判定是 O(1)。
  const maskLevels = refineMask ? (() => {
    const out = new Array(table.levels.length);
    for (let L = table.levels.length - 1; L >= 0; L--) {     // 自最细层向根（any-OR 自底向上）
      const lv = table.levels[L];
      const per = lv.perAxis;
      const arr = new Uint8Array(per * per);
      if (L === table.levels.length - 1) {
        const ps = lv.patchSize;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            if (!refineMask[i * n + j]) continue;
            const iy = Math.min(Math.floor(i / ps), per - 1), ix = Math.min(Math.floor(j / ps), per - 1);
            arr[iy * per + ix] = 1;
          }
        }
      } else {
        const below = out[L + 1], perBelow = table.levels[L + 1].perAxis;
        for (let y = 0; y < per; y++) {
          for (let x = 0; x < per; x++) {
            let hit = 0;
            for (let dy = 0; dy < 2 && !hit; dy++) {
              for (let dx = 0; dx < 2; dx++) {
                const yy = y * 2 + dy, xx = x * 2 + dx;
                if (yy < perBelow && xx < perBelow && below[yy * perBelow + xx]) { hit = 1; break; }
              }
            }
            arr[y * per + x] = hit;
          }
        }
      }
      out[L] = arr;
    }
    return out;
  })() : null;
  /** 该补片是否命中走廊掩码（命中 ⇒ 强制细分，直至最细层）。 */
  const corridorForced = (level, i0, j0) => {
    if (!maskLevels) return false;
    const lv = table.levels[level];
    const iy = Math.min(Math.max(Math.floor(i0 / lv.patchSize), 0), lv.perAxis - 1);
    const ix = Math.min(Math.max(Math.floor(j0 / lv.patchSize), 0), lv.perAxis - 1);
    return maskLevels[level][iy * lv.perAxis + ix] === 1;
  };
  // 相机相关判定 = 客户端 `SubdividePatch`（`:251-258`）：距离/投影换算 + 三条判据。
  // 返回的两个误差值必须一并传出——子补片的 `subdivMorph` 要用父补片的同名值（`error0Delta`）。
  const patchProbe = (i0, j0, step, level) => {
    const lv = table.levels[level];
    const iy = Math.min(Math.max(Math.floor(i0 / lv.patchSize), 0), lv.perAxis - 1);   // 行 = z 轴
    const ix = Math.min(Math.max(Math.floor(j0 / lv.patchSize), 0), lv.perAxis - 1);   // 列 = x 轴
    const idx = iy * lv.perAxis + ix;
    const maxErr = lv.maxErr[idx];
    const err = Math.abs(maxErr);
    const distance = dTo(wx(lv.posJ[idx]), lv.posH[idx], wz(lv.posI[idx]));
    const heightError = err / (distance * M.tanFovY);
    const bx = (lv.minX[idx] + lv.maxX[idx]) / 2, by = (lv.minH[idx] + lv.maxH[idx]) / 2;
    const bz = (lv.minZ[idx] + lv.maxZ[idx]) / 2;
    const radiusError = lv.radius[idx] / (dTo(bx, by, bz) * M.tanFovY);
    const subdivide = radiusError >= M.maxPatchRadiusError
      || heightError >= M.maxHeightError
      || err > M.maxAbsoluteHeightError
      // 贴地薄构件走廊：**额外的第四条**，语义判据（材质 extras.decal 的足迹掩码），命中即细分到
      // 最细层——只加细分、不改高度值，也不动其余区域的层级（廊外与不传掩码时逐字节一致）。
      || corridorForced(level, i0, j0);
    return { subdivide, err, heightError, radiusError };
  };
  const patches = [];        // 终止补片及其判据值（诊断/测试：直接验证三条判据）
  // *Err0 = 父补片同名误差（引擎把当前层的 heightError/radiusError 传给子层当 *0；
  // 根调用传阈值本身 ⇒ 根补片 error0Delta = 0 ⇒ subdivMorph = 0，与引擎 SubdividePatch 首调一致）。
  const rec = (i0, j0, step, level, hErr0 = M.maxHeightError, rErr0 = M.maxPatchRadiusError) => {
    const roomLeft = leaves.length + PATCH_QUADS * PATCH_QUADS <= MAX_QUADS;
    let hErr = 0, rErr = 0;
    if (step > minStep && roomLeft) {
      const p = patchProbe(i0, j0, step, level);
      if (p.subdivide) {
        const h = step >> 1;
        // fail-closed：奇数 step 无法二等分（子补片跨度 8·h 对不上父补片 8·step ⇒ 会留空洞）。
        // 根步长已取 2 的幂（见下），本支实际不可达；保留只为杜绝"细分出洞"的可能。
        if (h * 2 !== step) {
          hErr = p.heightError; rErr = p.radiusError;
          patches.push({ i0, j0, step, err: p.err, heightError: hErr, radiusError: rErr });
        } else {
          for (const [di, dj] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
            rec(i0 + di * PATCH_QUADS * h, j0 + dj * PATCH_QUADS * h, h, level + 1, p.heightError, p.radiusError);
          }
          return;
        }
      }
      hErr = p.heightError; rErr = p.radiusError;
      patches.push({ i0, j0, step, err: p.err, heightError: hErr, radiusError: rErr });
    } else {
      if (!roomLeft) overBudget = true;
      // 最细层（或预算用尽）：仍取半径误差（引擎该项恒有），高度误差按最细层 = 0；
      // 二者都要喂给 subdivMorph（否则子/本级 morph 为 0，实测会漏掉客户端的抹平）。
      const p = step <= minStep ? patchProbe(i0, j0, step, level) : null;
      hErr = 0;
      rErr = p ? p.radiusError : 0;
      patches.push({ i0, j0, step, floored: step <= minStep, radiusError: rErr });
    }
    curMorph = subdivMorphOf(hErr, rErr, hErr0, rErr0, M);
    emitPatch(i0, j0, step);
  };
  // 根补片：step = n / PATCH_QUADS（引擎 level 0 同式）；**取不超过它的 2 的幂**——细分链是
  // step>>1，奇步长（如 n=96 时的 12→6→3）无法二等分，子补片跨度对不上父补片 ⇒ 会留空洞
  // （2026-10-10 实测用例：n=96 时 j≥88 整片未铺）。取 2 的幂后链条恒可二等分；
  // 余下不足一个根补片的边角由 emitPatch 的 `st = min(step, n−ci, n−cj)` 夹取铺满。
  // n 为 8·2^k 的常规图（512 → 64）结果与旧式逐位相同，不受影响。
  for (let i = 0; i < n; i += rootStep * PATCH_QUADS) {
    for (let j = 0; j < n; j += rootStep * PATCH_QUADS) rec(i, j, rootStep, 0);
  }

  // ---------- ② 顶点高度：沿共享边"向粗者让步"的**层级直线**口径 ----------
  // 客户端由顶点着色器（DrawPatchInstancing 的 neighbourMorph）把**细的一侧**的边界顶点拉到
  // **粗的一侧**的平面上；离线等价物必须让"两侧的边界折线是同一条直线"，否则 T 型接缝仍在：
  //   · 顶点处取四象限（texel）中**间距最大**的四边形（记为层级 s，其边界必过该顶点——若顶点在该
  //     四边形内部则四象限同属一个发射格、无人发射它）；
  //   · 顶点落在该格**边的内部**（只有一个坐标是 s 的整数倍）⇒ 取该边的直线值；
  //   · 顶点是该格的**格点角**（两个坐标都是 s 的整数倍）⇒ 只能是 texel 原值（否则会有更粗的象限，
  //     s 就不是最大了）；
  //   · 边的端点（s 的格点）自身可能被**更粗**的象限拉扯 ⇒ 端点值递归求（层级严格变大 ⇒ 良基）。
  // 结果：同一 (i,j) 恒得同一个高度 ⇒ 共享边两侧逐点同高（含跨多级 LOD 的 T 型接缝）。
  const W = n + 1;                                     // 顶点格边长（含边界 0..n）
  const memoAcc = new Float32Array(W * W).fill(NaN);   // 原始通道缓存（NaN = 未算；@512 约 1 MB）
  const memoAvg = new Float32Array(W * W).fill(NaN);   // 均值通道缓存
  const maxQuadSize = (i, j) => {
    let sz = 0;
    for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const s = sizeAt[a * n + b];
      if (s > sz) sz = s;
    }
    return sz;
  };
  /** 该顶点处"最粗相邻补片"的 subdivMorph（同层多片取较小值 ＝ 客户端同层交界的
   *  `Min(xNeg->subdivMorph, morph)`；更粗邻居时客户端直接用粗侧值 ⇒ 与"最粗者"一致）。 */
  const morphRawAt = (i, j, s) => {
    let m = Infinity;
    for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      if (sizeAt[a * n + b] !== s) continue;
      const v = morphRaw[a * n + b];
      if (v < m) m = v;
    }
    return m === Infinity ? 0 : m;
  };
  /** 某一通道的顶点值：最粗相邻层级的格点值/边界直线（端点递归，层级严格变大 ⇒ 良基）。 */
  const channelValue = (get, memo, i, j) => {
    const key = i * W + j;
    const hit = memo[key];
    if (hit === hit) return hit;
    let out;
    const s = maxQuadSize(i, j);
    const mi = s > 0 && i % s === 0, mj = s > 0 && j % s === 0;
    if (i === n || j === n) {
      out = get(i, j, s);                             // 外圈：着色器 zeroLodMul 同款 ⇒ 取该处原始值
    } else if (s <= 1 || (mi && mj)) {
      out = get(i, j, s);
    } else if (mi) {
      const w = Math.floor(j / s) * s, t = (j - w) / s;
      out = channelValue(get, memo, i, w) * (1 - t) + channelValue(get, memo, i, w + s) * t;
    } else if (mj) {
      const w = Math.floor(i / s) * s, t = (i - w) / s;
      out = channelValue(get, memo, w, j) * (1 - t) + channelValue(get, memo, w + s, j) * t;
    } else {
      out = get(i, j, s);                             // 顶点在最粗格内部：理论不可达（无人发射它）
    }
    memo[key] = out;
    return out;
  };
  /** 引擎的双抽头均值通道（`CreateHeightTextureData`）：偶数索引/末索引取自身，奇数索引取对侧
   *  相距一个 step 的邻居之半和；地图外圈按顶点着色器 `zeroLodMul` 退回原始值。 */
  const avgTexel = (i, j, s) => {
    if (i === n || j === n) return H(i, j);           // 外圈：zeroLodMul = 0 ⇒ mip0 零偏移 ⇒ 原始值
    const st = Math.max(1, s);
    const last = Math.floor(n / st) - 1;              // 该 mip 的末纹素索引（引擎 mipLastIndex）
    const x = Math.floor(i / st), y = Math.floor(j / st);
    // 引擎 CreateHeightTextureData（Landscape.cpp:429-461）的配对逐字：
    //   奇数 x：x1 = xx+step、x2 = xx−step；奇数 y：y1 = yy−step、y2 = yy+step。
    //   双奇 ⇒ (x+step, y−step) & (x−step, y+step) —— **反对角**（2026-10-11 勘误：此前误写主对角）。
    //   双偶/末索引取自身（h1 = h2 = 自身 ⇒ 均值 = 原值）。
    let x1 = i, x2 = i, y1 = j, y2 = j;
    if ((x & 1) && x !== last) { x1 = i + st; x2 = i - st; }
    if ((y & 1) && y !== last) { y1 = j - st; y2 = j + st; }
    return (H(x1, y1) + H(x2, y2)) / 2;
  };
  const accAt = (i, j) => channelValue(H, memoAcc, i, j);
  const avgAt = (i, j) => channelValue((ii, jj, s) => avgTexel(ii, jj, s), memoAvg, i, j);
  /** 顶点高度 = lerp(均值通道, 原始通道, morph)（客户端 tilemask-vp.sl 同式）。 */
  const heightAt = (i, j) => {
    const s = maxQuadSize(i, j);
    const acc = accAt(i, j);
    if (s <= 0) return acc;
    const m = morphFunc(morphRawAt(i, j, s));
    if (!(m > 0)) return acc;
    const avg = avgAt(i, j);
    return avg + (acc - avg) * m;
  };

  // ---------- ③ 发射：每格 1 个四边形；顶点按 (i,j) 去重（法线跨叶连续） ----------
  const vmap = new Int32Array(W * W).fill(-1);      // (i,j) → 顶点序号（-1 = 未发射）
  const pos = new Float32Array(leaves.length * 4 * 3);   // 上界 = 不去重（实际去重后远少于此）
  const idx = new Uint32Array(leaves.length * 6);
  let np = 0, ni = 0, nv = 0;
  const v = new Int32Array(4);
  for (const L of leaves) {
    for (let c = 0; c < 4; c++) {
      const di = c >> 1, dj = c & 1;                // 0:(0,0) 1:(0,1) 2:(1,0) 3:(1,1)
      const i = Math.min(L.i0 + di * L.step, n);
      const j = Math.min(L.j0 + dj * L.step, n);
      const key = i * W + j;
      let vi = vmap[key];
      if (vi < 0) {
        vi = nv++;
        vmap[key] = vi;
        pos[np++] = wx(j); pos[np++] = heightAt(i, j); pos[np++] = wz(i);
      }
      v[c] = vi;
    }
    idx[ni++] = v[0]; idx[ni++] = v[2]; idx[ni++] = v[1];
    idx[ni++] = v[1]; idx[ni++] = v[2]; idx[ni++] = v[3];
  }
  // sizeAt / patches 一并返回（诊断/测试用：逐 texel 发射间距、终止补片判据；随几何一起被 GC）
  return {
    positions: pos.subarray(0, np),
    indices: idx.subarray(0, ni),
    quads: leaves.length,
    overBudget,
    sizeAt,
    originIAt,
    originJAt,
    vertexIndexAt: vmap,
    morphRaw,          // 逐 texel 的 subdivMorph（诊断/测试）
    patches,
    metrics: M,
  };
}

/**
 * 常数时间采样自适应地形网格的真实三角面高度。
 * 使用 buildAdaptiveTerrain 生成时的 cell→step / grid-vertex→index 表和最终顶点高度，
 * 因此涵盖当前 LOD、morph 与跨 LOD 缝合，不做 mesh traversal 或重建。
 * 每格拓扑与发射器一致：沿反对角 (i+1,j)→(i,j+1) 分成两个三角形。
 */
export function terrainSurfaceHeightAt({ positions, sizeAt, originIAt, originJAt, vertexIndexAt, n, span }, x, z) {
  if (!positions || !sizeAt || !originIAt || !originJAt || !vertexIndexAt || !Number.isInteger(n) || n < 2
    || !Number.isFinite(span) || span <= 0 || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const gx = (x / span + 0.5) * n, gz = (z / span + 0.5) * n;
  if (gx < 0 || gz < 0 || gx >= n || gz >= n) return null;
  const j = Math.floor(gx), i = Math.floor(gz);
  const step = sizeAt[i * n + j];
  if (!Number.isInteger(step) || step < 1) return null;
  const cell = i * n + j;
  const i0 = originIAt[cell], j0 = originJAt[cell];
  const i1 = Math.min(n, i0 + step), j1 = Math.min(n, j0 + step);
  if (i1 <= i0 || j1 <= j0) return null;
  const width = n + 1;
  const id00 = vertexIndexAt[i0 * width + j0], id01 = vertexIndexAt[i0 * width + j1];
  const id10 = vertexIndexAt[i1 * width + j0], id11 = vertexIndexAt[i1 * width + j1];
  if (id00 < 0 || id01 < 0 || id10 < 0 || id11 < 0) return null;
  const y00 = positions[id00 * 3 + 1], y01 = positions[id01 * 3 + 1];
  const y10 = positions[id10 * 3 + 1], y11 = positions[id11 * 3 + 1];
  if (!Number.isFinite(y00) || !Number.isFinite(y01) || !Number.isFinite(y10) || !Number.isFinite(y11)) return null;
  const tx = (gx - j0) / (j1 - j0), tz = (gz - i0) / (i1 - i0);
  return tx + tz <= 1
    ? y00 * (1 - tx - tz) + y01 * tx + y10 * tz
    : y01 * (1 - tz) + y10 * (1 - tx) + y11 * (tx + tz - 1);
}
