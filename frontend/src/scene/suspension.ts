
/**
 * 坦克悬挂求解（客户端同构）——纯函数层。
 *
 * 逆向证据与公式出处：上游 `docs/tank-suspension-client-re.md` §六（第二轮反汇编）。
 * 与客户端逐条对应：
 *   1) 负重轮 = **纯竖直平移**，夹到 `[pz − b, pz + a]`（yaml `wheels` 的 `{flag, a, b}`，
 *      `flag = 1` 参与贴地、`0`（诱导/主动/托带轮）不参与），按 `wheelsReactionSpeed` 限速
 *      逼近（首次可见直接吸附）——`clampTravel` / `rateLimitTravel`。
 *   2) 自转 = 绕轮节点**局部 X 轴** `θ += −Δs_侧 / r`（左右各用自己的纵向位移，差速自动成立）
 *      ——`spinStep`。
 *   3) 履带 = **静止折线（链路）+ 逐轮偏移 → 悬空段垂弧 → 铺地**，顺序与客户端
 *      `Bending → Laying` 一致（本模块 `solveChain` 的第 2/3/4 步）。
 *      垂弧形状 = 客户端 `(t − t²)` 抛物线，幅度用 `upperFactor · span^lengthPower`
 *      （`lengthPower` 是幂次已确定；`upperMin/frontFactor/backFactor` 的逐项落位未定，
 *      本实现按统一幅度近似——上游 §五.4）。
 *   4) 花纹滚动：每米 V 变化 = 该带**网格实测**的沿带斜率 dV/ds（`measureBeltUvSlope`），
 *      使花纹线速度恰等于履带速度——见 `treadScrollStep` 及其 2026-10-10 勘误（客户端形式
 *      常数 `textureScale / chunkLength` 比网格真实斜率大 3.4~19×，不可用）。
 *
 * 求解层不依赖 three.js（入参是普通数组/标量，便于单测）；仅位姿写入 `applyWheelSpin`
 * 触 three（场景侧做容器与写入）。
 */

/** 客户端 `wheels` 记录缺省（数据缺失时的兜底；正常路径不用） */
export const SUSP_FALLBACK = { travelUp: 0.08, travelDown: 0.08, reaction: 1.0 };

/**
 * 行程夹紧：`clamp(Δ, −down, +up)`（客户端 `[pz − b, pz + a]` 的等价形）。
 * @param {number} delta 局部 +z 方向需要的位移（m）
 * @param {number} up 上行（压缩）行程（m）
 * @param {number} down 下行（下垂）行程（m）
 */
export function clampTravel(delta: number, up: number, down: number): number {
  const hi = Number.isFinite(up) ? up : SUSP_FALLBACK.travelUp;
  const lo = Number.isFinite(down) ? down : SUSP_FALLBACK.travelDown;
  return delta > hi ? hi : (delta < -lo ? -lo : delta);
}

/**
 * 限速逼近（客户端 `copysign(min(|Δ|, wheelsReactionSpeed·dt), Δ)`）：
 * 首次可见（`snap`）直接吸附——与客户端"首帧不插值"一致。
 */
export function rateLimitTravel(current: number, target: number, rate: number, dt: number, snap: unknown): number {
  if (snap || !(dt > 0)) return target;
  const step = (Number.isFinite(rate) && rate > 0 ? rate : SUSP_FALLBACK.reaction) * dt;
  const d = target - current;
  if (d > step) return current + step;
  if (d < -step) return current - step;
  return target;
}

const TWO_PI = Math.PI * 2;

/** 周期折叠到 ±2π（客户端 `θ = wrap(θ + …)`） */
export function wrapSpin(theta: number): number {
  let t = theta % TWO_PI;
  if (t > Math.PI) t -= TWO_PI;
  if (t < -Math.PI) t += TWO_PI;
  return t;
}

