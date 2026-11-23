import { MAX_QUADS, PATCH_QUADS, subdivisionMetrics, type SubdivisionMetrics } from './terrainMeshLod.js'

interface TerrainPoint { x: number; y: number; z: number }
interface PatchLevel {
  patchSize: number
  perAxis: number
  step: number
  maxErr: Float32Array
  posI: Int32Array
  posJ: Int32Array
  posH: Float32Array
  minX: Float32Array
  maxX: Float32Array
  minZ: Float32Array
  maxZ: Float32Array
  minH: Float32Array
  maxH: Float32Array
  radius: Float32Array
}
interface PatchTable { n: number; span: number; rootStep: number; levels: PatchLevel[]; K: number }
interface PatchProbe { subdivide: boolean; err: number; heightError: number; radiusError: number }
interface TerrainPatchDiagnostic {
  i0: number
  j0: number
  step: number
  err?: number
  heightError?: number
  radiusError?: number
  floored?: boolean
}
interface BuildTerrainOptions {
  field: Float32Array
  n: number
  span: number
  cam: TerrainPoint
  fovY: number
  aspect?: number
  minStep?: number
  tolScale?: number
  hFovDeg?: number | null
  refineMask?: Uint8Array | null
}
interface TerrainBuildResult {
  positions: Float32Array
  indices: Uint32Array
  quads: number
  overBudget: boolean
  sizeAt: Int32Array
  originIAt: Uint16Array | Uint32Array
  originJAt: Uint16Array | Uint32Array
  vertexIndexAt: Int32Array
  morphRaw: Float32Array
  patches: TerrainPatchDiagnostic[]
  metrics: SubdivisionMetrics
}

/** 引擎 `Landscape::morphFunc`（Landscape.cpp:1213）：4(1−x)⁵ − 5(1−x)⁴ + 1（x 夹到 [0,1]）。 */
export function morphFunc(x: number): number {
  const y = 1 - Math.max(0, Math.min(1, x));
  const y4 = y * y * y * y;
  return y4 * (4 * y - 5) + 1;
}

