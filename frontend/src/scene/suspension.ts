

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

export function rateLimitTravel(current: number, target: number, rate: number, dt: number, snap: unknown): number {
  if (snap || !(dt > 0)) return target;
  const step = (Number.isFinite(rate) && rate > 0 ? rate : SUSP_FALLBACK.reaction) * dt;
  const d = target - current;
  if (d > step) return current + step;
  if (d < -step) return current - step;
  return target;
}

const TWO_PI = Math.PI * 2;

export function wrapSpin(theta: number): number {
  let t = theta % TWO_PI;
  if (t > Math.PI) t -= TWO_PI;
  if (t < -Math.PI) t += TWO_PI;
  return t;
}

export function spinStep(theta: number, distSide: number, radius: number): number {
  if (!(radius > 1e-4)) return theta;
  return wrapSpin(theta - distSide / radius);
}

export function treadScrollStep(vOffset: number, distSide: number, dvPerM: number): number {
  if (!(Math.abs(dvPerM) > 1e-6)) return vOffset;
  return vOffset + distSide * dvPerM;
}

export function groundDropLocal(terrainH: number, restWorldY: number, upWorldY: number): number {
  if (!(Math.abs(upWorldY) > 0.25)) return 0;
  return (terrainH - restWorldY) / upWorldY;
}

export interface SuspensionWheel {
  longitudinal: number
  radius?: number
  centerZ?: number
}

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
  for (let i = 0; i < n; i++) {
    const w = attach[i];
    out[i] = rest[i][1] + (w >= 0 ? (wheelDelta[w] ?? 0) : 0);
  }
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

export function chainDrift(prev: ArrayLike<number> | null | undefined, cur: ArrayLike<number> | null | undefined): number {
  if (!prev || !cur || prev.length !== cur.length) return Infinity;
  let m = 0;
  for (let i = 0; i < cur.length; i++) {
    const d = Math.abs(cur[i] - prev[i]);
    if (d > m) m = d;
  }
  return m;
}

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


export {
  chainBottomRunDir, applyWheelSpin, measureBeltUvSlope, parseWheelNodeName,
  parseTrackNodeName, wheelRadiusFromExtents, chainAverageSegment, sideTravel,
} from './suspensionWheelMotion.js'