/**
 * 轮自转步进：`θ += −Δs / r`。
 * 符号：模型系（y 前 / z 上 / x 右）里"向前滚动且不打滑" ⇒ 绕 **+X** 的角速度 ω = −v/r
 * （顶部随车向前、底部相对车向后），与客户端写骨骼旋转块的 (−θ/2) 半角域一致。
 */
export function spinStep(theta: number, distSide: number, radius: number): number {
  if (!(radius > 1e-4)) return theta;
  return wrapSpin(theta - distSide / radius);
}

/**
 * 花纹滚动步进：`ΔV = Δs · dvPerM`，返回累计后的 V（调用方就地取模写 UV）。
 *
 * `dvPerM` = 该带**网格实测**的沿带斜率（[`measureBeltUvSlope`] × 底段走向），单位 V/米：
 * 这样花纹沿带的线速度恰好等于履带速度（接地段在世界里静止，与真车一致）。
 *
 * ⚠️ 2026-10-10 勘误：曾用客户端形式常数 `chassis.textureScale / chunkLength`——实测它比
 * 网格真实斜率**大 3.4~19×**（30 辆抽样，中位 4.5×）。原因是那条常数活在客户端自己的
 * shader V 空间（一个 chunk 一份原型），与导出网格的图集式 per-link V 不同量纲。
 */
export function treadScrollStep(vOffset: number, distSide: number, dvPerM: number): number {
  if (!(Math.abs(dvPerM) > 1e-6)) return vOffset;
  return vOffset + distSide * dvPerM;
}

/**
 * 地形"掉高"折算到车体系局部 +z：把世界竖直差除以车体 up 轴的世界 y 分量。
 * 车体倾倒到 |upY| 过小时返回 0（求解停摆而非发散，fail-safe）。
 */
export function groundDropLocal(terrainH: number, restWorldY: number, upWorldY: number): number {
  if (!(Math.abs(upWorldY) > 0.25)) return 0;
  return (terrainH - restWorldY) / upWorldY;
}

/** 客户端 wheels 记录中求解层消费的几何字段（链坐标系）。 */
export interface SuspensionWheel {
  longitudinal: number
  radius?: number
  centerZ?: number
}

/** 静止链路点：`[纵向 y, 高度 z]`（模型系纵剖面，米）。 */
export type ChainPoint = [number, number]

/**
 * 链点 → 轮 挂接表：**轮缘几何**判据——链点落在该轮圆周上（`|‖p−c‖ − r|` 在履带板厚容差内）。
 * 未被任何轮覆盖的点返回 −1（悬空段内点）。
 *
 * 为什么不用客户端链折线的逐点 `flag` 选轮（2026-11-17 两轮实测）：
 * - 上游逆向文档对该 flag 的结论是**语义未定**（`docs/tank-suspension-client-re.md` §五：
 *   「`flag` 分布与小轮/托带位置相关……语义仍未定」），而 `Suspension::HangingSegment`
 *   的语义**已定**为「支座轮之间的履带段」。把 flag 当「点→轮」分组是对它的过读；
 *   实测反例 VK 30.02 (M)/15889 左链 idx 8 `[2.1930, 0.0391]`：纵向距上方托带轮 `L_02`
 *   0.201 m、距负重轮 `L_03` 0.225 m，按 flag+纵向选会挂到托带轮（轮缘残差 0.843 m、
 *   且 flag=0 行程恒 0），底段被钉住、与压缩中的负重轮分离（PR review P2）。
 * - 还有一类型号（实测 1089 = 法国 B1：18 个底部小轮 r=0.1、上支段在 z≈1.5，而模型里
 *   z 1.15–1.70 **没有任何几何体**）根本没有对应的托带轮节点，flag 点无处可挂。
 * 因此 flag 只用于**分段**（见 `chainSpanBoundaries`，不覆盖轮接触关系），挂接保持历史几何判据。
 *
 * @param {Array<[number, number]>} chain 静止链路，每点 `[纵向 y, 高度 z]`（m）
 * @param {Array<{longitudinal:number, radius:number}>} wheels 逐轮（纵向位置 = 链坐标系里的 y）
 * @param {number} tolFactor 容差系数（`max(0.10, tolFactor × 轮半径)`）
 * @returns {Int32Array} 每点的轮号，−1 = 无
 */
