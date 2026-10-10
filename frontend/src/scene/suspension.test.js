/**
 * 悬挂求解纯函数单测（客户端同构；公式出处 = 上游 docs/tank-suspension-client-re.md §6.6–§6.7）。
 *
 * 锁的都是"少一行就退化成另一个东西"的口径：
 *  · 行程夹紧/限速/首帧吸附（客户端 `copysign(min(|Δ|, rate·dt), Δ)` + `[−b, +a]`）
 *  · 自转方向与半径换算（θ += −Δs/r，绕局部 X）
 *  · 相位累加器（clamp01(phase ± dS·speed·100)，符号由 frontDriveWheel × 行驶方向）
 *  · 段系数 kind 表（1=upperFactor 不翻转；2=frontFactor 翻转 ⇔ frontDrive；
 *    3=backFactor；0/4=×1.0）与铺放权重五参数公式
 *  · 段生成：相邻挂接点 span 绕环闭合 + 包围盒分带（0 底 / 1 顶 / 2·3 前后坡，首中即停）
 *  · 2D 链解算：贴地跨帧收敛（1.2·dt 限速 + 5 mm 死区 + 挂接点排除）、顶段弦等距铺开、
 *    垂弧向下（(−sign(ux)·uy, −|ux|)·w·(t−t²)）、包轮 max + wLay
 *  · 顶点弧长重参数化：沿带滑动 + 法向厚度保持 + 逆旋转回局部系
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  applyWheelSpin,
  clampTravel, rateLimitTravel, spinStep, wrapSpin, treadScrollStep,
  attachChainToWheels, chainChanged, chainDrift, sideTravel,
  parseWheelNodeName, parseTrackNodeName, wheelRadiusFromExtents, chainAverageSegment,
  measureBeltUvSlope, chainBottomRunDir, writeUvOffsetV,
  trackPhaseStep, bendFactor, layWeight, deriveTrackSegments, chainPointAtArc,
  solveTrackChain2D, vertexArcParams, placeVerticesOnChain, wheelGroundMax,
  SUSP_FALLBACK, CHASE_RATE,
} from './suspension.js'

describe('轮自转位姿：枢轴补偿（导出的轮节点在原点，几何烘进顶点）', () => {
  // 复现真实导出形态：节点在原点、identity 旋转；轮心在父空间 (0, 3, 0.4)，半径 0.37
  const restPos = new THREE.Vector3(0, 0, 0)
  const restQuat = new THREE.Quaternion()
  const pivot = new THREE.Vector3(0, 3, 0.4)
  const restPivotRot = pivot.clone()
  const travelAxis = new THREE.Vector3(0, 0, 1)
  const mkNode = () => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion() })

  it('θ=0 时退化为静止位姿（位置 = 静止位置 + 行程）', () => {
    const node = mkNode()
    applyWheelSpin(node, restPos, restQuat, pivot, restPivotRot,
                   new THREE.Quaternion(), travelAxis, 0.07)
    expect(node.position.toArray()).toEqual([0, 0, 0.07])
    expect(node.quaternion.equals(restQuat)).toBe(true)
  })

  it('旋转任意角度时**轮心不动**（补偿生效）；不补偿则轮心飞出（回归的证据形式）', () => {
    for (const ang of [0.3, 1.7, 4.2]) {
      const node = mkNode()
      const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang)
      applyWheelSpin(node, restPos, restQuat, pivot, restPivotRot, spin, travelAxis, 0)
      // 轮心在节点变换后的位置
      const c = pivot.clone().applyQuaternion(node.quaternion).add(node.position)
      expect(c.distanceTo(pivot)).toBeLessThan(1e-6)
      // 无补偿（旧写法）：只写旋转不补位置 ⇒ 轮心漂 2·|pivot|·sin(θ/2)（0.3 rad 即 0.9 m）
      const bad = pivot.clone().applyQuaternion(spin)
      expect(bad.distanceTo(pivot)).toBeCloseTo(2 * pivot.length() * Math.sin(ang / 2), 6)
    }
  })

  it('自转轴 = 局部 X：绕 X 转 90° 后，偏移向量的 y/z 分量互换并变号', () => {
    const node = mkNode()
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
    applyWheelSpin(node, restPos, restQuat, pivot, restPivotRot, spin, travelAxis, 0)
    // 轮心相对节点的偏移：旋转后 (0, y, z) → 位置补偿量 = pivot − R·pivot
    const rot = pivot.clone().applyQuaternion(spin)
    expect(rot.x).toBeCloseTo(0, 9)
    expect(rot.y).toBeCloseTo(-0.4, 9)     // (y,z) = (3, 0.4) → (−0.4, 3)
    expect(rot.z).toBeCloseTo(3, 9)
  })
})

describe('节点名解析与几何口径（数据 ↔ 模型的绑定契约）', () => {
  it('轮节点：chassis_wheel_{L,R}_NN → 侧 + 1 基编号（= yaml wheels 下标 + 1）', () => {
    expect(parseWheelNodeName('chassis_wheel_L_01')).toEqual({ side: 'L', index: 1 })
    expect(parseWheelNodeName('chassis_wheel_R_22')).toEqual({ side: 'R', index: 22 })
    expect(parseWheelNodeName('chassis_wheel_L_1')).toBe(null)     // 客户端格式串是 %.2d
    expect(parseWheelNodeName('chassis_wheels_L')).toBe(null)
    expect(parseWheelNodeName('hull')).toBe(null)
  })

  it('履带节点：单段（无段号）与编号段（4/735 辆多段模型）都认；其它名字不认', () => {
    expect(parseTrackNodeName('chassis_track_L')).toEqual({ side: 'L', segment: 0 })
    expect(parseTrackNodeName('chassis_track_R_02')).toEqual({ side: 'R', segment: 2 })
    expect(parseTrackNodeName('chassis_track_L_02')).toEqual({ side: 'L', segment: 2 })
    expect(parseTrackNodeName('chassis_track_crash_L')).toBe(null)
    expect(parseTrackNodeName('chassis_track_L_x')).toBe(null)
  })

  it('轮半径：纵剖面半跨均值；退化输入回落 0.3', () => {
    expect(wheelRadiusFromExtents(0.666, 0.666)).toBeCloseTo(0.333, 6)   // 圆柱轮胎（如实测 SPHT）
    expect(wheelRadiusFromExtents(0, 0)).toBe(0.3)
    expect(wheelRadiusFromExtents(NaN, NaN)).toBe(0.3)
  })

  it('chunkLength = 链路平均段长；退化输入回落 0.25', () => {
    expect(chainAverageSegment([[0, 0], [3, 4]])).toBeCloseTo(5, 9)      // 一段：3-4-5
    expect(chainAverageSegment([[0, 0], [2, 0], [2, 1]])).toBeCloseTo(1.5, 9)
    expect(chainAverageSegment([])).toBe(0.25)
    expect(chainAverageSegment([[0, 0], [0, 0]])).toBe(0.25)
  })
})

describe('行程：夹紧 / 限速 / 首帧吸附（客户端 [pz−b, pz+a] + wheelsReactionSpeed）', () => {
  it('夹紧到 [−down, +up]；缺失值回落兜底常数', () => {
    expect(clampTravel(0.5, 0.13, 0.2)).toBe(0.13)
    expect(clampTravel(-0.9, 0.13, 0.2)).toBe(-0.2)
    expect(clampTravel(0.05, 0.13, 0.2)).toBe(0.05)
    expect(clampTravel(0.5, NaN, NaN)).toBe(SUSP_FALLBACK.travelUp)
    expect(clampTravel(-9, NaN, NaN)).toBe(-SUSP_FALLBACK.travelDown)
  })

  it('限速：每帧最多走 rate·dt；到达即停；snap/dt≤0 直接吸附', () => {
    // rate 1 m/s、dt 0.1s ⇒ 每帧 0.1 m
    expect(rateLimitTravel(0, 0.5, 1, 0.1, false)).toBeCloseTo(0.1, 12)
    expect(rateLimitTravel(0, -0.5, 1, 0.1, false)).toBeCloseTo(-0.1, 12)
    expect(rateLimitTravel(0.09, 0.1, 1, 0.1, false)).toBeCloseTo(0.1, 12)   // 差量小于步长 ⇒ 直接到
    expect(rateLimitTravel(0.3, 0.5, 1, 0.1, true)).toBe(0.5)               // 首帧吸附
    expect(rateLimitTravel(0.3, 0.5, 1, 0, false)).toBe(0.5)                // seek：dt=0
  })
})

describe('自转：θ += −Δs/r，绕局部 X（前滚 ⇒ 顶部随车向前）', () => {
  it('前进行驶使角度单调减小、且按半径换算', () => {
    const t1 = spinStep(0, 1.0, 0.5)          // 走 1 m、半径 0.5 m ⇒ Δθ = −2 rad
    expect(t1).toBeCloseTo(-2, 12)
    expect(spinStep(t1, 1.0, 0.5)).toBeCloseTo(-4 + Math.PI * 2, 6)   // 折叠进 ±π
  })

  it('倒车反向；半径非法时不动（fail-safe）', () => {
    expect(spinStep(0, -1.0, 0.5)).toBeCloseTo(2, 12)
    expect(spinStep(0.7, 1.0, 0)).toBe(0.7)
  })

  it('wrapSpin 折到 ±π（±π 同角，取绝对值判定）', () => {
    expect(Math.abs(wrapSpin(3 * Math.PI))).toBeCloseTo(Math.PI, 9)
    expect(Math.abs(wrapSpin(-3 * Math.PI))).toBeCloseTo(Math.PI, 9)
    expect(wrapSpin(0.5)).toBeCloseTo(0.5, 12)
  })
})

describe('花纹滚动：每米 V = 网格实测 dV/ds（≠ 客户端形式常数）', () => {
  it('按每米速率累计；速率为 0/缺失不滚动', () => {
    expect(treadScrollStep(0, 2, -0.65)).toBeCloseTo(-1.3, 9)
    expect(treadScrollStep(0.42, 2, 0)).toBe(0.42)
    expect(treadScrollStep(0.42, 2, 0.8)).toBeCloseTo(0.42 + 1.6, 9)
  })

  it('沿带斜率测量：线性数据取精确斜率；图集换行（跳变）不污染', () => {
    const lin = [];
    for (let s = 0; s < 15; s += 0.2) lin.push([s, -0.6 * s]);            // dV/ds = −0.6
    expect(measureBeltUvSlope(lin).slope).toBeCloseTo(-0.6, 6)
    expect(measureBeltUvSlope(lin).ok).toBe(true)
    const wrap = [];
    for (let s = 0; s < 15; s += 0.2) {
      const v = -0.6 * s;
      wrap.push([s, v - Math.floor(v / 9) * 9]);                          // 每 9 V 换行
    }
    expect(measureBeltUvSlope(wrap).slope).toBeCloseTo(-0.6, 6)
  })

  it('同一弧长上的横向重复行（桶内取中位）与样本不足的 fail-closed', () => {
    const rows = [];
    for (let s = 0; s < 6; s += 0.25) { for (const _ of [0, 1, 2]) rows.push([s, -0.5 * s]); }
    expect(measureBeltUvSlope(rows).slope).toBeCloseTo(-0.5, 6)
    expect(measureBeltUvSlope([[0, 0], [1, -0.5]]).ok).toBe(false)        // 样本太少
  })

  it('底段走向：点序"车尾→车头" = +1；反向 = −1（决定滚动符号）', () => {
    const rear2front = [[-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [2.5, 1], [0, 1]];
    const front2rear = [[2, 0], [1, 0], [0, 0], [-1, 0], [-2, 0], [-2.5, 1], [0, 1]];
    expect(chainBottomRunDir(rear2front)).toBe(1)
    expect(chainBottomRunDir(front2rear)).toBe(-1)
  })
})

describe('侧位移投影', () => {
  it('sideTravel：带符号的纵向投影（倒车为负）', () => {
    expect(sideTravel(0, 0, 1, 0, 1, 0)).toBeCloseTo(1, 12)
    expect(sideTravel(0, 0, -1, 0, 1, 0)).toBeCloseTo(-1, 12)
    // 侧向位移不计入（前向 = +x）
    expect(sideTravel(0, 0, 0, 5, 1, 0)).toBeCloseTo(0, 12)
  })
})

describe('相位累加器（§6.7：侧实体 [实体+0xac]，clamp01(phase ± dS·speed·100)）', () => {
  it('非前驱（frontDrive=false）：前进加、倒车减；步长 = |dS|·speed·100', () => {
    expect(trackPhaseStep(0, 0.002, 1.0, false)).toBeCloseTo(0.2, 12)    // 0.002·1·100
    expect(trackPhaseStep(0.5, 0.002, 1.0, false)).toBeCloseTo(0.7, 12)
    expect(trackPhaseStep(0.5, -0.002, 1.0, false)).toBeCloseTo(0.3, 12)
  })

  it('前驱（frontDrive=true）：符号反转', () => {
    expect(trackPhaseStep(0.5, 0.002, 1.0, true)).toBeCloseTo(0.3, 12)
    expect(trackPhaseStep(0.5, -0.002, 1.0, true)).toBeCloseTo(0.7, 12)
  })

  it('clamp [0,1]：越界截断；speed 缺失回落 1.0', () => {
    expect(trackPhaseStep(0.99, 0.01, 1.0, false)).toBe(1)
    expect(trackPhaseStep(0.01, -0.01, 1.0, false)).toBe(0)
    expect(trackPhaseStep(0, 0.002, NaN, false)).toBeCloseTo(0.2, 12)
  })
})

describe('段系数（0x82ee40 直译：f = (upperMin + phase·B_kind)·dist^lengthPower）', () => {
  const bend = {
    upper_min: 0.28, upper_factor: 0.59, front_factor: 0.4, back_factor: 0.25,
    length_power: 0.5, front_drive_wheel: false,
  }

  it('kind1（顶带）：upperFactor，无相位翻转', () => {
    const f = bendFactor(1, 0.5, bend, 4)
    expect(f).toBeCloseTo((0.28 + 0.5 * 0.59) * Math.pow(4, 0.5), 9)
  })

  it('kind2/3（前后坡）：frontFactor/backFactor；相位翻转 ⇔ frontDriveWheel == (kind===2)', () => {
    // frontDrive=false：kind2 不翻转、kind3 翻转（1−phase）
    expect(bendFactor(2, 0.5, bend, 1)).toBeCloseTo(0.28 + 0.5 * 0.4, 9)
    expect(bendFactor(3, 0.5, bend, 1)).toBeCloseTo(0.28 + 0.5 * 0.25, 9)
    const fd = { ...bend, front_drive_wheel: true }
    expect(bendFactor(2, 0.5, fd, 1)).toBeCloseTo(0.28 + 0.5 * 0.4, 9)   // 翻转：1−0.5 = 0.5（对称值）
    expect(bendFactor(2, 0.7, fd, 1)).toBeCloseTo(0.28 + 0.3 * 0.4, 9)   // 1−0.7 = 0.3
  })

  it('kind0（底带）与 kind4（铺放节点）：系数 1.0；kind4 的翻转 ⇔ !frontDrive', () => {
    expect(bendFactor(0, 0.5, bend, 1)).toBeCloseTo(0.28 + 0.5, 9)       // frontDrive=false ⇒ 翻转（对称）
    expect(bendFactor(4, 0.7, bend, 1)).toBeCloseTo(0.28 + 0.3, 9)       // 1−0.7
    expect(bendFactor(4, 0.7, { ...bend, front_drive_wheel: true }, 1)).toBeCloseTo(0.28 + 0.7, 9)
  })

  it('幂次作用于弦长；bend 缺失 ⇒ 0（fail-closed，不猜）', () => {
    expect(bendFactor(1, 0, { upper_min: 0.5, length_power: 2 }, 3)).toBeCloseTo(0.5 * 9, 9)
    expect(bendFactor(1, 0, null, 1)).toBe(0)
    expect(bendFactor(0, 0.9, null, 1)).toBe(0)                          // kind0 也不能在无数据时垂
  })
})

describe('铺放权重（0x838380 直译：bF·dist^lP / count^pP · maxDrop^prP · fBend^pr2P）', () => {
  const laying = {
    bending_factor: 0.744, length_power: 0.92, point_count_power: 0.918,
    pressure_power: 0.26, primary_power: 0.67,
  }

  it('五参数逐项生效（IS-7 实测值手算对照）', () => {
    const w = layWeight(2, 6, 0.1, 0.28, laying)
    const expectW = 0.744 * Math.pow(2, 0.92) / Math.pow(6, 0.918)
      * Math.pow(0.1, 0.26) * Math.pow(0.28, 0.67)
    expect(w).toBeCloseTo(expectW, 12)
    expect(w).toBeGreaterThan(0)
  })

  it('结构性方向：接触数越多越紧（除）、离地越深权重越大（乘）', () => {
    const base = layWeight(2, 6, 0.1, 0.28, laying)
    expect(layWeight(2, 12, 0.1, 0.28, laying)).toBeLessThan(base)       // count ↑ ⇒ w ↓
    expect(layWeight(2, 6, 0.4, 0.28, laying)).toBeGreaterThan(base)     // maxDrop ↑ ⇒ w ↑
  })

  it('缺失 laying → 0（无加性项，fail-closed）', () => {
    expect(layWeight(2, 6, 0.1, 0.28, null)).toBe(0)
  })
})

// 合成环链：底段（z=0，0..6，车尾→车头）—— 前坡 —— 顶段（z=0.55，骑在轮顶，车头→车尾）—— 后坡
// 轮在 x = −2/0/2（正下方）：底点距轮心 0.25（|0.25−0.3|=0.05 ≤ tol）、顶点距轮心 0.30（err=0）
function makeLoop() {
  const pts = []
  for (let i = 0; i <= 6; i++) pts.push([-3 + i, 0])          // 底段 0..6
  pts.push([3.3, 0.2], [3.4, 0.4])                            // 前坡 7..8
  for (let i = 0; i <= 6; i++) pts.push([3 - i, 0.55])        // 顶段 9..15（x=3..−3）
  pts.push([-3.4, 0.4], [-3.3, 0.2])                          // 后坡 16..17
  return pts
}

const LOOP_WHEELS = [
  { longitudinal: -2, centerZ: 0.25, radius: 0.3 },
  { longitudinal: 0, centerZ: 0.25, radius: 0.3 },
  { longitudinal: 2, centerZ: 0.25, radius: 0.3 },
]

describe('段生成（0x708770 直译：相邻挂接点 span 绕环闭合 + 包围盒分带）', () => {
  it('锚点 = 挂接点（底/顶都算）；span 绕环闭合（末锚→首锚）', () => {
    const chain = makeLoop()
    const attach = attachChainToWheels(chain, LOOP_WHEELS)
    const anchors = []
    for (let i = 0; i < chain.length; i++) if (attach[i] >= 0) anchors.push(i)
    expect(anchors).toEqual([1, 3, 5, 10, 12, 14])                 // 底 3 + 顶 3
    const segs = deriveTrackSegments(chain, attach)
    expect(segs.length).toBe(anchors.length)                       // 绕环闭合
    expect(segs[0].i0).toBe(anchors[0])
    expect(segs[segs.length - 1].i1).toBe(anchors[0])              // 闭合回首锚
  })

  it('kind 分带：底带 0 / 顶带 1 / 纵向中线两侧 2·3（首中即停 0→1→2→3）', () => {
    const chain = makeLoop()
    const attach = new Int32Array(chain.length).fill(-1)
    attach[1] = 0; attach[3] = 1; attach[5] = 2      // 底段三锚（x=−2/0/2）
    attach[10] = 0; attach[12] = 1; attach[14] = 2   // 顶段三锚（x=2/0/−2，骑轮顶）
    const segs = deriveTrackSegments(chain, attach)
    // spans: (1,3) (3,5) (5,10) (10,12) (12,14) (14→1)
    expect(segs.map((s) => s.kind)).toEqual([0, 0, 2, 1, 1, 3])
  })

  it('锚点不足 2 个 ⇒ 无段（fail-closed）', () => {
    const chain = makeLoop()
    const attach = new Int32Array(chain.length).fill(-1)
    attach[3] = 1
    expect(deriveTrackSegments(chain, attach)).toEqual([])
  })
})

describe('chainPointAtArc：按弧长取点 + 朝下法向', () => {
  const xs = new Float64Array([0, 2, 4])
  const ys = new Float64Array([0, 0, 0])
  const cum = new Float64Array([0, 2, 4])

  it('直链中点取 (1,0)，法向朝下 (0,−1)', () => {
    const p = chainPointAtArc(cum, xs, ys, 1)
    expect(p.x).toBeCloseTo(1, 9)
    expect(p.y).toBeCloseTo(0, 9)
    expect(p.nx).toBeCloseTo(0, 9)
    expect(p.ny).toBeCloseTo(-1, 9)
  })

  it('弧长越界夹到两端', () => {
    expect(chainPointAtArc(cum, xs, ys, -1).x).toBeCloseTo(0, 9)
    expect(chainPointAtArc(cum, xs, ys, 99).x).toBeCloseTo(4, 9)
  })
})

describe('2D 链解算（solveTrackChain2D：贴地收敛 / 顶段铺开 / 垂弧 / 包轮）', () => {
  const chain = makeLoop()
  const n = chain.length
  const restX = new Float64Array(chain.map((p) => p[0]))
  const restY = new Float64Array(chain.map((p) => p[1]))
  const attach = new Int32Array(n).fill(-1)
  attach[1] = 0; attach[3] = 1; attach[5] = 2      // 底段三锚（轮 0/1/2）
  attach[10] = 0; attach[12] = 1; attach[14] = 2   // 顶段三锚（骑轮顶）
  const segs = deriveTrackSegments(chain, attach)
  const mkState = () => ({
    curX: new Float64Array(n), curY: new Float64Array(n),
    chaseY: new Float64Array(n), mask: new Uint8Array(n),
  })
  const zeros = new Float64Array([0, 0, 0])
  const step = (st, groundY, delta, dt, phase, bend, laying) =>
    solveTrackChain2D(st.curX, st.curY, restX, restY, attach, delta, st.chaseY,
                      segs, groundY, dt, phase, bend, laying, LOOP_WHEELS, st.mask)

  it('贴地：底带点跨帧收敛到地形（1.2·dt 限速），顶带与挂接点不动', () => {
    const st = mkState()
    const groundY = new Float64Array(n).fill(-0.3)     // 沟底：全链地面 −0.3
    const dt = 1 / 60
    step(st, groundY, zeros, dt, 0, null, null)
    // 一帧：底带非挂接点走 1.2·dt = 0.02
    expect(st.curY[0]).toBeCloseTo(-CHASE_RATE * dt, 9)
    // 挂接点（1/3/5）不 chase：绝对跟轮（行程 0 ⇒ 原地）
    expect(st.curY[1]).toBeCloseTo(0, 9)
    expect(st.curY[3]).toBeCloseTo(0, 9)
    // 顶带点不 chase（0.55 > miny+0.1·range）
    expect(st.curY[9]).toBeCloseTo(restY[9], 9)
    // 多帧后收敛到地面（限速累积；bend=null ⇒ 无垂弧干扰）
    for (let f = 0; f < 120; f++) step(st, groundY, zeros, dt, 0, null, null)
    expect(st.curY[0]).toBeCloseTo(-0.3, 6)
    expect(st.curY[2]).toBeCloseTo(-0.3, 6)
    expect(st.curY[4]).toBeCloseTo(-0.3, 6)
  })

  it('死区 5 mm：地面差 ≤ 死区不追', () => {
    const st = mkState()
    const groundY = new Float64Array(n).fill(-0.004)   // 4 mm < 5 mm 死区
    step(st, groundY, zeros, 1 / 60, 0, null, null)
    expect(st.curY[0]).toBeCloseTo(0, 9)
  })

  it('挂接点绝对跟轮（静止锚点 + 轮行程）；dt=0（seek）时贴地不动', () => {
    const st = mkState()
    const groundY = new Float64Array(n).fill(-0.3)
    const delta = new Float64Array([0.1, 0, -0.1])
    step(st, groundY, delta, 0, 0, null, null)
    expect(st.curY[1]).toBeCloseTo(0.1, 9)     // rest 0 + 行程 0.1
    expect(st.curY[5]).toBeCloseTo(-0.1, 9)
    expect(st.curY[0]).toBeCloseTo(0, 9)       // dt=0 ⇒ chase 不动
  })

  it('顶段铺开：kind1 段内部点落在端点弦线的等分点上（纵向+高度双分量）', () => {
    const st = mkState()
    const groundY = new Float64Array(n).fill(0)
    step(st, groundY, zeros, 0, 0, null, null)
    // 顶段 span (10→12)：内部点 11 落在弦中点（等距分母 = 内部点数+1 = 2）
    expect(st.curX[11]).toBeCloseTo((restX[10] + restX[12]) / 2, 6)
    expect(st.curY[11]).toBeCloseTo((restY[10] + restY[12]) / 2, 6)
  })

  it('垂弧：底段（kind0）内部点向下垂，幅度 = w·(t−t²)，w = (upperMin+phase)·len^P', () => {
    const st = mkState()
    const groundY = new Float64Array(n).fill(0)
    const bend = { upper_min: 0.28, upper_factor: 0.59, front_factor: 0.4,
                   back_factor: 0.25, length_power: 0.5, front_drive_wheel: false }
    step(st, groundY, zeros, 0, 0.5, bend, null)
    // 底段 span (1→3)：len = 2、内部点 2（t=0.5）；kind0 且 frontDrive=false ⇒ 翻转 1−0.5
    const w = (0.28 + 0.5) * Math.pow(2, 0.5)
    const expectDrop = w * (0.5 - 0.25) * 1        // dirY = −|ux| = −1
    expect(st.curY[2]).toBeCloseTo(-expectDrop, 6)
    expect(st.curY[2]).toBeLessThan(0)
    // 端点（挂接点）绝对跟轮（t=0/t=1 处垂弧位移为 0）
    expect(st.curY[1]).toBeCloseTo(0, 9)
    expect(st.curY[3]).toBeCloseTo(0, 9)
  })

  it('包轮：顶段挂接点被 max 抬到轮圆 + wLay', () => {
    const st = mkState()
    const groundY = new Float64Array(n).fill(0)
    const laying = { bending_factor: 0.05, length_power: 1, point_count_power: 0,
                     pressure_power: 0, primary_power: 0 }
    step(st, groundY, zeros, 0, 0, null, laying)
    // 顶锚 10/12/14 在轮正上方（dx=0）：y ≥ cz+r；wLay > 0 ⇒ 严格高于轮顶
    for (const idx of [10, 12, 14]) {
      expect(st.curY[idx]).toBeGreaterThanOrEqual(0.55)
    }
    expect(st.curY[12]).toBeGreaterThan(0.55)      // wLay 加性项把它顶到轮圆之上
  })
})

describe('顶点弧长重参数化（沿带滑动 + 法向厚度保持）', () => {
  const rest = [[0, 0], [2, 0], [4, 0]]
  const cum = new Float64Array([0, 2, 4])
  // 顶点：横向 0、纵向 1、高度 0.2（带内衬厚度）——模型根系 = 局部系（identity）
  const pos = new Float32Array([0, 1, 0.2])
  const identity = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1])

  it('投影：s = 弧长 1、d = 有符号法向偏移（朝下法向 ⇒ 链上方为负）', () => {
    const arc = vertexArcParams(pos, rest, cum)
    expect(arc.s[0]).toBeCloseTo(1, 6)
    expect(arc.d[0]).toBeCloseTo(-0.2, 6)      // 顶点在链上方 0.2、法向朝下 ⇒ d = −0.2
    expect(arc.restLong[0]).toBeCloseTo(1, 6)
    expect(arc.restH[0]).toBeCloseTo(0.2, 6)
  })

  it('链不变 ⇒ 顶点不动（位移恒等）', () => {
    const arc = vertexArcParams(pos, rest, cum)
    const out = new Float32Array(3)
    placeVerticesOnChain(out, pos, arc, cum, new Float64Array([0, 2, 4]),
                         new Float64Array([0, 0, 0]), identity)
    expect(out[1]).toBeCloseTo(1, 6)
    expect(out[2]).toBeCloseTo(0.2, 6)
  })

  it('链起伏 ⇒ 顶点沿带滑动（纵向也变）且保持法向厚度', () => {
    const arc = vertexArcParams(pos, rest, cum)
    const out = new Float32Array(3)
    // 链中点抬到 0.5：顶点 s=1 处的链点 ≈ (0.9701, 0.2425)，随链倾斜
    placeVerticesOnChain(out, pos, arc, cum, new Float64Array([0, 2, 4]),
                         new Float64Array([0, 0.5, 0]), identity)
    const dx = out[1], dz = out[2]
    // 法向厚度保持：顶点到链的**有符号距离**（朝下法向）仍 = d（−0.2，顶点在上方）
    const segLen = Math.hypot(2, 0.5)
    const t = (dx * 2 + dz * 0.5) / (segLen * segLen)
    const px = 2 * t, pz = 0.5 * t
    const dist = (dx - px) * (0.5 / segLen) + (dz - pz) * (-2 / segLen)
    expect(dist).toBeCloseTo(-0.2, 5)
    // 纵向确实滑动了（弧长参数化的核心不变量）
    expect(Math.abs(dx - 1)).toBeGreaterThan(1e-3)
  })

  it('网格带旋转：位移经逆旋转回局部系（root +z = 局部 +y）', () => {
    const arc = vertexArcParams(pos, rest, cum)
    // 先跑 identity 得到根系位移（Δlong, Δh）
    const ref = new Float32Array(3)
    placeVerticesOnChain(ref, pos, arc, cum, new Float64Array([0, 2, 4]),
                         new Float64Array([0, 0.5, 0]), identity)
    const dLong = ref[1] - pos[1]
    const dH = ref[2] - pos[2]
    // invRot：root (x,y,z) → local (x, z, −y)：行主序 [[1,0,0],[0,0,1],[0,−1,0]]
    const invRot = new Float64Array([1, 0, 0, 0, 0, 1, 0, -1, 0])
    const out = new Float32Array(3)
    placeVerticesOnChain(out, pos, arc, cum, new Float64Array([0, 2, 4]),
                         new Float64Array([0, 0.5, 0]), invRot)
    expect(out[0]).toBeCloseTo(pos[0], 6)                 // 横向不动
    expect(out[1]).toBeCloseTo(pos[1] + dH, 6)            // root 高度位移 → local y
    expect(out[2]).toBeCloseTo(pos[2] - dLong, 6)         // root 纵向位移 → local −z
  })
})

describe('轮贴地三采样（客户端射线口径的高度场版）', () => {
  it('平地：45° 侧样本更宽松（垂向行程损失），取竖直采样值', () => {
    const h = wheelGroundMax(() => 5, 0, 0, 1, 0, 0.3)
    expect(h).toBeCloseTo(5, 9)
  })

  it('前上方陡升：侧样本（减 (1−cos45°)·r）比轮心采样早发现坎沿', () => {
    let calls = 0
    const h = wheelGroundMax((x) => { calls++; return x > 0.1 ? 5.2 : 5 }, 0, 0, 1, 0, 0.3)
    expect(calls).toBe(3)
    const drop = 0.3 * (1 - Math.SQRT1_2)
    expect(h).toBeCloseTo(5.2 - drop, 9)           // 5.112 > 5 ⇒ 坎沿被侧样本抓到
    expect(h).toBeGreaterThan(5)
  })
})

describe('花纹偏移写 V：取模只作用于偏移（保护跨 wrap 图元的插值）', () => {
  it('跨多个 wrap 的四边形：两端 ΔV 保持不变（逐顶点取模会把 2.85 折成 0.15 ⇒ 拉长 18×）', () => {
    // 实测 KRV 底段：一根四边形跨 2.85 个 wrap（V 1.548 → 4.394）
    const base = new Float32Array([0.3, 1.548, 0.9, 4.394]);
    const uv = new Float32Array(base.length);
    writeUvOffsetV(uv, base, 0.3);
    expect(uv[1] - uv[3]).toBeCloseTo(1.548 - 4.394, 5);        // ΔV 保持（插值不被破坏）
    // 对照：逐顶点取模（旧写法）会把 ΔV 折成 0.15 量级
    const bad = [1.548 + 0.3, 4.394 + 0.3].map((v) => v - Math.floor(v));
    expect(Math.abs(bad[0] - bad[1])).toBeLessThan(0.2);
  })

  it('整带同相：所有顶点按同一相位平移；偏移取整不改变观感（REPEAT 等价）', () => {
    const base = new Float32Array([0.1, 2.7, 0.2, 9.05, 0.3, 4.15]);
    // 目标数组就是"活着的 UV 属性"（初始内容 = base），函数只重写 V
    const a = base.slice(); const b = base.slice();
    writeUvOffsetV(a, base, 0.25);
    writeUvOffsetV(b, base, 3.25);      // 相差整数 wrap
    for (let i = 0; i < base.length / 2; i++) {
      expect(a[i * 2 + 1]).toBeCloseTo(base[i * 2 + 1] + 0.25, 5);
      expect(b[i * 2 + 1]).toBeCloseTo(a[i * 2 + 1], 5);        // 偏移差整数 ⇒ 写入完全相同（相位吸收）
      expect(a[i * 2]).toBe(base[i * 2]);                      // U 不动
    }
    // 负偏移也走同一相位
    const c = base.slice();
    writeUvOffsetV(c, base, -0.25);
    expect(c[1]).toBeCloseTo(base[1] + 0.75, 5);
  })
})

describe('chainChanged（履带形变 = 链的纯函数；下发判定按下发链比较）', () => {
  it('链相同 ⇒ false（顶点逐点相同）；任一点不同 / 长度或空值 ⇒ true（fail-safe）', () => {
    const a = new Float64Array([1, 2, 3, 4])
    const b = Float64Array.from(a)
    expect(chainChanged(a, b)).toBe(false)
    b[2] = 3.0000001
    expect(chainChanged(a, b)).toBe(true)      // 1e-7 级差异也判"变了"（严格比较，宁多传一次）
    expect(chainChanged(null, a)).toBe(true)   // 首帧
    expect(chainChanged(a, null)).toBe(true)
    expect(chainChanged(a, new Float64Array([1, 2, 3]))).toBe(true)
  })
})

describe('chainDrift（法线闸门：与上次重算法线时的链逐点比较）', () => {
  it('最大幅度与均值相同、形变位置不同 ⇒ 也必须检出（旧口径漏报的形态）', () => {
    const a = new Float64Array([0.1, 0, 0, 0])
    const b = new Float64Array([0, 0.1, 0, 0])
    // 两个"累计统计量"完全相同——这正是 dmax/dmean 闸门漏报的场景（review 复审 P2 复现）
    const max = (v) => Math.max(...v)
    const mean = (v) => v.reduce((s, x) => s + Math.abs(x), 0) / v.length
    expect(max(a)).toBeCloseTo(max(b), 12)
    expect(mean(a)).toBeCloseTo(mean(b), 12)
    // 逐点比较能看到 0.1 m 的位移（> 2 cm 阈值 ⇒ 重算法线）
    expect(chainDrift(a, b)).toBeCloseTo(0.1, 12)
    expect(chainDrift(a, Float64Array.from(a))).toBe(0)
    // fail-safe：首帧 / 长度不符 ⇒ Infinity（必重算）
    expect(chainDrift(null, a)).toBe(Infinity)
    expect(chainDrift(a, new Float64Array([0.1]))).toBe(Infinity)
  })
})
