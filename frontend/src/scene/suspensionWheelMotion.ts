// 车轮/履带运动学（自 suspension.ts 原样平移）：车轮自转/履带 UV 推进、
// 节点名解析与链几何小工具。数值行为保持原样。
import * as THREE from 'three'
import type { Object3D, Quaternion, Vector3 } from 'three'
import type { ChainPoint } from './suspension.js'

export function chainBottomRunDir(chain: readonly ChainPoint[], eps = 0.05): number {
  if (!Array.isArray(chain) || chain.length < 3) return 1;
  let zmin = Infinity;
  for (const p of chain) if (p[1] < zmin) zmin = p[1];
  let i0 = -1;
  for (let i = 0; i < chain.length; i++) { if (chain[i][1] <= zmin + eps) { i0 = i; break; } }
  if (i0 < 0) return 1;
  let j = i0;
  while (j + 1 < chain.length && chain[j + 1][1] <= zmin + eps) j++;
  if (j <= i0) return 1;
  return chain[j][0] - chain[i0][0] >= 0 ? 1 : -1;
}

const _wpV = new THREE.Vector3();

/**
 * 轮节点位姿写入（**枢轴补偿**）：导出器把轮几何烘进顶点、节点留在原点/单位旋转，
 * 直接给节点写旋转 = 绕**整车原点**公转（实测轮心漂移 5.4–6.8 m ⇒ 观感"旋转混乱"）。
 * 与炮塔/炮管同一套"节点原点 + 显式枢轴"约定，位置取：
 *
 *     p = restPos + R_rest·pivot − R_node·pivot (+ travelAxis·travel),  R_node = R_rest·R_spin
 *
 * 自转轴 = 轮**局部 X**（客户端写骨骼旋转块的口径）；θ=0 时退化为 restPos ✓。
 *
 * @param {THREE.Object3D} node 轮节点（就地写 position/quaternion）
 * @param {THREE.Vector3} restPos 静止位置（节点父空间）
 * @param {THREE.Quaternion} restQuat 静止旋转
 * @param {THREE.Vector3} pivot 轮心（节点父空间）
 * @param {THREE.Vector3} restPivotRot 静止旋转下的枢轴像（R_rest·pivot，收集期算一次）
 * @param {THREE.Quaternion} spinQuat 自转四元数（绕局部 X）
 * @param {THREE.Vector3} travelAxis 行程方向（局部 +z 等效轴）
 * @param {number} travel 行程位移（m）
 */
export function applyWheelSpin(node: Object3D, restPos: Vector3, restQuat: Quaternion, pivot: Vector3, restPivotRot: Vector3, spinQuat: Quaternion,
                               travelAxis: Vector3, travel: number): void {
  node.quaternion.copy(restQuat).multiply(spinQuat);
  _wpV.copy(pivot).applyQuaternion(spinQuat).applyQuaternion(restQuat);   // R_rest·R_spin·pivot
  node.position.copy(restPos).add(restPivotRot).sub(_wpV)
    .addScaledVector(travelAxis, travel);
}

/**
 * 履带纹理**沿带**斜率测量（dV/ds，单位 V/米）：把 `[弧长 s, 纹理 V]` 样本按 s 分桶
 * （桶内取中位 ⇒ 消掉"同一 s 上的横向重复行"），再看相邻桶的 Δv/Δs 取**中位**。
 *
 * 为什么要测而不是直接用 `chassis.textureScale / chunkLength`：那条常数来自客户端
 * **它自己 shader 重建的 V 空间**（一个 chunk 一份原型），与导出网格的**图集式 per-link V**
 * （IS-7 实测每 V ≈ 1.56 m）不是同一量纲——直接套用会让花纹速度偏快 3.5~4 倍（实测比值）。
 *
 * 已知形态：同一个带内 V 沿弧长线性推进，并在图集行末**换行**（跳变量级 ≫ 单步）；
 * 跨行样本对用 `maxJump` 剔除。
 *
 * @param {Array<[number, number]>} samples `[弧长(m), V]`
 * @returns {{slope:number, pairs:number, ok:boolean}} ok = 样本对足够且 |slope| 有效
 */