/** 引擎 `SubdividePatch` 末尾的 `subdivMorph`（误差比口径；*0 = 父补片的同名误差）。 */
export function subdivMorphOf(heightError: number, radiusError: number, heightError0: number, radiusError0: number, M: SubdivisionMetrics): number {
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
function buildPatchTableAscending(field: Float32Array, n: number, span: number, rootStepNow: number): PatchTable {
  const H = (i: number, j: number) => field[Math.min(i, n - 1) * n + Math.min(j, n - 1)];
  const wx = (j: number) => (j / n - 0.5) * span;
  const wz = (i: number) => (i / n - 0.5) * span;
  const K = Math.round(Math.log2(rootStepNow)) + 1;
  const levels: PatchLevel[] = [];
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

const patchTableCache = new WeakMap<Float32Array, PatchTable>()
function patchTableFor(field: Float32Array, n: number, span: number, rootStep: number): PatchTable {
  let hit = patchTableCache.get(field);
  if (hit && hit.n === n && hit.span === span && hit.rootStep === rootStep) return hit;
  const built = buildPatchTableAscending(field, n, span, rootStep);
  patchTableCache.set(field, built);
  return built;
}

export function buildAdaptiveTerrain({ field, n, span, cam, fovY, aspect = 16 / 9, minStep = 1, tolScale = 1, hFovDeg = null, refineMask = null }: BuildTerrainOptions): TerrainBuildResult {
  if (!field || !Number.isFinite(n) || n < 2) throw new Error('buildAdaptiveTerrain: 需 field 与 n ≥ 2')
  const H = (i: number, j: number) => field[Math.min(i, n - 1) * n + Math.min(j, n - 1)];
  const wx = (j: number) => (j / n - 0.5) * span;
  const wz = (i: number) => (i / n - 0.5) * span;
  const M = subdivisionMetrics(fovY, aspect, tolScale, hFovDeg);
  const camX = Number.isFinite(cam?.x) ? cam.x : 0;
  const camY = Number.isFinite(cam?.y) ? cam.y : 0;
  const camZ = Number.isFinite(cam?.z) ? cam.z : 0;
  const dTo = (x: number, y: number, z: number) => {
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
  const cellOrigins: number[] = []   // 仅记原点下标；格距已保存在 sizeAt 中。
  let overBudget = false;
  let curMorph = 0;                       // emitPatch 期间该补片的 subdivMorph
  const emitPatch = (i0: number, j0: number, step: number): void => {
    for (let a = 0; a < PATCH_QUADS; a++) {
      for (let b = 0; b < PATCH_QUADS; b++) {
        const ci = i0 + a * step, cj = j0 + b * step;
        if (ci >= n || cj >= n) continue;
        const st = Math.min(step, n - ci, n - cj);   // 退化 n：末格夹取（H 亦夹到 n−1 = GetHeightClamp）
        cellOrigins.push(ci * n + cj);
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
  const maskLevels: Uint8Array[] | null = refineMask ? (() => {
    const out: Uint8Array[] = new Array(table.levels.length)
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
  const corridorForced = (level: number, i0: number, j0: number): boolean => {
    if (!maskLevels) return false;
    const lv = table.levels[level];
    const iy = Math.min(Math.max(Math.floor(i0 / lv.patchSize), 0), lv.perAxis - 1);
    const ix = Math.min(Math.max(Math.floor(j0 / lv.patchSize), 0), lv.perAxis - 1);
    return maskLevels[level][iy * lv.perAxis + ix] === 1;
  };
  // 相机相关判定 = 客户端 `SubdividePatch`（`:251-258`）：距离/投影换算 + 三条判据。
  // 返回的两个误差值必须一并传出——子补片的 `subdivMorph` 要用父补片的同名值（`error0Delta`）。
  const patchProbe = (i0: number, j0: number, _step: number, level: number): PatchProbe => {
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
  const patches: TerrainPatchDiagnostic[] = []        // 终止补片及其判据值（诊断/测试：直接验证三条判据）
  // *Err0 = 父补片同名误差（引擎把当前层的 heightError/radiusError 传给子层当 *0；
  // 根调用传阈值本身 ⇒ 根补片 error0Delta = 0 ⇒ subdivMorph = 0，与引擎 SubdividePatch 首调一致）。
  const rec = (i0: number, j0: number, step: number, level: number, hErr0 = M.maxHeightError, rErr0 = M.maxPatchRadiusError): void => {
    const roomLeft = cellOrigins.length + PATCH_QUADS * PATCH_QUADS <= MAX_QUADS;
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
  const maxQuadSize = (i: number, j: number): number => {
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
  const morphRawAt = (i: number, j: number, s: number): number => {
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
  const channelValue = (get: (i: number, j: number, s: number) => number, memo: Float32Array, i: number, j: number, knownStep?: number): number => {
    const key = i * W + j;
    const hit = memo[key];
    if (hit === hit) return hit;
    let out;
    const s = knownStep ?? maxQuadSize(i, j);
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
  const avgTexel = (i: number, j: number, s: number): number => {
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
  /** 顶点高度 = lerp(均值通道, 原始通道, morph)（客户端 tilemask-vp.sl 同式）。 */
  const heightAt = (i: number, j: number): number => {
    const s = maxQuadSize(i, j);
    const acc = channelValue(H, memoAcc, i, j, s);
    if (s <= 0) return acc;
    const m = morphFunc(morphRawAt(i, j, s));
    if (!(m > 0)) return acc;
    const avg = channelValue(avgTexel, memoAvg, i, j, s);
    return avg + (acc - avg) * m;
  };

  // ---------- ③ 发射：每格 1 个四边形；顶点按 (i,j) 去重（法线跨叶连续） ----------
  const vmap = new Int32Array(W * W).fill(-1);      // (i,j) → 顶点序号（-1 = 未发射）
  const pos = new Float32Array(Math.min(cellOrigins.length * 4, W * W) * 3);   // 顶点最多覆盖整张格点表
  const idx = new Uint32Array(cellOrigins.length * 6);
  let np = 0, ni = 0, nv = 0;
  const v = new Int32Array(4);
  for (const origin of cellOrigins) {
    const i0 = Math.floor(origin / n), j0 = origin - i0 * n;
    const step = sizeAt[origin];
    for (let c = 0; c < 4; c++) {
      const di = c >> 1, dj = c & 1;                // 0:(0,0) 1:(0,1) 2:(1,0) 3:(1,1)
      const i = Math.min(i0 + di * step, n);
      const j = Math.min(j0 + dj * step, n);
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
    quads: cellOrigins.length,
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