export function attachChainToWheels(chain: readonly ChainPoint[], wheels: readonly SuspensionWheel[], tolFactor = 0.45): Int32Array {
  const out = new Int32Array(chain.length).fill(-1);
  // 判据 = 「链点在**该轮圆周上**」：|‖p − c‖ − r| 落在履带板厚容差内。
  // 单看纵向会误挂——上支段与底段同纵向，但上支段在轮顶上方一个直径处（客户端真正的
  // 支承关系是"带贴着轮缘"，含上支段的托带轮）。
  for (let i = 0; i < chain.length; i++) {
    const [cy, cz] = chain[i];
    let best = -1, bestD = Infinity;
    for (let w = 0; w < wheels.length; w++) {
      const wh = wheels[w];
      const r = wh.radius || 0.3;
      if (Math.abs(cy - wh.longitudinal) > r + 0.1) continue;
      const dz = cz - (wh.centerZ || 0);
      const dist = Math.hypot(cy - wh.longitudinal, dz);
      const tol = Math.max(0.10, tolFactor * r);
      const err = Math.abs(dist - r);
      if (err <= tol && err < bestD) { bestD = err; best = w; }
    }
    out[i] = best;
  }
  return out;
}

/**
 * 悬空段（`Suspension::HangingSegment`）的边界：**挂接点 ∪ 作者 flag 点**（升序去重）。
 *
 * 客户端的段表是 `{kind; i0; i1; aux}`（垂弧 kind==4 / 包轮其它），由客户端自己枚举，
 * 我们的导出里没有段表，只有链点上的 flag（语义未定，但「分布与小轮/托带位置相关」）。
 * 因此只把 flag 当作**额外的分段标记**：取并集意味着**只会把历史跨距切得更细、绝不合并**
 * （历史边界 = 挂接点，全部保留）——零行程/零贴地时的形变只会更小或不变。实测 20 个车型：
 * 相对历史口径的最大偏差 0 或负值（7297 60TP 0.92→0.06；1089 B1 0.32→0.01）。
 *
 * flag 列不可用（缺失 / 长度不符 / **任一**取值非 0-1，含 `NaN`——混合旧/异常链会给出缺列）
 * 时**整列不参与**分段：先整列校验，再一次性并入，绝不会留下半列的边界
 * （评审 P2：曾边加边校验，遇到中段非法值会把前半列的 flag 边界留在结果里）。
 */
export function chainSpanBoundaries(attach: ArrayLike<number>, flags: ArrayLike<number> | null | undefined): number[] | null {
  const n = attach.length;
  const set = new Set<number>();
  for (let i = 0; i < n; i++) if (attach[i] >= 0) set.add(i);
  if (flagsUsable(flags, n)) {
    for (let i = 0; i < n; i++) if ((flags as ArrayLike<number>)[i] === 1) set.add(i);
  }
  const out = [...set].sort((a, b) => a - b);
  return out.length >= 2 ? out : null;
}

/** flag 列是否整列可用：长度一致且每个取值都是 0 或 1（`NaN` / 缺列 / 其它值 ⇒ 不可用）。 */
function flagsUsable(flags: ArrayLike<number> | null | undefined, n: number): boolean {
  if (!flags || flags.length !== n) return false;
  for (let i = 0; i < n; i++) {
    const f = flags[i];
    if (f !== 0 && f !== 1) return false;
  }
  return true;
}

