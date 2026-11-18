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

export {
  CLIENT_NORMAL_CAMERA_FOV_H,
  MAX_QUADS,
  PATCH_QUADS,
  SUBDIVISION_METRICS,
  TERRAIN_LOD_MIN_INTERVAL_MS,
  buildRefineMask,
  groundMapUv,
  subdivisionMetrics,
  terrainLodPoseReason,
  terrainLodStale,
  terrainLodStaleReason,
  terrainLodState,
} from './terrainMeshLod.js'
export {
  TERRAIN_LAYOUT_ENGINE_VERTEX,
  decodeTerrainField,
  pairedTerrainBinUrl,
  terrainBinMatchesMeta,
  terrainBoundsOk,
  terrainFieldMetaValid,
} from './terrainMeshField.js'
export { buildAdaptiveTerrain, morphFunc, subdivMorphOf } from './terrainMeshBuild.js'
export { terrainSurfaceHeightAt } from './terrainSurface.js'
