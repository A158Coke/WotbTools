import * as THREE from 'three'

/**
 * 坦克悬挂求解（客户端同构）——纯函数层。
 *
 * 逆向证据与公式出处：上游 `docs/tank-suspension-client-re.md` §6.6–§6.7（第三、四轮
 * 反汇编，2026-10-11）。链路解算为 **2D**（纵向 + 高度），与客户端逐条对应：
 *   1) 负重轮 = **纯竖直平移**，夹到 `[pz − b, pz + a]`（yaml `wheels` 的 `{flag, a, b}`，
 *      `flag = 1` 参与贴地、`0`（诱导/主动/托带轮）不参与），按 `wheelsReactionSpeed` 限速
 *      逼近（首次可见直接吸附）；轮贴地 = 轮底 + 前后 ±45° 三采样取 max
 *      ——`clampTravel` / `rateLimitTravel` / `wheelGroundMax`。
 *   2) 自转 = 绕轮节点**局部 X 轴** `θ += −Δs_侧 / r`——`spinStep`。
 *   3) 相位 = **每侧持久累加器**（§6.7）：`clamp01(phase ± dS·speed·100)`，符号由
 *      `frontDriveWheel` 与行驶方向定——`trackPhaseStep`。
 *   4) 段 = 相邻轮挂接点 span 绕环闭合，kind 按包围盒分带
 *      （0=底带 <10% 线、1=顶带 >60% 线、2/3=纵向中线两侧的前后坡）——`deriveTrackSegments`。
 *   5) 链路流水线（`solveTrackChain2D`，客户端 Process 每侧次序）：
 *      轮偏移 → 顶段铺开（弦等距）→ 底带限速贴地（双向，1.2·dt m/帧，5 mm 死区）→
 *      全段向下抛物线（`(−sign(ux)·uy, −|ux|)·w·(t−t²)`，w = `(upperMin+phase·B_kind)·dist^P`）
 *      → 顶段包轮 max（`y = max(y, cz+√(r²−dx²)+w_lay)`，
 *      w_lay = `(bF·dist^lP/count^pP)·maxDrop^prP·f_bend^prP2`）。
 *   6) 顶点 = **弧长重参数化**：预计算每顶点 `(弧长 s, 法向偏移 d)`，逐帧摆到当前 2D 链的
 *      s 处 + 法向 d（链节真的沿带滑动）——`vertexArcParams` / `placeVerticesOnChain`。
 *   7) 花纹滚动 = 整带 UV 相位（客户端 chunkOffset 的视觉等价，速率取网格实测 dV/ds）。
 *
 * 本模块对 three.js 的依赖仅限 `applyWheelSpin` 的枢轴补偿：其余入参是普通数组/标量。
 */

/** 客户端 `wheels` 记录缺省（数据缺失时的兜底；正常路径不用） */
export const SUSP_FALLBACK = { travelUp: 0.08, travelDown: 0.08, reaction: 1.0 };

/** 贴地死区（m）：客户端 0x3649a48 = 0.005——|Δ| ≤ 该值视为已接地 */
export const CHASE_DEAD_ZONE = 0.005;

/** 铺地限速系数：客户端 0x3649a4c = 1.2——每帧最多 `1.2·dt` 米（≈1.2 m/s） */
export const CHASE_RATE = 1.2;

/** kind 分带阈值（§6.7）：底带 < `miny+0.1·range`（0x3638978）、顶带 > `maxy−0.4·range`（0x363a070） */
export const BAND_LOW = 0.1;
export const BAND_HIGH = 0.4;

/** 形变脏阈值（m）：逐顶点重写前的位移闸门（静止帧零上传） */
export const DEFORM_EPS = 0.003;

/**
 * 行程夹紧：`clamp(Δ, −down, +up)`（客户端 `[pz − b, pz + a]` 的等价形）。
 * @param {number} delta 局部 +z 方向需要的位移（m）
 * @param {number} up 上行（压缩）行程（m）
 * @param {number} down 下行（下垂）行程（m）
 */
export function clampTravel(delta, up, down) {
  const hi = Number.isFinite(up) ? up : SUSP_FALLBACK.travelUp;
  const lo = Number.isFinite(down) ? down : SUSP_FALLBACK.travelDown;
  return delta > hi ? hi : (delta < -lo ? -lo : delta);
}

/**
 * 限速逼近（客户端 `copysign(min(|Δ|, wheelsReactionSpeed·dt), Δ)`）：
 * 首次可见（`snap`）直接吸附——与客户端"首帧不插值"一致。
 */
