/**
 * 悬挂求解纯函数单测（客户端同构；公式出处 = 上游 docs/tank-suspension-client-re.md §六）。
 *
 * 锁的都是"少一行就退化成另一个东西"的口径：
 *  · 行程夹紧/限速/首帧吸附（客户端 `copysign(min(|Δ|, rate·dt), Δ)` + `[−b, +a]`）
 *  · 自转方向与半径换算（θ += −Δs/r，绕局部 X）
 *  · 花纹每米 V = textureScale / chunkLength
 *  · 链路解算三步顺序（逐轮偏移 → 垂弧 → 铺地）与**方向性**：
 *    铺地只抬不压（地面在下方时履带悬空）、垂弧向下、包轮只约束轮顶以上
 *  · 顶点 → 链路的映射与位移方向（网格带旋转时沿局部等效轴）
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  applyWheelSpin,
  clampTravel, rateLimitTravel, spinStep, wrapSpin, treadScrollStep, groundDropLocal,
  attachChainToWheels, solveChain, vertexChainParams, applyChainToVertices, chainChanged, sideTravel,
  parseWheelNodeName, parseTrackNodeName, wheelRadiusFromExtents, chainAverageSegment,
  measureBeltUvSlope, chainBottomRunDir, writeUvOffsetV,
  SUSP_FALLBACK,
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

describe('地形折算与侧位移', () => {
  it('groundDropLocal：除以车体 up 的世界 y 分量；倾倒过大 ⇒ 0（停摆而非发散）', () => {
    expect(groundDropLocal(10, 9.5, 1)).toBeCloseTo(0.5, 12)
    expect(groundDropLocal(10, 9.5, 0.5)).toBeCloseTo(1.0, 12)
    expect(groundDropLocal(10, 9.5, 0.1)).toBe(0)
  })

  it('sideTravel：带符号的纵向投影（倒车为负）', () => {
    expect(sideTravel(0, 0, 1, 0, 1, 0)).toBeCloseTo(1, 12)
    expect(sideTravel(0, 0, -1, 0, 1, 0)).toBeCloseTo(-1, 12)
    // 侧向位移不计入（前向 = +x）
    expect(sideTravel(0, 0, 0, 5, 1, 0)).toBeCloseTo(0, 12)
  })
})

// 合成链路：底段（z=0）—— 前端弧 —— 上段（z=1）—— 后端弧，闭环
// 纵向 x 与高度 z 都不同，用于检验"底段/上段同纵向位置"的挂接消歧
function makeLoop() {
  const pts = []
  for (let i = 0; i <= 6; i++) pts.push([-3 + i, 0])          // 底段 0..6
  pts.push([3.4, 0.3], [3.6, 0.7])                            // 前端弧 7..8
  for (let i = 0; i <= 6; i++) pts.push([3.6 - i * 0.9, 1.0]) // 上段 9..15
  pts.push([-3.2, 0.6], [-3.1, 0.2])                          // 后端弧 16..17
  return pts
}

describe('链路解算：三步顺序与方向性（逐轮偏移 → 垂弧 → 铺地）', () => {
  const chain = makeLoop()
  const wheels = [
    { longitudinal: -2.0, centerZ: 0.25, radius: 0.3 },
    { longitudinal: 0.0, centerZ: 0.25, radius: 0.3 },
    { longitudinal: 2.0, centerZ: 0.25, radius: 0.3 },
  ]
  const attach = attachChainToWheels(chain, wheels)
  const zeros = [0, 0, 0]

  it('挂接：只挂底段的近轮点；同纵向的上段点不挂（高度消歧）', () => {
    // 底段点（z=0）中 x=−2/0/2 处应各挂到一个轮
    expect(attach[1]).toBe(0)   // x=−2
    expect(attach[3]).toBe(1)   // x=0
    expect(attach[5]).toBe(2)   // x=2
    // 上段与底段同纵向（如 x≈0 的上段点）不得挂接——它在轮心上方 0.75 m
    const upperIdx = 9 + 3      // 上段 x = 3.6−2.7 = 0.9 ⇒ 找最近的
    expect(chain[upperIdx][1]).toBe(1.0)
    expect(attach[9 + 4]).toBe(-1)   // 上段 x=0 → 若误挂会把上段拉到轮上
  })

  it('逐轮偏移：挂接点随轮移动（含负向）—— 地面在下方，允许下垂', () => {
    const out = new Float64Array(chain.length)
    solveChain(out, chain, attach, [-0.1, 0, 0.2], new Array(chain.length).fill(-1),
               wheels, { upper_factor: 0, length_power: 0.5 })
    expect(out[1]).toBeCloseTo(-0.1, 9)
    expect(out[3]).toBeCloseTo(0, 9)
    expect(out[5]).toBeCloseTo(0.2, 9)
  })

  it('铺地只抬不压：地面在下方（drop<0）时履带保持原高度（悬空）', () => {
    const out = new Float64Array(chain.length)
    const up = new Array(chain.length).fill(0.05)     // 地面高于链点 5 cm ⇒ 抬到地面
    const down = new Array(chain.length).fill(-0.5)   // 地面在下方 0.5 m ⇒ 不跟下去
    solveChain(out, chain, attach, zeros, up, wheels, { upper_factor: 0, length_power: 0.5 })
    expect(out[3]).toBeCloseTo(0.05, 9)
    solveChain(out, chain, attach, zeros, down, wheels, { upper_factor: 0, length_power: 0.5 })
    expect(out[3]).toBeCloseTo(0, 9)
  })

  it('垂弧：支承点之间向下垂，峰在跨度中点、幅度 = upperFactor·span^lengthPower/4', () => {
    const out = new Float64Array(chain.length)
    const bend = { upper_factor: 0.4, length_power: 1.0 }
    solveChain(out, chain, attach, zeros, new Array(chain.length).fill(-1), wheels, bend)
    // 支承点 1（x=−2）与 3（x=0）之间只有点 2（x=−1，t=0.5）；span = 2 m
    const expectedSag = 0.4 * Math.pow(2, 1.0) * (0.5 - 0.25)
    expect(out[2]).toBeCloseTo(-expectedSag, 9)
    expect(out[1]).toBeCloseTo(0, 9)                  // 支承点本身不动
    expect(out[3]).toBeCloseTo(0, 9)
  })

  it('包轮约束只作用于轮顶以上：底段（轮心以下）不被顶到轮顶', () => {
    const out = new Float64Array(chain.length)
    solveChain(out, chain, attach, [-0.3, -0.3, -0.3], new Array(chain.length).fill(-1), wheels,
               { upper_factor: 0, length_power: 0.5 })
    // 底段点（z 由 0 降到 −0.3）必须仍是负值——若误用 max(y, cy+√(r²−dx²)) 会被抬到 ≈0.55
    expect(out[1]).toBeLessThan(0)
    expect(out[3]).toBeLessThan(0)
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

describe('顶点形变：映射 + 位移方向', () => {
  it('顶点→段落映射取最近段，位移在段内线性插值', () => {
    const rest = [[0, 0], [2, 0], [4, 0]]
    // 顶点 (x, y, z)：链路平面用 (y, z) —— 纵向=y、高度=z
    const pos = new Float32Array([
      0, 0, 1,     // 纵向 0 → 段 0 t=0
      0, 1, 1,     // 纵向 1 → 段 0 t=0.5
      0, 2.5, 1,   // 纵向 2.5 → 段 1 t=0.25
    ])
    const params = vertexChainParams(pos, rest)
    expect(Array.from(params.seg)).toEqual([0, 0, 1])
    expect(params.t[0]).toBeCloseTo(0, 6)
    expect(params.t[1]).toBeCloseTo(0.5, 6)
    expect(params.t[2]).toBeCloseTo(0.25, 6)
    const out = new Float32Array(pos.length)
    const chainZ = [0.5, 0.5, 0.5]      // 链整体上抬 0.5
    const restZ = [0, 0, 0]
    const maxAbs = applyChainToVertices(out, pos, params, chainZ, restZ, [0, 0, 1])
    expect(maxAbs).toBeCloseTo(0.5, 6)
    expect(out[0]).toBeCloseTo(0, 6)     // x 不动
    expect(out[1]).toBeCloseTo(0, 6)     // y（纵向）不动
    expect(out[2]).toBeCloseTo(1.5, 6)   // z = 静止 1 + 位移 0.5
  })

  it('网格带旋转时沿"局部等效轴"位移（模型 +z = 局部 +y 的四元数）', () => {
    const rest = [[0, 0], [1, 0]]
    const pos = new Float32Array([0, 0, 0])   // (纵向 0, 高度 0) → 段 0 t=0
    const params = vertexChainParams(pos, rest)
    const out = new Float32Array(3)
    applyChainToVertices(out, pos, params, [0.25, 0.25], [0, 0], [0, 1, 0])
    expect(out[1]).toBeCloseTo(0.25, 6)
    expect(out[2]).toBeCloseTo(0, 6)
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
