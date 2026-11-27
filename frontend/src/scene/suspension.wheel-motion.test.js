import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { applyWheelSpin, clampTravel, rateLimitTravel, spinStep, wrapSpin, treadScrollStep, groundDropLocal, sideTravel, parseWheelNodeName, parseTrackNodeName, wheelRadiusFromExtents, chainAverageSegment, measureBeltUvSlope, chainBottomRunDir, SUSP_FALLBACK } from './suspension.ts'



describe('轮自转位姿：枢轴补偿（导出的轮节点在原点，几何烘进顶点）', () => {
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
      const c = pivot.clone().applyQuaternion(node.quaternion).add(node.position)
      expect(c.distanceTo(pivot)).toBeLessThan(1e-6)
      const bad = pivot.clone().applyQuaternion(spin)
      expect(bad.distanceTo(pivot)).toBeCloseTo(2 * pivot.length() * Math.sin(ang / 2), 6)
    }
  })

  it('自转轴 = 局部 X：绕 X 转 90° 后，偏移向量的 y/z 分量互换并变号', () => {
    const node = mkNode()
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
    applyWheelSpin(node, restPos, restQuat, pivot, restPivotRot, spin, travelAxis, 0)
    const rot = pivot.clone().applyQuaternion(spin)
    expect(rot.x).toBeCloseTo(0, 9)
    expect(rot.y).toBeCloseTo(-0.4, 9)
    expect(rot.z).toBeCloseTo(3, 9)
  })
})



describe('节点名解析与几何口径（数据 ↔ 模型的绑定契约）', () => {
  it('轮节点：chassis_wheel_{L,R}_NN → 侧 + 1 基编号（= yaml wheels 下标 + 1）', () => {
    expect(parseWheelNodeName('chassis_wheel_L_01')).toEqual({ side: 'L', index: 1 })
    expect(parseWheelNodeName('chassis_wheel_R_22')).toEqual({ side: 'R', index: 22 })
    expect(parseWheelNodeName('chassis_wheel_L_1')).toBe(null)
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
    expect(wheelRadiusFromExtents(0.666, 0.666)).toBeCloseTo(0.333, 6)
    expect(wheelRadiusFromExtents(0, 0)).toBe(0.3)
    expect(wheelRadiusFromExtents(NaN, NaN)).toBe(0.3)
  })

  it('chunkLength = 链路平均段长；退化输入回落 0.25', () => {
    expect(chainAverageSegment([[0, 0], [3, 4]])).toBeCloseTo(5, 9)
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
    expect(rateLimitTravel(0, 0.5, 1, 0.1, false)).toBeCloseTo(0.1, 12)
    expect(rateLimitTravel(0, -0.5, 1, 0.1, false)).toBeCloseTo(-0.1, 12)
    expect(rateLimitTravel(0.09, 0.1, 1, 0.1, false)).toBeCloseTo(0.1, 12)
    expect(rateLimitTravel(0.3, 0.5, 1, 0.1, true)).toBe(0.5)
    expect(rateLimitTravel(0.3, 0.5, 1, 0, false)).toBe(0.5)
  })
})



describe('自转：θ += −Δs/r，绕局部 X（前滚 ⇒ 顶部随车向前）', () => {
  it('前进行驶使角度单调减小、且按半径换算', () => {
    const t1 = spinStep(0, 1.0, 0.5)
    expect(t1).toBeCloseTo(-2, 12)
    expect(spinStep(t1, 1.0, 0.5)).toBeCloseTo(-4 + Math.PI * 2, 6)
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

  it('沿带斜率测量：幅值 = |斜率| 中位（符号由底段走向 chainBottomRunDir 定）；图集换行与双行反向都不污染', () => {
    const lin = [];
    for (let s = 0; s < 15; s += 0.2) lin.push([s, -0.6 * s]);
    expect(measureBeltUvSlope(lin).slope).toBeCloseTo(0.6, 6)
    expect(measureBeltUvSlope(lin).ok).toBe(true)
    const wrap = [];
    for (let s = 0; s < 15; s += 0.2) {
      const v = -0.6 * s;
      wrap.push([s, v - Math.floor(v / 9) * 9]);
    }
    expect(measureBeltUvSlope(wrap).slope).toBeCloseTo(0.6, 6)
    const dual = [];
    for (let s = 0; s < 15; s += 0.2) {
      dual.push([s, (-0.6 * s) - Math.floor((-0.6 * s) / 9) * 9]);
      dual.push([s, (0.6 * s) - Math.floor((0.6 * s) / 9) * 9]);
    }
    expect(measureBeltUvSlope(dual).slope).toBeCloseTo(0.6, 6)
    expect(measureBeltUvSlope(dual).ok).toBe(true)
  })

  it('同一弧长上的横向重复行（桶内去重）与样本不足的 fail-closed', () => {
    const rows = [];
    for (let s = 0; s < 6; s += 0.25) { for (const _ of [0, 1, 2]) rows.push([s, -0.5 * s]); }
    expect(measureBeltUvSlope(rows).slope).toBeCloseTo(0.5, 6)
    expect(measureBeltUvSlope([[0, 0], [1, -0.5]]).ok).toBe(false)
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
    expect(sideTravel(0, 0, 0, 5, 1, 0)).toBeCloseTo(0, 12)
  })
})
