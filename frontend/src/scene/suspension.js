import * as THREE from 'three'

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
 *   4) 花纹滚动：每米 V 变化 = `chassis.textureScale / chunkLength`（客户端口径，
 *      负值分支在本实现里由调用方取逐车 dV/ds——见 `treadScrollStep`）。
 *
 * 本模块不依赖 three.js：入参是普通数组/标量，便于单测；场景侧只做容器与写入。
 */

/** 客户端 `wheels` 记录缺省（数据缺失时的兜底；正常路径不用） */
export const SUSP_FALLBACK = { travelUp: 0.08, travelDown: 0.08, reaction: 1.0 };

/** 垂弧上限：`(t − t²)` 抛物线的形状常数（峰在 t=0.5，值 0.25） */
export const SAG_SHAPE_PEAK = 0.25;

/** 铺地判定余量（m）：链点高出地面不足该值即视为接触，参与"支承点"集合 */
export const GROUND_CONTACT_EPS = 0.01;

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
 * 地形"掉高"折算到车体系局部 +z：把世界竖直差除以车体 up 轴的世界 y 分量。
 * 车体倾倒到 |upY| 过小时返回 0（求解停摆而非发散，fail-safe）。
 */
export function groundDropLocal(terrainH, restWorldY, upWorldY) {
  if (!(Math.abs(upWorldY) > 0.25)) return 0;
  return (terrainH - restWorldY) / upWorldY;
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
 * @returns {{maxAbs:number}} 本次解算的最大绝对位移（脏判据用）
 */
export function solveChain(out, rest, attach, wheelDelta, groundDrop, wheels, bend) {
  const n = rest.length;
  let maxAbs = 0;
  // 1) 逐轮偏移：挂接点随轮移动（客户端 `chain[i] += wheelInfo.offset`）
  for (let i = 0; i < n; i++) {
    const w = attach[i];
    out[i] = rest[i][1] + (w >= 0 ? wheelDelta[w] || 0 : 0);
  }
  // 2) 悬空段垂弧：在**支承点**（挂接点）之间按 `(t − t²)` 抛物线向下垂
  const sagFactor = bend && Number.isFinite(bend.upper_factor) ? Math.max(0, bend.upper_factor) : 0;
  const sagPow = bend && Number.isFinite(bend.length_power) ? bend.length_power : 0.5;
  let i = 0;
  while (i < n) {
    if (attach[i] < 0) { i++; continue; }
    let j = i + 1;
    while (j < n && attach[j] < 0) j++;
    if (j < n && j > i + 1) {
      const span = Math.abs(rest[j][0] - rest[i][0]);
      const sag = sagFactor * Math.pow(Math.max(span, 1e-3), sagPow);
      const y0 = out[i], y1 = out[j];
      for (let k = i + 1; k < j; k++) {
        const t = (k - i) / (j - i);
        out[k] = y0 + (y1 - y0) * t - sag * (t - t * t);
      }
    }
    i = j;
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
    const laid = rest[k][1] + (groundDrop[k] || 0);
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
export function vertexChainParams(pos, rest) {
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
export function applyChainToVertices(out, base, params, chainZ, restZ, axis) {
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