export function rateLimitTravel(current, target, rate, dt, snap) {
  if (snap || !(dt > 0)) return target;
  const step = (Number.isFinite(rate) && rate > 0 ? rate : SUSP_FALLBACK.reaction) * dt;
  const d = target - current;
  if (d > step) return current + step;
  if (d < -step) return current - step;
  return target;
}

const TWO_PI = Math.PI * 2;

/** 周期折叠到 ±2π（客户端 `θ = wrap(θ + …)`） */
export function wrapSpin(theta) {
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
export function spinStep(theta, distSide, radius) {
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
export function treadScrollStep(vOffset, distSide, dvPerM) {
  if (!(Math.abs(dvPerM) > 1e-6)) return vOffset;
  return vOffset + distSide * dvPerM;
}

/**
 * 链点 → 负重轮 挂接表（客户端 `SuspensionGenerator` 的「点→轮」映射的等价重建）：
 * 按**纵向**距离就近挂接，容差 = `tolFactor × 轮半径`；未被任何轮覆盖的点返回 −1
 * （上支段/悬空段——由垂弧与铺地步骤决定形状）。
 *
 * @param {Array<[number, number]>} chain 静止链路，每点 `[纵向 y, 高度 z]`（m）
 * @param {Array<{longitudinal:number, radius:number}>} wheels 逐轮（纵向位置 = 链坐标系里的 y）
 * @returns {Int32Array} 每点的轮号，−1 = 无
 */
export function attachChainToWheels(chain, wheels, tolFactor = 0.45) {
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

/** 两条解算链的**逐点最大偏差**（米）。用途：履带**法线**重算闸门——与"上次重算法线时的链"
 *  比较。累计统计量（最大幅度 / 均值）表达不了空间分布：把 0.1 m 的形变从一处挪到另一处时
 *  两者都不变、而法线必须重算（2026-10-10 review 复审 P2）。空 / 长度不符 ⇒ Infinity（fail-safe）。 */
export function chainDrift(prev, cur) {
  if (!prev || !cur || prev.length !== cur.length) return Infinity;
  let m = 0;
  for (let i = 0; i < cur.length; i++) {
    const d = Math.abs(cur[i] - prev[i]);
    if (d > m) m = d;
  }
  return m;
}

/** 两条解算链是否等价（逐点严格比较）。顶点输出是链的纯函数（见 `placeVerticesOnChain`）：
 *  链相同 ⇒ 顶点逐点相同、无需重传 GPU。形变"下发判定"用它而不是最大幅度——
 *  幅度相同但分布不同（如把 0.1 的形变从一处挪到另一处）时 max 不变、顶点已变
 *  （2026-10-10 review P2）。空/长度不符视为变化（首帧 fail-safe）。 */
export function chainChanged(prev, cur) {
  if (!prev || !cur || prev.length !== cur.length) return true;
  for (let i = 0; i < cur.length; i++) if (prev[i] !== cur[i]) return true;
  return false;
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
export function writeUvOffsetV(uvArray, uvBase, offset) {
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
export function chainBottomRunDir(chain, eps = 0.05) {
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
export function applyWheelSpin(node, restPos, restQuat, pivot, restPivotRot, spinQuat,
                               travelAxis, travel) {
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
export function measureBeltUvSlope(samples, opts) {
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
  const med = (arr) => { const a = arr.slice().sort((x, y) => x - y); return a[a.length >> 1]; };
  const slopes = [];
  for (let i = 1; i < keys.length; i++) {
    const ds = (keys[i] - keys[i - 1]) * bucket;
    if (!(ds > minStep && ds < maxStep)) continue;
    const dv = med(buckets.get(keys[i])) - med(buckets.get(keys[i - 1]));
    if (Math.abs(dv) >= maxJump) continue;          // 图集换行
    slopes.push(dv / ds);
  }
  if (slopes.length < minPairs) return { slope: 0, pairs: slopes.length, ok: false };
  slopes.sort((a, b) => a - b);
  const slope = slopes[slopes.length >> 1];
  return { slope, pairs: slopes.length, ok: Math.abs(slope) > 0.02 };
}

/**
 * 节点名解析：`chassis_wheel_{L,R}_NN` → `{side, index}`（客户端 `chassis_wheel_L_%.2d`
 * 同款绑定，编号从 01 起 = yaml `wheels` 数组下标 + 1）。
 */
export function parseWheelNodeName(name) {
  const m = /^chassis_wheel_([LR])_(\d{2})$/.exec(name || '');   // 与客户端 `%.2d` 格式串同宽
  if (!m) return null;
  return { side: m[1], index: parseInt(m[2], 10) };
}

/**
 * 节点名解析：`chassis_track_{L,R}`（单段）或 `chassis_track_{L,R}_NN`（多段模型，
 * 4/735 辆）→ `{side, segment}`；单段 segment = 0。
 */
export function parseTrackNodeName(name) {
  const m = /^chassis_track_([LR])(?:_(\d+))?$/.exec(name || '');
  if (!m) return null;
  return { side: m[1], segment: m[2] ? parseInt(m[2], 10) : 0 };
}

/**
 * 轮半径：纵剖面（模型 y/z）半跨的均值——圆柱轮胎的两个投影各给一条直径；
 * 取均值对网格偏心/多零件更稳（客户端从骨骼几何现算，同量级口径）。
 */
export function wheelRadiusFromExtents(extentY, extentZ) {
  const r = (extentY + extentZ) / 4;
  return r > 1e-3 ? r : 0.3;
}

/** 链路平均段长 = 客户端的 `chunkLength`（相邻链点间距；多段模型取首段） */
export function chainAverageSegment(chain) {
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
export function sideTravel(prevX, prevZ, curX, curZ, fwdX, fwdZ) {
  return (curX - prevX) * fwdX + (curZ - prevZ) * fwdZ;
}

// ============================================================================
// 2D 链路解算（客户端同构，§6.6–§6.7）。链点坐标 = (纵向, 高度)，与导出折线同系。
// ============================================================================

const fin = (v, dflt) => (Number.isFinite(v) ? v : dflt);

/**
 * 相位步进（§6.7，客户端侧实体累加器直译）：
 * `phase = clamp01(phase + (frontDrive ? −dS : +dS) · speed · 100)`。
 *
 * 客户端：Bending 每帧 `phase ± |v|·dt·speed·100`（100.0 @0x362e054），符号 =
 * `frontDriveWheel == (v>0) ? −1 : +1`（0x833f2c），clamp [0,1]（0x833f55–833f82），
 * 写回侧实体（0x7c0570 → [实体+0xac]）；`|v|·dt` 即本侧纵向位移 dS（带符号合并后
 * 恰为上式）。Laying 在 Bending 之后读到本帧新值。
 *
 * @param {number} phase 上一帧相位（[0,1]）
 * @param {number} dS 本侧带符号纵向位移（m，正 = 向前）
 * @param {number} speed `track_bending.speed`
 * @param {boolean} frontDrive `track_bending.front_drive_wheel`
 */
export function trackPhaseStep(phase, dS, speed, frontDrive) {
  const k = fin(speed, 1.0);
  let p = phase + (frontDrive ? -dS : dS) * k * 100;
  return p < 0 ? 0 : (p > 1 ? 1 : p);
}

/**
 * 段系数（0x82ee40 直译）：`f = (upperMin + phase'·B_kind) · dist^lengthPower`。
 *
 * kind 分派（§6.7）：kind1（顶带）→ `upperFactor`（无翻转）；kind2/3（前后坡）→
 * `frontFactor`/`backFactor`；kind0（底带）与 kind4（铺放节点）→ 系数 1.0。
 * 相位翻转：`frontDriveWheel == (kind===2)` 时 `phase' = 1 − phase`（0x82eec0）。
 *
 * @param {number} kind 段 kind（0–3；铺放节点传 4）
 * @param {number} phase 当前相位
 * @param {{upper_min?:number, upper_factor?:number, front_factor?:number,
 *          back_factor?:number, length_power?:number, front_drive_wheel?:boolean}|null} bend
 * @param {number} dist 段弦长（m）
 */
export function bendFactor(kind, phase, bend, dist) {
  if (!bend) return 0;                         // fail-closed：无 bend 数据 ⇒ 不垂
  const upperMin = fin(bend.upper_min, 0);
  const pw = fin(bend.length_power, 0.5);
  let ph = phase;
  let coef = 1;
  if (kind === 1) {
    coef = fin(bend.upper_factor, 0);
  } else {
    if (!!bend.front_drive_wheel === (kind === 2)) ph = 1 - phase;
    if (kind === 2) coef = fin(bend.front_factor, 0);
    else if (kind === 3) coef = fin(bend.back_factor, 0);
  }
  return (upperMin + ph * coef) * Math.pow(Math.max(dist, 1e-6), pw);
}

/**
 * 铺放权重（0x838380 直译，§6.6）：
 * `w = (bendingFactor·dist^lengthPower / count^pointCountPower)
 *      · maxDrop^pressurePower · fBend^primaryPower`。
 *
 * `dist` = 段/节点弦长；`count` = 接触数+1；`maxDrop` = 段内离地深度最大值；
 * `fBend` = `bendFactor(4, …)`（铺放节点 kind=4）。
 *
 * @param {number} dist 弦长（m）
 * @param {number} count 接触数 + 1
 * @param {number} maxDrop 离地深度（m，≥0）
 * @param {number} fBend 段系数
 * @param {{bending_factor?:number, length_power?:number, point_count_power?:number,
 *          pressure_power?:number, primary_power?:number}|null} laying `track_laying`
 */
export function layWeight(dist, count, maxDrop, fBend, laying) {
  const L = laying || {};
  const d = Math.max(dist, 1e-6);
  let w = fin(L.bending_factor, 0) * Math.pow(d, fin(L.length_power, 1));
  const pP = fin(L.point_count_power, 0);
  if (pP !== 0) w /= Math.pow(Math.max(count, 1), pP);
  const prP = fin(L.pressure_power, 0);
  if (prP !== 0) w *= Math.pow(Math.max(maxDrop, 0), prP);
  const pr2P = fin(L.primary_power, 0);
  if (pr2P !== 0) w *= Math.pow(Math.max(fBend, 0), pr2P);
  return w;
}

/**
 * 段生成（0x708770 直译，§6.7）：span = **相邻轮挂接点**（绕环闭合），kind 按链包围盒分带：
 * 两端 y 均 < `miny+0.1·range` → 0（底带）；均 > `maxy−0.4·range` → 1（顶带）；
 * 均 x > centerX → 2（+x 坡）；均 x < centerX → 3（−x 坡）；未命中 → 0
 * （客户端零初始化记录未被覆盖）。判定顺序 0→1→2→3，首中即停。
 *
 * @param {Array<[number, number]>} chain 静止链路 `[纵向, 高度]`
 * @param {Int32Array} attach 点→轮（−1 = 无；含 flag=0 的诱导/主动轮——环上每个轮都锚定）
 * @returns {Array<{i0:number, i1:number, kind:number}>}
 */
export function deriveTrackSegments(chain, attach) {
  const n = chain.length;
  const anchors = [];
  for (let i = 0; i < n; i++) if (attach[i] >= 0) anchors.push(i);
  if (anchors.length < 2) return [];
  const segs = [];
  for (let k = 0; k < anchors.length; k++) {
    segs.push({ i0: anchors[k], i1: anchors[(k + 1) % anchors.length], kind: 0 });
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = chain[i][0], y = chain[i][1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const range = maxY - minY;
  const lowLine = minY + BAND_LOW * range;
  const highLine = maxY - BAND_HIGH * range;
  for (const s of segs) {
    const y0 = chain[s.i0][1], y1 = chain[s.i1][1];
    if (y0 < lowLine && y1 < lowLine) { s.kind = 0; continue; }
    if (y0 > highLine && y1 > highLine) { s.kind = 1; continue; }
    const x0 = chain[s.i0][0], x1 = chain[s.i1][0];
    if (x0 > cx && x1 > cx) { s.kind = 2; continue; }
    if (x0 < cx && x1 < cx) { s.kind = 3; continue; }
    s.kind = 0;
  }
  return segs;
}

/**
 * 链点弧长工具：累计弧长表（当前 2D 链）+ 按弧长取点与朝下法向。
 * 法向约定 = 行进方向的左侧旋转 (−dy, dx) 再归到**高度分量 ≤ 0**（与 0x82e7f0 的
 * 朝下归一一致，见 `bendDisplacement`）——顶点法向偏移 d 的符号随此约定。
 *
 * @param {Float64Array} cumArc 累计弧长（长度 = 点数；cumArc[0] = 0）
 * @param {Float64Array} xs 纵向坐标
 * @param {Float64Array} ys 高度坐标
 * @param {number} s 目标弧长（越界夹到两端）
 * @returns {{x:number, y:number, nx:number, ny:number}} 点坐标与单位法向
 */
export function chainPointAtArc(cumArc, xs, ys, s) {
  const n = xs.length;
  const total = cumArc[n - 1];
  let t = s < 0 ? 0 : (s > total ? total : s);
  // 二分定位段号
  let lo = 0, hi = n - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cumArc[mid] <= t) lo = mid; else hi = mid;
  }
  const segLen = cumArc[lo + 1] - cumArc[lo];
  const f = segLen > 1e-9 ? (t - cumArc[lo]) / segLen : 0;
  const dx = xs[lo + 1] - xs[lo], dy = ys[lo + 1] - ys[lo];
  const len = Math.hypot(dx, dy) || 1;
  // 朝下法向：先取左侧法向 (−dy,dx)/len，若高度分量为正则取反
  let nx = -dy / len, ny = dx / len;
  if (ny > 0) { nx = -nx; ny = -ny; }
  return { x: xs[lo] + dx * f, y: ys[lo] + dy * f, nx, ny };
}

/**
 * 顶段铺开（0x8366e0 直译，竖直+纵向双分量）：kind1 段的内部链点重写为端点弦线的
 * **等距点**——第 k 个内部点落在弦的 `k/(n+1)` 分数处（客户端：步长 = 弦长/(列表长+1)，
 * 计数器步进 1.0，x/y 双分量回写）。端点（轮挂接点）不动。
 *
 * @param {Float64Array} xs 纵向（就地写）
 * @param {Float64Array} ys 高度（就地写）
 * @param {Array<{i0:number, i1:number, kind:number}>} segs 段表
 */
export function spreadTopSpans2D(xs, ys, segs) {
  const n = xs.length;
  for (const s of segs) {
    if (s.kind !== 1) continue;
    const cnt = ((s.i1 - s.i0) + n) % n;       // 环绕跨度（跨环缝段 i1 < i0 也覆盖）
    if (cnt < 2) continue;
    const x0 = xs[s.i0], y0 = ys[s.i0];
    // 等距分母 = 内部点数 + 1 = cnt（客户端：步长 = 弦长/(表长+1)，表长 = 被重写的内部点）
    const dx = (xs[s.i1] - x0) / cnt;
    const dy = (ys[s.i1] - y0) / cnt;
    for (let k = 1; k <= cnt - 1; k++) {
      const i = (s.i0 + k) % n;
      xs[i] = x0 + dx * k;
      ys[i] = y0 + dy * k;
    }
  }
}

/**
 * 垂弧位移（0x82e7f0 抛物线路径直译，§6.7）：全段内部链点
 * `Δ = (−sign(ux)·uy, −|ux|) · w · (t − t²)`，其中 `(ux,uy)` = 段弦单位向量（i0→i1）、
 * `t` = 该点到 i0 的欧氏距离 / 弦长、`w` = `bendFactor(kind, phase, bend, 弦长)`。
 * 高度分量恒 ≤ 0（向下垂），纵向分量随弦斜率（斜率耦合喂送）。
 *
 * @param {Float64Array} xs 纵向（就地写）
 * @param {Float64Array} ys 高度（就地写）
 * @param {Array<{i0:number, i1:number, kind:number}>} segs 段表
 * @param {number} phase 当前相位
 * @param {{upper_min?:number, upper_factor?:number, front_factor?:number,
 *          back_factor?:number, length_power?:number, front_drive_wheel?:boolean}|null} bend
 */
export function bendPass2D(xs, ys, segs, phase, bend) {
  const n = xs.length;
  for (const s of segs) {
    const cnt = ((s.i1 - s.i0) + n) % n;
    if (cnt < 2) continue;                     // 相邻挂接点：无内部点
    const x0 = xs[s.i0], y0 = ys[s.i0];
    const dx = xs[s.i1] - x0, dy = ys[s.i1] - y0;
    const len = Math.hypot(dx, dy);
    if (!(len > 1e-6)) continue;
    const ux = dx / len, uy = dy / len;
    const dirX = -Math.sign(ux) * uy;          // 0x82e8fe–82e923 的朝下归一（x 槽）
    const dirY = -Math.abs(ux);                // （y 槽：恒 ≤ 0）
    const w = bendFactor(s.kind, phase, bend, len);
    for (let k = 1; k <= cnt - 1; k++) {
      const i = (s.i0 + k) % n;
      const t = Math.hypot(xs[i] - x0, ys[i] - y0) / len;
      const kk = w * (t - t * t);
      xs[i] += dirX * kk;
      ys[i] += dirY * kk;
    }
  }
}

/**
 * 顶段包轮（0x82e7f0 包轮路径直译）：kind1 段内**挂接点**（attach ≥ 0）
 * `y = max(y, cz + √(r² − dx²) + wLay)`，`cz` = 轮心当前高度（静止 + 行程），
 * `dx` = 链点纵向 − 轮纵向；`wLay` = `layWeight(弦长, 段内点数, maxDrop, fBend, laying)`，
 * `fBend = bendFactor(4, phase, bend, 弦长)`（铺放节点 kind=4）。
 *
 * @param {Float64Array} xs 纵向（就地写）
 * @param {Float64Array} ys 高度（就地写）
 * @param {Array<{i0:number, i1:number, kind:number}>} segs 段表
 * @param {Int32Array} attach 点→轮
 * @param {Array<{longitudinal:number, centerZ:number, radius:number}>} wheelCfg 逐轮几何
 * @param {Float64Array|number[]} wheelDelta 逐轮当前行程（局部 +z）
 * @param {number} phase 当前相位
 * @param {object|null} bend `track_bending`
 * @param {object|null} laying `track_laying`
 * @param {Float64Array} [groundY] 逐点地形高度（maxDrop 输入；缺省按 0）
 */
export function wrapTopSpans2D(xs, ys, segs, attach, wheelCfg, wheelDelta, phase, bend, laying, groundY) {
  const n = xs.length;
  for (const s of segs) {
    if (s.kind !== 1) continue;
    const cnt = ((s.i1 - s.i0) + n) % n;
    if (cnt < 1) continue;
    const len = Math.hypot(xs[s.i1] - xs[s.i0], ys[s.i1] - ys[s.i0]);
    let maxDrop = 0;
    if (groundY) {
      for (let k = 0; k <= cnt; k++) {
        const i = (s.i0 + k) % n;
        const d = Math.abs(groundY[i] - ys[i]);
        if (d > maxDrop) maxDrop = d;
      }
    }
    const fBend = bendFactor(4, phase, bend, len);
    const wLay = layWeight(len, cnt + 1, maxDrop, fBend, laying);
    for (let k = 0; k <= cnt; k++) {
      const i = (s.i0 + k) % n;
      const w = attach[i];
      if (w < 0) continue;
      const wh = wheelCfg[w];
      const r = wh.radius || 0;
      if (!(r > 1e-4)) continue;
      const ddx = xs[i] - wh.longitudinal;
      if (Math.abs(ddx) >= r) continue;
      const cz = (wh.centerZ || 0) + (wheelDelta[w] || 0);
      const top = cz + Math.sqrt(r * r - ddx * ddx) + wLay;
      if (ys[i] < top) ys[i] = top;
    }
  }
}

/**
 * 链 2D 解算编排（客户端 Process 每侧次序）：状态装配 → 底带贴地 → 顶段铺开 →
 * 全段垂弧 → 顶段包轮。
 *
 * **持久状态只有逐点贴地偏移 `chaseY`**（客户端链实体上的解算链等价物，跨帧累积、
 * 限速 1.2·dt 收敛）；其余每帧从 `静止 + chase` 重算——垂弧/铺开/包轮都是纯函数级
 * 增量，不跨帧累积（客户端每帧 memcpy 链副本的稳定性等价形）。挂接点（attach ≥ 0）
 * 不吃 chase——它们绝对跟随轮（静止锚点 + 轮行程），地面接触经由轮解算传入。
 * 底带掩码按**当前链**包围盒现算（客户端接触树每帧现算参考高度同款）。
 * seek 时调用方把 `chaseY` 清零——与客户端"跳转后履带重新贴地"的缓动一致。
 *
 * @param {Float64Array} outX 纵向输出（就地写）
 * @param {Float64Array} outY 高度输出（就地写）
 * @param {Float64Array} restX 静止纵向
 * @param {Float64Array} restY 静止高度
 * @param {Int32Array} attach 点→轮
 * @param {Float64Array|number[]} wheelDelta 逐轮行程
 * @param {Float64Array} chaseY 持久贴地偏移（就地更新；seek 时由调用方清零）
 * @param {Array<{i0:number, i1:number, kind:number}>} segs 段表
 * @param {Float64Array} groundY 逐点地形高度（链坐标系）
 * @param {number} dt 帧间隔（s）
 * @param {number} phase 当前相位
 * @param {object|null} bend `track_bending`
 * @param {object|null} laying `track_laying`
 * @param {Array<{longitudinal:number, centerZ:number, radius:number}>} wheelCfg 逐轮几何
 * @param {Uint8Array} [maskScratch] 复用掩码缓冲（长度 = 链点数；缺省就地分配）
 */
export function solveTrackChain2D(outX, outY, restX, restY, attach, wheelDelta, chaseY, segs,
                                  groundY, dt, phase, bend, laying, wheelCfg, maskScratch) {
  const n = outY.length;
  // 1) 状态装配：挂接点绝对跟轮，其余 = 静止 + 持久贴地偏移
  for (let i = 0; i < n; i++) {
    outX[i] = restX[i];
    const w = attach[i];
    outY[i] = restY[i] + (w >= 0 ? (wheelDelta[w] || 0) : (chaseY[i] || 0));
  }
  // 2) 底带贴地（树构建等价）：底带 = 当前链高度包围盒的下 10% 带（§6.7 kind0 阈值）；
  //    挂接点排除（跟轮）。目标 = 地形 − 静止，限速 1.2·dt、死区 5 mm，写入持久 chaseY。
  const mask = maskScratch || new Uint8Array(n);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = outY[i];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const lowLine = minY + BAND_LOW * (maxY - minY);
  const clamp = CHASE_RATE * (dt > 0 ? dt : 0);
  for (let i = 0; i < n; i++) {
    if (attach[i] >= 0 || outY[i] >= lowLine) { mask[i] = 0; continue; }
    mask[i] = 1;
    const target = groundY[i] - restY[i];
    const d = target - (chaseY[i] || 0);
    const ad = Math.abs(d);
    if (ad <= CHASE_DEAD_ZONE) continue;
    const step = ad > clamp ? clamp : ad;
    chaseY[i] = (chaseY[i] || 0) + (d > 0 ? step : -step);
    outY[i] = restY[i] + chaseY[i];
  }
  // 3) 顶段铺开（Process 在 Bending 前的直调铺开 + Laying 内铺开合并为一次）
  spreadTopSpans2D(outX, outY, segs);
  // 4) 全段垂弧（Bending）
  bendPass2D(outX, outY, segs, phase, bend);
  // 5) 顶段包轮（Laying）
  wrapTopSpans2D(outX, outY, segs, attach, wheelCfg, wheelDelta, phase, bend, laying, groundY);
}

/**
 * 顶点弧长参数（一次性，取代旧的 (段,t) 绑死映射）：把网格顶点（**模型根系**）
 * 投影到静止 2D 链，得 `(弧长 s, 法向偏移 d)`；另存顶点静止 (纵向, 高度) 供逐帧求位移。
 * 法向偏移 d = (顶点 − 链上最近点) · 朝下法向——符号随 `chainPointAtArc` 的约定。
 *
 * @param {Float32Array} rootPos 顶点位置（xyz 交错，模型根系：x 横向 / y 纵向 / z 高度）
 * @param {Array<[number, number]>} rest 静止链路 `[纵向, 高度]`
 * @param {Float64Array} cumArcRest 静止链累计弧长
 * @returns {{s: Float64Array, d: Float64Array, restLong: Float64Array, restH: Float64Array}}
 */
export function vertexArcParams(rootPos, rest, cumArcRest) {
  const nv = rootPos.length / 3;
  const s = new Float64Array(nv);
  const d = new Float64Array(nv);
  const restLong = new Float64Array(nv);
  const restH = new Float64Array(nv);
  const n = rest.length;
  for (let v = 0; v < nv; v++) {
    const vy = rootPos[v * 3 + 1], vz = rootPos[v * 3 + 2];
    restLong[v] = vy;
    restH[v] = vz;
    let bestI = 0, bestT = 0, bestD2 = Infinity;
    for (let i = 0; i + 1 < n; i++) {
      const ay = rest[i][0], az = rest[i][1];
      const by = rest[i + 1][0], bz = rest[i + 1][1];
      const dy = by - ay, dz = bz - az;
      const len2 = dy * dy + dz * dz;
      let t = len2 > 1e-9 ? ((vy - ay) * dy + (vz - az) * dz) / len2 : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const px = ay + dy * t, pz = az + dz * t;
      const dd = (vy - px) * (vy - px) + (vz - pz) * (vz - pz);
      if (dd < bestD2) { bestD2 = dd; bestI = i; bestT = t; }
    }
    s[v] = cumArcRest[bestI] + bestT * (cumArcRest[bestI + 1] - cumArcRest[bestI]);
    // 法向偏移：最近段上的有符号距离（法向 = chainPointAtArc 同约定）
    const dy = rest[bestI + 1][0] - rest[bestI][0];
    const dz = rest[bestI + 1][1] - rest[bestI][1];
    const len = Math.hypot(dy, dz) || 1;
    let nx = -dz / len, ny = dy / len;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const px = rest[bestI][0] + dy * bestT;
    const pz = rest[bestI][1] + dz * bestT;
    d[v] = (vy - px) * nx + (vz - pz) * ny;
  }
  return { s, d, restLong, restH };
}

/**
 * 顶点沿带摆放（逐帧，弧长重参数化）：把每顶点摆到当前 2D 链的 `s` 处 + 法向·d。
 * 顶点横向（模型 x）不动；位移在模型根系算出后经网格逆旋转（`invRot`，收集期算好的
 * 3×3）转回网格局部系写位置。返回本帧最大 |位移|（m）。
 *
 * @param {Float32Array} out 目标顶点位置（就地写，网格局部系 xyz）
 * @param {Float32Array} base 静止顶点位置（模板，只读，网格局部系）
 * @param {{s:Float64Array, d:Float64Array, restLong:Float64Array, restH:Float64Array}} arc 顶点弧长参数
 * @param {Float64Array} cumArcCur 当前链累计弧长
 * @param {Float64Array} curX 当前链纵向
 * @param {Float64Array} curY 当前链高度
 * @param {Float64Array} invRot 网格局部系 ← 模型根系 的旋转（9 元素行主序）
 * @returns {number} 本帧最大 |位移|（m）
 */
export function placeVerticesOnChain(out, base, arc, cumArcCur, curX, curY, invRot) {
  const nv = out.length / 3;
  let maxAbs = 0;
  for (let v = 0; v < nv; v++) {
    const p = chainPointAtArc(cumArcCur, curX, curY, arc.s[v]);
    // 模型根系位移（y=纵向, z=高度）
    const dLong = p.x + p.nx * arc.d[v] - arc.restLong[v];
    const dH = p.y + p.ny * arc.d[v] - arc.restH[v];
    // 根系 → 网格局部（只旋转，平移抵消）
    const dx = invRot[0] * 0 + invRot[1] * dLong + invRot[2] * dH;
    const dy = invRot[3] * 0 + invRot[4] * dLong + invRot[5] * dH;
    const dz = invRot[6] * 0 + invRot[7] * dLong + invRot[8] * dH;
    out[v * 3] = base[v * 3] + dx;
    out[v * 3 + 1] = base[v * 3 + 1] + dy;
    out[v * 3 + 2] = base[v * 3 + 2] + dz;
    const ad = Math.abs(dLong) + Math.abs(dH);
    if (ad > maxAbs) maxAbs = ad;
  }
  return maxAbs;
}

/**
 * 轮贴地三采样（客户端 3 射线口径的高度场版）：轮底 + 前后 ±45°（沿滚动方向，
 * 水平偏移 `r·sin45°`）。45° 射线垂向行程只有 `r·cos45°` ⇒ 轮面在偏移点触地时
 * `centerZ = h_偏移 + r·cos45°`，等效竖直采样高度 = `h_偏移 − r·(1−cos45°)`
 * （比竖直采样**更宽松**，只在陡升处——偏移点比轮心下方高出 > 0.29r——才占优，
 * 即客户端射线抓峭壁前沿的语义；上游 §6.2"两侧样本抬"系笔误方向的速记）。
 *
 * @param {(x:number, z:number) => number} sampleHeight 世界 (x,z) → 地形高度
 * @param {number} cx 轮心世界 x
 * @param {number} cz 轮心世界 z
 * @param {number} fwdX 车体前向世界 x（单位）
 * @param {number} fwdZ 车体前向世界 z（单位）
 * @param {number} r 轮半径
 * @returns {number} 三采样的最大等效地面高度
 */
export function wheelGroundMax(sampleHeight, cx, cz, fwdX, fwdZ, r) {
  const h0 = sampleHeight(cx, cz);
  const off = r * Math.SQRT1_2;                  // sin45°
  const drop = r * (1 - Math.SQRT1_2);           // (1−cos45°)·r：45° 射线的垂向行程损失
  const hF = sampleHeight(cx + fwdX * off, cz + fwdZ * off) - drop;
  const hB = sampleHeight(cx - fwdX * off, cz - fwdZ * off) - drop;
  let m = h0;
  if (hF > m) m = hF;
  if (hB > m) m = hB;
  return m;
}
