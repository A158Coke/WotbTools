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
 *          （`radius` = 补片包围盒对角半长；`patchDistance` = 到包围盒中心）——**近处必须细**，
 *          这条是"贴着地面的薄结构（铁轨/路缘/贴花）不被地形盖住"的保证；
 *       ② 屏幕高度 `|maxError| / (errorDistance · tanFovY) ≥ maxHeightError`——距离取**最差样本
 *          位置**（不是补片中心）；
 *       ③ 绝对高度 `|maxError| > maxAbsoluteHeightError`（3 m，与距离无关）。
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

/** 当前 fov 下的细分阈值与投影系数（客户端 `PrepareSubdivision` 的等价物）。
 *  @param fovYRad 相机**竖直** fov（three.js 口径，弧度）
 *  @param aspect  宽/高
 *  @param tolScale 阈值系数（1 = 客户端原口径；越小越细——`?terrainlod`） */
export function subdivisionMetrics(fovYRad, aspect = 16 / 9, tolScale = 1) {
  const v = Number.isFinite(fovYRad) && fovYRad > 0 ? fovYRad : 0.96;
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const tanFovY = Math.tan(v / 2);
  const hFovDeg = (2 * Math.atan(tanFovY * a) * 180) / Math.PI;
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

/** 地形 LOD 是否已过期（**单向滞回**）：拉近一律细化（≥5% 即重建），拉远才允许变粗（≥40%），
 *  且两次重建至少隔 `minIntervalMs`（帧预算）。返回 true 表示应重建。
 *  为什么单向：双向滞回（旧实现 25%/25%）会让网格长期停在"更远视距"的**更粗**层级 ⇒ 同一相机位置
 *  我们的单元格可比客户端判据允许的更粗，粗格插值把地形抬到贴地薄结构（铁轨 0.3 m 厚）之上，
 *  且随轨道距离变化"时有时无"（2026-10-10 用户报障）。单向滞回保证**永不比客户端更粗**。 */
export function terrainLodStale(prevDist, dist, sinceMs, minIntervalMs = 120) {
  if (!(prevDist > 0)) return true;                 // 首帧
  const rel = (dist - prevDist) / Math.max(1, prevDist);
  if (rel <= -0.05 || rel >= 0.40) return sinceMs >= minIntervalMs;
  return false;
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
 * @param field   Float32Array(n*n)：行 0=南、列 0=西 的高度（米），索引 = row*n+col
 * @param n       高度图边长（texel 数，如 512；非 8·2^k 的退化值只影响层级嵌套，仍铺满）
 * @param span    世界跨度（米）；顶点世界坐标 = (i/n − 0.5)·span（角点口径，引擎同构）
 * @param cam     { x, y, z } 相机位置（场景系）
 * @param fovY    相机竖直 fov（弧度）
 * @param aspect  宽/高（阈值插值与投影系数用）
 * @param minStep 最细顶点间距（texel；1 = 引擎最细层）
 * @param tolScale 阈值系数（1 = 客户端口径）
 * @param shores  水面/水下薄板标高表 `[{ y, x0, x1, z0, z1 }]`（世界系）——**第四条判据**：
 *                补片矩形与某片水面的占地相交、且该补片的格点高度范围跨越其标高 ⇒ 一路细分到
 *                `minStep`（=1 texel），即"把水陆交界当特征解析"。理由（2026-10-10 用户"和地形的
 *                交接处还是锯齿状：拉近变细、旋转时形状固定"）：岸线在源数据里是**平缓坡**（2–5 cm
 *                /texel），客户端相机始终很近 ⇒ 它那里的网格天然是 1 texel 级、岸线细致；我们的
 *                回放相机常在数百米外 ⇒ 三条客户端判据（同一相机位置）**合法地**给出粗格 ⇒ 平缓坡
 *                被量化成米级台阶。这是"客户端看得清、我们从远处看不清"的同一类差异（同让位掩码），
 *                与手工补偿无关：判据只用数据里真实存在的标高，且细分终点是数据自身的分辨率。
 *                跨步判定用补片格点范围——**与发射几何同源**（发射的顶点高度也取这些 texel 值），
 *                故"格点不跨步 ⇒ 发射面不跨步"，不需要任何余量常数。
 * @returns { positions, indices, quads, overBudget, sizeAt }
 */
export function buildAdaptiveTerrain({ field, n, span, cam, fovY, aspect = 16 / 9, minStep = 1, tolScale = 1, shores = null }) {
  if (!field || !Number.isFinite(n) || n < 2) throw new Error('buildAdaptiveTerrain: 需 field 与 n ≥ 2')
  const H = (i, j) => field[Math.min(i, n - 1) * n + Math.min(j, n - 1)];
  const wx = (j) => (j / n - 0.5) * span;
  const wz = (i) => (i / n - 0.5) * span;
  const M = subdivisionMetrics(fovY, aspect, tolScale);
  const camX = Number.isFinite(cam?.x) ? cam.x : 0;
  const camY = Number.isFinite(cam?.y) ? cam.y : 0;
  const camZ = Number.isFinite(cam?.z) ? cam.z : 0;
  const dTo = (x, y, z) => {
    const dx = x - camX, dy = y - camY, dz = z - camZ;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  // ---------- ① 补片级细分（客户端三条判据；终止补片内部 = 8×8 四边形）----------
  const sizeAt = new Int32Array(n * n);   // 逐 texel：所属发射四边形的顶点间距（② 的顶点高度口径要用）
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
            morphRaw[i * n + j] = curMorph;
          }
        }
      }
    }
  };
  // 补片探针 = 客户端 `UpdatePatchInfo`（误差/半径）+ `SubdividePatch`（判定）的直译：
  //   ① 9×9 格点一次读入 ⇒ 顶点盒 ⇒ `radiusError`（引擎里该项**恒**由补片 radius 得出）；
  //   ② 高度误差恒量满（8×8 格 × 5 样本取最大，记最差样本位置；引擎对除最细层外的所有层都算；
  //      最细层 `step == 1` 时 `patch->maxError = 0`）；
  //   ③ 判定三条按 `||`（顺序不影响结果）；**两个误差值必须一并返回**——子补片的
  //      `subdivMorph` 要用父补片的同名误差（`error0Delta`），短路掉不给值会让 morph 恒 0
  //      （2026-10-10 实测：报障点 morphRaw = 0，改成恒量满后恢复）。
  const lat = new Float64Array((PATCH_QUADS + 1) * (PATCH_QUADS + 1));   // 复用的格点缓存
  const probePatch = (i0, j0, step) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    let k = 0;
    for (let a = 0; a <= PATCH_QUADS; a++) {
      const ii = Math.min(i0 + a * step, n), z = wz(ii);
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      for (let b = 0; b <= PATCH_QUADS; b++) {
        const jj = Math.min(j0 + b * step, n), x = wx(jj), y = H(ii, jj);
        lat[k++] = y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    const bx = (minX + maxX) / 2, by = (minY + maxY) / 2, bz = (minZ + maxZ) / 2;
    const radius = Math.sqrt((maxX - bx) ** 2 + (maxY - by) ** 2 + (maxZ - bz) ** 2);
    const radiusError = radius / (dTo(bx, by, bz) * M.tanFovY);
    let err = 0, ei = i0, ej = j0;
    if (step >= 2) {                       // 最细层 step == 1：引擎该层 maxError = 0（不采样）
      const w = PATCH_QUADS + 1, h = step >> 1;
      for (let a = 0; a < PATCH_QUADS; a++) {
        for (let b = 0; b < PATCH_QUADS; b++) {
          const ci = i0 + a * step, cj = j0 + b * step;
          if (ci >= n || cj >= n) continue;
          const p00 = lat[a * w + b], p01 = lat[a * w + b + 1];
          const p10 = lat[(a + 1) * w + b], p11 = lat[(a + 1) * w + b + 1];
          for (const [pi, pj, ap] of [
            [ci, cj + h, (p00 + p01) / 2],
            [ci + h, cj, (p00 + p10) / 2],
            [ci + h, cj + h, (p00 + p11) / 2],
            [ci + step, cj + h, (p10 + p11) / 2],
            [ci + h, cj + step, (p01 + p11) / 2],
          ]) {
            const e = Math.abs(H(pi, pj) - ap);
            if (e > err) { err = e; ei = pi; ej = pj; }
          }
        }
      }
    }
    const heightError = err / (dTo(wx(ej), H(ei, ej), wz(ei)) * M.tanFovY);
    // 注：试过"按补片最远角评估同一预算"的保守读法，对铁轨一带**无效**（那里误差远低于预算 ⇒ 不触发），
    // 只平白增三角形 ⇒ 不采用；铁轨的远距遮挡属客户端预算本身（见 docs）。
    const subdivide = radiusError >= M.maxPatchRadiusError
      || heightError >= M.maxHeightError
      || err > M.maxAbsoluteHeightError;
    return { subdivide, err, heightError, radiusError, minY, maxY };
  };
  // 岸线特征判定（第四条判据）：补片 (x,z) 矩形与某片水面占地相交、且格点高度范围跨越其标高。
  const shoreHit = (i0, j0, step, minY, maxY) => {
    if (!shores || !shores.length) return false;
    const x0 = wx(j0), x1 = wx(Math.min(j0 + PATCH_QUADS * step, n));
    const z0 = wz(i0), z1 = wz(Math.min(i0 + PATCH_QUADS * step, n));
    for (let s = 0; s < shores.length; s++) {
      const sh = shores[s];
      if (x1 < sh.x0 || x0 > sh.x1 || z1 < sh.z0 || z0 > sh.z1) continue;
      if (minY <= sh.y && sh.y <= maxY) return true;
    }
    return false;
  };
  const patches = [];        // 终止补片及其判据值（诊断/测试：直接验证三条判据）
  // *Err0 = 父补片同名误差（引擎把当前层的 heightError/radiusError 传给子层当 *0；
  // 根调用传阈值本身 ⇒ 根补片 error0Delta = 0 ⇒ subdivMorph = 0，与引擎 SubdividePatch 首调一致）。
  const rec = (i0, j0, step, hErr0 = M.maxHeightError, rErr0 = M.maxPatchRadiusError) => {
    const roomLeft = leaves.length + PATCH_QUADS * PATCH_QUADS <= MAX_QUADS;
    let hErr = 0, rErr = 0;
    if (step > minStep && roomLeft) {
      const p = probePatch(i0, j0, step);
      if (p.subdivide || shoreHit(i0, j0, step, p.minY, p.maxY)) {
        const h = step >> 1;
        // fail-closed：奇数 step 无法二等分（子补片跨度 8·h 对不上父补片 8·step ⇒ 会留空洞）。
        // 根步长已取 2 的幂（见下），本支实际不可达；保留只为杜绝"细分出洞"的可能。
        if (h * 2 !== step) {
          hErr = p.heightError; rErr = p.radiusError;
          patches.push({ i0, j0, step, err: p.err, heightError: hErr, radiusError: rErr });
        } else {
          for (const [di, dj] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
            rec(i0 + di * PATCH_QUADS * h, j0 + dj * PATCH_QUADS * h, h, p.heightError, p.radiusError);
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
      const p = step <= minStep ? probePatch(i0, j0, step) : null;
      hErr = 0;
      rErr = p ? p.radiusError : 0;
      patches.push({ i0, j0, step, floored: step <= minStep, radiusError: rErr });
    }
    curMorph = subdivMorphOf(hErr, rErr, hErr0, rErr0, M);
    emitPatch(i0, j0, step);   // 终止（或预算用尽）⇒ 按当前层出几何；始终铺满、不留空洞
  };
  // 根补片：step = n / PATCH_QUADS（引擎 level 0 同式）；**取不超过它的 2 的幂**——细分链是
  // step>>1，奇步长（如 n=96 时的 12→6→3）无法二等分，子补片跨度对不上父补片 ⇒ 会留空洞
  // （2026-10-10 岸线用例实测：n=96 时 j≥88 整片未铺）。取 2 的幂后链条恒可二等分；
  // 余下不足一个根补片的边角由 emitPatch 的 `st = min(step, n−ci, n−cj)` 夹取铺满。
  // n 为 8·2^k 的常规图（512 → 64）结果与旧式逐位相同，不受影响。
  const rootStep = Math.max(1, 2 ** Math.floor(Math.log2(Math.max(1, Math.floor(n / PATCH_QUADS)))));
  for (let i = 0; i < n; i += rootStep * PATCH_QUADS) {
    for (let j = 0; j < n; j += rootStep * PATCH_QUADS) rec(i, j, rootStep);
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
    let x1 = i, x2 = i, y1 = j, y2 = j;
    if ((x & 1) && x !== last) { x1 = i + st; x2 = i - st; }
    if ((y & 1) && y !== last) { y1 = j + st; y2 = j - st; }
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
    morphRaw,          // 逐 texel 的 subdivMorph（诊断/测试）
    patches,
    metrics: M,
  };
}