export function measureBeltUvSlope(samples: readonly (readonly [number, number])[], opts?: { bucket?: number; minStep?: number; maxStep?: number; maxJump?: number; minPairs?: number }): { slope: number; pairs: number; ok: boolean } {
  const o = opts || {};
  const bucket = o.bucket || 0.01;
  const minStep = o.minStep || 0.02;
  const maxStep = o.maxStep || 0.6;
  const maxJump = o.maxJump || 0.5;
  const minPairs = o.minPairs || 5;
  const buckets = new Map();
  for (const [sv, vv] of samples) {
    const key = Math.round(sv / bucket);
    let b = buckets.get(key);
    if (!b) { b = []; buckets.set(key, b); }
    b.push(vv);
  }
  const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
  const slopes = [];
  for (let i = 1; i < keys.length; i++) {
    const ds = (keys[i] - keys[i - 1]) * bucket;
    if (!(ds > minStep && ds < maxStep)) continue;
    // 图集式 per-link V 的两个真实形态（Grille 15 样本 19217 实测）：
    // ① 顶点不按弧长排布——同一弧长桶内混多块板/多行图集的顶点，桶内中位会把
    //    相邻板的 V 混在一起；② **图集两行的 V 推进方向相反**（贴图行对称铺设：
    //    下行族 +1.24 V/m、上行族 −1.25 V/m）——两族斜率在中位数里互相抵消 = 0。
    // 修法：逐对 (v_i, v_j) 配对（dedupeV 去掉横向重复行），剔除换行跳变后
    // **取 |斜率| 的中位为幅值**——两族的 |slope| 相等（同一物理滚动速度），符号
    // 歧义由调用方的 chainBottomRunDir（底段走向）定滚动方向；线性带（单一符号）
    // 的 |中位| = |中位斜率|，与旧契约数值一致（符号交给 dir）。
    const prev = dedupeV(buckets.get(keys[i - 1]));
    const cur = dedupeV(buckets.get(keys[i]));
    for (const dv0 of cur) {
      for (const v0 of prev) {
        const dv = dv0 - v0;
        if (Math.abs(dv) >= maxJump) continue;        // 图集换行
        slopes.push(Math.abs(dv) / ds);
      }
    }
  }
  if (slopes.length < minPairs) return { slope: 0, pairs: slopes.length, ok: false };
  slopes.sort((a, b) => a - b);
  const slope = slopes[slopes.length >> 1];
  return { slope, pairs: slopes.length, ok: slope > 0.02 };
}

/** 桶内 V 去重（0.01 网格）：横向重复行的同值 V 只留一个——重复行是几何事实
 *  （履带板同弧长多行顶点），不剔除会把逐顶点对的斜率中位稀释向 0。 */
function dedupeV(vArr: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of vArr) {
    const k = Math.round(v / 0.01);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/**
 * 节点名解析：`chassis_wheel_{L,R}_NN` → `{side, index}`（客户端 `chassis_wheel_L_%.2d`
 * 同款绑定，编号从 01 起 = yaml `wheels` 数组下标 + 1）。
 */
export function parseWheelNodeName(name: string | null | undefined): { side: 'L' | 'R'; index: number } | null {
  const m = /^chassis_wheel_([LR])_(\d{2})$/.exec(name || '');   // 与客户端 `%.2d` 格式串同宽
  if (!m) return null;
  return { side: m[1] as 'L' | 'R', index: parseInt(m[2], 10) };
}

/**
 * 节点名解析：`chassis_track_{L,R}`（单段）或 `chassis_track_{L,R}_NN`（多段模型，
 * 4/735 辆）→ `{side, segment}`；单段 segment = 0。
 */
export function parseTrackNodeName(name: string | null | undefined): { side: 'L' | 'R'; segment: number } | null {
  const m = /^chassis_track_([LR])(?:_(\d+))?$/.exec(name || '');
  if (!m) return null;
  return { side: m[1] as 'L' | 'R', segment: m[2] ? parseInt(m[2], 10) : 0 };
}

/**
 * 轮半径：纵剖面（模型 y/z）半跨的均值——圆柱轮胎的两个投影各给一条直径；
 * 取均值对网格偏心/多零件更稳（客户端从骨骼几何现算，同量级口径）。
 */
export function wheelRadiusFromExtents(extentY: number, extentZ: number): number {
  const r = (extentY + extentZ) / 4;
  return r > 1e-3 ? r : 0.3;
}

/** 链路平均段长 = 客户端的 `chunkLength`（相邻链点间距；多段模型取首段） */
export function chainAverageSegment(chain: readonly ChainPoint[]): number {
  if (!Array.isArray(chain) || chain.length < 2) return 0.25;
  let sum = 0;
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i], b = chain[i + 1];
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const avg = sum / (chain.length - 1);
  return avg > 1e-4 ? avg : 0.25;
}

/**
 * 侧向履带纵向位移（图省事的等价形）：由两侧"接触线中心"的世界位置差投影到车体前向。
 * 调用方传入上一帧与当前帧的侧中心位置与前向单位向量；返回带符号位移（m）。
 */
export function sideTravel(prevX: number, prevZ: number, curX: number, curZ: number, fwdX: number, fwdZ: number): number {
  return (curX - prevX) * fwdX + (curZ - prevZ) * fwdZ;
}