/**
 * 链路解算（客户端顺序：逐轮偏移 → 悬空段垂弧 → 铺地）。
 *
 * @param {Float64Array|number[]} out 输出高度（长度 = 链点数；写入后由调用方转成位移量）
 * @param {Array<[number, number]>} rest 静止链路 `[纵向, 高度]`
 * @param {Int32Array} attach 点→轮（−1 = 无）
 * @param {number[]} wheelDelta 逐轮局部 +z 位移（已夹紧/限速；未参与解算的轮传 0）
 * @param {number[]} groundDrop 逐点"贴地所需局部 z 位移"（≤0 = 地面在下方，不接触）
 * @param {Array<{centerZ:number, longitudinal:number, radius:number}>} wheels 逐轮几何
 * @param {{upper_factor:number, length_power:number}} bend 垂弧系数
 * @param {number[]|null} [spans] 悬空段边界（升序索引，见 `chainSpanBoundaries`）。缺省时按
 *   「相邻挂接点」枚举（历史口径）；给出时只在相邻边界之间垂弧——边界可以不是挂接点。
 * @returns {{maxAbs:number}} 本次解算的最大绝对位移（脏判据用）
 */
export function solveChain(out: Float64Array | number[], rest: readonly ChainPoint[], attach: Int32Array, wheelDelta: readonly number[] | Float64Array, groundDrop: readonly number[] | Float64Array, wheels: readonly SuspensionWheel[], bend: { upper_factor?: number; length_power?: number } | null | undefined, spans?: readonly number[] | null): { maxAbs: number } {
  const n = rest.length;
  let maxAbs = 0;
  // 1) 逐轮偏移：挂接点随轮移动（客户端 `chain[i] += wheelInfo.offset`）
  for (let i = 0; i < n; i++) {
    const w = attach[i];
    out[i] = rest[i][1] + (w >= 0 ? (wheelDelta[w] ?? 0) : 0);
  }
  // 2) 悬空段垂弧：在**段边界**之间按 `(t − t²)` 抛物线向下垂
  const sagFactor = bend && typeof bend.upper_factor === 'number' && Number.isFinite(bend.upper_factor) ? Math.max(0, bend.upper_factor) : 0;
  const sagPow = bend && typeof bend.length_power === 'number' && bend.length_power !== undefined && Number.isFinite(bend.length_power) ? bend.length_power : 0.5;
  const sagSpan = (i: number, j: number) => {
    if (!(j > i + 1) || j >= n) return;
    const span = Math.abs(rest[j][0] - rest[i][0]);
    const sag = sagFactor * Math.pow(Math.max(span, 1e-3), sagPow);
    const y0 = out[i], y1 = out[j];
    for (let k = i + 1; k < j; k++) {
      const t = (k - i) / (j - i);
      out[k] = y0 + (y1 - y0) * t - sag * (t - t * t);
    }
  };
  if (spans && spans.length >= 2) {
    for (let s = 0; s + 1 < spans.length; s++) sagSpan(spans[s], spans[s + 1]);
  } else {
    let i = 0;
    while (i < n) {
      if (attach[i] < 0) { i++; continue; }
      let j = i + 1;
      while (j < n && attach[j] < 0) j++;
      sagSpan(i, j);
      i = j;
    }
  }
  // 3) 包轮约束：**经过轮顶**的链点不得切进轮胎圆（客户端 `y = max(y, cy + sqrt(r² − dx²))`）。
  //    只对静止高度在轮心以上的点生效——底段在轮心**以下**（履带板厚），套用会把它顶到轮顶。
  for (let k = 0; k < n; k++) {
    const w = attach[k];
    if (w < 0) continue;
    const wh = wheels[w];
    const r = wh.radius || 0;
    if (!(r > 1e-4)) continue;
    const cz = wh.centerZ || 0;
    if (rest[k][1] <= cz) continue;
    const dx = rest[k][0] - wh.longitudinal;
    if (Math.abs(dx) >= r) continue;
    const top = cz + Math.sqrt(Math.max(0, r * r - dx * dx));
    if (out[k] < top) out[k] = top;
  }
  // 4) 铺地（客户端 Laying）：低于地面的点抬到地面；地面在下方（drop<0）时**不跟**下来
  for (let k = 0; k < n; k++) {
    const laid = rest[k][1] + (groundDrop[k] ?? 0);
    if (out[k] < laid) out[k] = laid;
  }
  for (let k = 0; k < n; k++) {
    const d = Math.abs(out[k] - rest[k][1]);
    if (d > maxAbs) maxAbs = d;
  }
  return { maxAbs };
}

/**
 * 顶点 → 链路映射（一次性）：把网格顶点投影到静止链路（(纵向, 高度) 平面），
 * 返回每顶点的 `[段号, 段内 t]`。顶点与链路同处"模型系纵剖面"，故直接用 (y, z)。
 *
 * @param {Float32Array} pos 顶点位置（xyz 交错，模型系）
 * @param {Array<[number, number]>} rest 静止链路
 * @returns {{seg: Int32Array, t: Float32Array}}
 */
export function vertexChainParams(pos: ArrayLike<number>, rest: readonly ChainPoint[]): { seg: Int32Array; t: Float32Array } {
  const nv = pos.length / 3;
  const seg = new Int32Array(nv);
  const t = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    const vy = pos[v * 3 + 1], vz = pos[v * 3 + 2];
    let bestI = 0, bestT = 0, bestD = Infinity;
    for (let i = 0; i + 1 < rest.length; i++) {
      const ay = rest[i][0], az = rest[i][1];
      const by = rest[i + 1][0], bz = rest[i + 1][1];
      const dy = by - ay, dz = bz - az;
      const len2 = dy * dy + dz * dz;
      let s = len2 > 1e-9 ? ((vy - ay) * dy + (vz - az) * dz) / len2 : 0;
      s = s < 0 ? 0 : (s > 1 ? 1 : s);
      const px = ay + dy * s, pz = az + dz * s;
      const d = (vy - px) * (vy - px) + (vz - pz) * (vz - pz);
      if (d < bestD) { bestD = d; bestI = i; bestT = s; }
    }
    if (!rest.length) { bestI = 0; bestT = 0; }
    seg[v] = bestI; t[v] = bestT;
  }
  return { seg, t };
}

/** 两条解算链的**逐点最大偏差**（米）。用途：履带**法线**重算闸门——与"上次重算法线时的链"
 *  比较。累计统计量（最大幅度 / 均值）表达不了空间分布：把 0.1 m 的形变从一处挪到另一处时
 *  两者都不变、而法线必须重算（2026-10-10 review 复审 P2）。空 / 长度不符 ⇒ Infinity（fail-safe）。 */
export function chainDrift(prev: ArrayLike<number> | null | undefined, cur: ArrayLike<number> | null | undefined): number {
  if (!prev || !cur || prev.length !== cur.length) return Infinity;
  let m = 0;
  for (let i = 0; i < cur.length; i++) {
    const d = Math.abs(cur[i] - prev[i]);
    if (d > m) m = d;
  }
  return m;
}

/** 两条解算链是否等价（逐点严格比较）。顶点输出是链的纯函数（见 `applyChainToVertices`）：
 *  链相同 ⇒ 顶点逐点相同、无需重传 GPU。形变"下发判定"用它而不是最大幅度——
 *  幅度相同但分布不同（如把 0.1 的形变从一处挪到另一处）时 max 不变、顶点已变
 *  （2026-10-10 review P2）。空/长度不符视为变化（首帧 fail-safe）。 */
export function chainChanged(prev: ArrayLike<number> | null | undefined, cur: ArrayLike<number> | null | undefined): boolean {
  if (!prev || !cur || prev.length !== cur.length) return true;
  for (let i = 0; i < cur.length; i++) if (prev[i] !== cur[i]) return true;
  return false;
}

/**
 * 把链路位移应用到顶点（只动"高度"分量 = 模型系 +z；客户端链路也只解纵剖面）。
 * `out` 与 `base` 同为顶点数组（xyz 交错）；本函数只写 z 分量。
 *
 * @param {Float32Array} out 目标顶点位置（会被就地写）
 * @param {Float32Array} base 静止顶点位置（模板，只读）
 * @param {{seg:Int32Array, t:Float32Array}} params 顶点 → 链路映射
 * @param {Float64Array|number[]} chainZ 解算后的链路高度
 * @param {number[]} restZ 静止链路高度
 * @param {number[]} [axis] 位移方向（网格局部系里的"模型 +z"；缺省 [0,0,1]）
 * @returns {number} 本帧最大 |位移|（m）
 */
export function applyChainToVertices(out: Float32Array | number[], base: ArrayLike<number>, params: { seg: Int32Array; t: Float32Array }, chainZ: ArrayLike<number>, restZ: readonly number[], axis?: readonly number[] | null): number {
  const nv = out.length / 3;
  const { seg, t } = params;
  const ax = axis ? axis[0] : 0, ay = axis ? axis[1] : 0, az = axis ? axis[2] : 1;
  let maxAbs = 0;
  for (let v = 0; v < nv; v++) {
    const i = seg[v];
    const tt = t[v];
    const d0 = chainZ[i] - restZ[i];
    const d1 = chainZ[i + 1] - restZ[i + 1];
    const d = d0 + (d1 - d0) * tt;
    out[v * 3] = base[v * 3] + ax * d;
    out[v * 3 + 1] = base[v * 3 + 1] + ay * d;
    out[v * 3 + 2] = base[v * 3 + 2] + az * d;
    const ad = Math.abs(d);
    if (ad > maxAbs) maxAbs = ad;
  }
  return maxAbs;
}

/**
 * 把花纹偏移**整段一致**地写进 V：`V = uvBaseV + frac(offset)`。
 *
 * ⚠️ 2026-10-10 勘误（"外表面有一小段没有纹理"的根因）：此前是**逐顶点** `V = frac(uvBase + offset)`
 * —— 对任何跨过纹理 wrap 的图元（KRV 底段一根四边形就跨 2.85 个 wrap：V 1.55→4.39），
 * 逐顶点取模会把两端的 V 折到 [0,1) 的**近邻两点**（如 0.85 与 0.69），GPU 仍线性插值
 * ⇒ 该四边形上只画 0.15 个 wrap（应 2.85）——纹理被拉长 ~18× = 看起来"没有纹理"；
 * 每次整数跨越的那一条带还会随偏移漂移（观感"那一小段跟着履带转"）。
 *
 * 正确口径：取模只作用在**偏移**上（整带同相），基础 UV 保留原量程——插值不被破坏，
 * 且纹理是 REPEAT，整体 +1 的整数平移在观感上完全等价（无跳变）。
 *
 * @param {ArrayLike<number>} uvArray 目标 UV 交错数组（就地写 V 分量）
 * @param {ArrayLike<number>} uvBase 静止 UV（交错）
 * @param {number} offset 累计偏移（V 单位，由 `treadScrollStep` 累计）
 * @returns {number} 写入用的相位（= frac(offset)）
 */
export function writeUvOffsetV(uvArray: { [index: number]: number }, uvBase: ArrayLike<number>, offset: number): number {
  const phase = offset - Math.floor(offset);
  for (let i = 0; i < uvBase.length / 2; i++) {
    uvArray[i * 2 + 1] = uvBase[i * 2 + 1] + phase;
  }
  return phase;
}

/**
 * 链路底段的**走向**（+1 = 点序号增大方向为"车尾→车头"）。
 *
 * 用途：花纹滚动方向的物理判据——底段履带材料相对车体**向后**流动（接地段在世界里静止），
 * 而链路坐标的"向后"是 +s 还是 −s 取决于链路自身的点序，故先取走向再定符号。
 */

// —— 车轮/履带运动与节点解析（#LOC 拆分：实现原样平移，出口经本文件 re-export）——
export {
  chainBottomRunDir, applyWheelSpin, measureBeltUvSlope, parseWheelNodeName,
  parseTrackNodeName, wheelRadiusFromExtents, chainAverageSegment, sideTravel,
} from './suspensionWheelMotion.js'
