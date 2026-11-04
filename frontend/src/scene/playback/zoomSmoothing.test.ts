// zoomSmoothing 纯函数测试：预算收敛、帧率无关、钳制吸收与事件公式锚点（#835）。
import { describe, expect, it } from 'vitest'
import {
  createFlyZoomSmoother, createZoomSmoother, flyWheelFactor, orbitWheelFactor,
  ZOOM_SMOOTH_TAU_SEC, ZOOM_SETTLE_LOG_EPS,
} from './zoomSmoothing.js'

describe('createZoomSmoother 预算收敛', () => {
  it('新平滑器：active=false、advance 返回 1（无缩放）', () => {
    const s = createZoomSmoother()
    expect(s.active()).toBe(false)
    expect(s.advance(0.016)).toBe(1)
  })

  it('一格滚轮（fly 下滚拉远 12%）逐帧收敛：首帧立即生效、终点精确、尾部不拖尾', () => {
    const s = createZoomSmoother()
    const target = flyWheelFactor(100)   // deltaY=100（下滚）→ 拉远 → 比例 >1
    s.push(target)
    expect(s.active()).toBe(true)
    // 首帧（16ms）就该走掉约 16% 预算：不引入输入延迟
    let cumulative = 1
    const first = s.advance(0.016)
    cumulative *= first
    const walkedFrac = (Math.log(cumulative) - 0) / Math.log(target)
    expect(walkedFrac).toBeGreaterThan(0.1)                    // 首帧已走过 >10% 预算
    expect(first).toBeGreaterThan(1)                           // 方向 = 拉远
    // 连续推进：单调逼近终点，最后一帧整段收掉且终点精确
    let frames = 0
    while (s.active() && frames < 200) {
      cumulative *= s.advance(0.016)
      frames++
    }
    expect(s.active()).toBe(false)
    expect(s.advance(0.016)).toBe(1)
    expect(Math.abs(Math.log(cumulative) - Math.log(target))).toBeLessThan(1e-9)
    expect(frames).toBeLessThan(60)     // 0.09s tau：0.4% 残差内收敛 ≈ 0.5s ≈ 32 帧
  })

  it('帧率无关：同一墙钟时间下 60fps 与 15fps 的收敛终点一致', () => {
    const run = (dt: number, seconds: number) => {
      const s = createZoomSmoother()
      s.push(flyWheelFactor(-100))   // 上滚 = 推近 12%
      let log = 0
      const steps = Math.round(seconds / dt)
      for (let i = 0; i < steps; i++) log += Math.log(s.advance(dt))
      return { log, settled: !s.active() }
    }
    const fast = run(1 / 60, 0.4)
    const slow = run(1 / 15, 0.4)
    expect(fast.settled).toBe(true)
    expect(slow.settled).toBe(true)
    // 都已收敛到剩余 0（<0.4% 残差整段收掉）：两条帧率路径终点一致
    expect(Math.abs(fast.log - Math.log(flyWheelFactor(-100)))).toBeLessThan(1e-9)
    expect(Math.abs(slow.log - Math.log(flyWheelFactor(-100)))).toBeLessThan(1e-9)
  })

  it('连乘预算：连滚 3 格 = 3 格比例的乘积，与旧实现逐格乘视距逐值相等', () => {
    const s = createZoomSmoother()
    for (let i = 0; i < 3; i++) s.push(flyWheelFactor(100))
    let log = 0
    while (s.active()) log += Math.log(s.advance(0.016))
    expect(Math.abs(log - 3 * Math.log(flyWheelFactor(100)))).toBeLessThan(1e-9)
  })

  it('钳制吸收：scene 没有施加本帧比例时预算照样按计划耗尽（不漂移）', () => {
    // advance 的返回值只是「本帧应施加的比例」；scene 被视距钳制挡下时调用方
    // 不重放该帧——预算仍按同一时间表收敛，实际效果由钳制决定（与即时缩放一致）。
    const s = createZoomSmoother()
    s.push(flyWheelFactor(-100))
    for (let i = 0; i < 40; i++) s.advance(0.016)   // 假装全部被钳掉（返回值弃用）
    expect(s.active()).toBe(false)
  })

  it('reset 清空预算：模式切换/换图后旧目标不再生效', () => {
    const s = createZoomSmoother()
    s.push(orbitWheelFactor(-100))
    expect(s.active()).toBe(true)
    s.reset()
    expect(s.active()).toBe(false)
    expect(s.advance(0.016)).toBe(1)
  })

  it('fail-closed：非有限/非正比例按无缩放处理，预算不为 NaN', () => {
    const s = createZoomSmoother()
    s.push(Number.NaN)
    s.push(0)
    s.push(-2)
    s.push(Number.POSITIVE_INFINITY)
    expect(s.active()).toBe(false)
    expect(s.advance(0.016)).toBe(1)
  })

  it('dt 钳制语义：dt=0 不推进；超大 dt 一步收敛（后台 tab 恢复）', () => {
    const s = createZoomSmoother()
    s.push(flyWheelFactor(100))
    expect(s.advance(0)).toBe(1)
    expect(s.active()).toBe(true)
    const f = s.advance(10)
    expect(s.active()).toBe(false)   // dt ≫ tau：预算一步释放完
    expect(Math.abs(Math.log(f) - Math.log(flyWheelFactor(100)))).toBeLessThan(1e-9)
  })
})

describe('滚轮事件公式锚点（与既有实现逐值同构）', () => {
  it('flyWheelFactor：视距比例 = 1 + clamp(deltaY*0.0012, ±0.3)（旧步长公式的比例面）', () => {
    expect(flyWheelFactor(100)).toBeCloseTo(1.12, 12)      // 下滚一格 = 拉远 12%
    expect(flyWheelFactor(-100)).toBeCloseTo(0.88, 12)     // 上滚一格 = 推近 12%
    expect(flyWheelFactor(2500)).toBe(1.3)                 // 单事件拉远上限 +30%
    expect(flyWheelFactor(-2500)).toBe(0.7)                // 单事件推近上限 −30%
    expect(flyWheelFactor(0)).toBe(1)                      // 无位移 = 无缩放
    expect(flyWheelFactor(-5)).toBeCloseTo(1 - 0.006, 12)  // 触控板小位移线性
  })

  it('orbitWheelFactor：与 three OrbitControls._getZoomScale 同构（0.95^|Δ|·0.01）', () => {
    // 一格鼠标滚轮（deltaY=±100）= 5%：与 OrbitControls 直收滚轮的单事件幅度一致
    expect(orbitWheelFactor(100)).toBeCloseTo(1 / 0.95, 12)
    expect(orbitWheelFactor(-100)).toBeCloseTo(0.95, 12)
    // zoomSpeed 透传（scene 不再让 OrbitControls 直收滚轮，档位语义保留）
    expect(orbitWheelFactor(-100, 2)).toBeCloseTo(Math.pow(0.95, 2), 12)
    expect(orbitWheelFactor(0)).toBe(1)
    expect(orbitWheelFactor(Number.NaN)).toBe(1)
  })

  it('往返对称：fly 为加法对称（既有实现语义），orbit 为乘法互逆', () => {
    // fly：一格的绝对比例偏移对称（|f(下)−1| == |f(上)−1|），1.12×0.88 = 0.9856 ≠ 1
    // ——这是旧 additive 公式的原语义；逐格乘当前视距后连滚终点与旧实现逐值相等。
    expect(Math.abs(flyWheelFactor(100) - 1)).toBeCloseTo(1 - flyWheelFactor(-100), 12)
    // orbit：与 OrbitControls dollyIn/dollyOut 同构，log 坐标严格互逆（精确往返抵消）
    expect(Math.log(orbitWheelFactor(100)) + Math.log(orbitWheelFactor(-100))).toBeCloseTo(0, 12)
  })
})

describe('createFlyZoomSmoother 可加位移预算（fly 旧语义）', () => {
  /** 把预算按固定 dt 逐帧耗干，返回各帧位移之和（= 终点总位移，无钳制时）。 */
  function drain(smoother: ReturnType<typeof createFlyZoomSmoother>, dt: number, maxFrames: number): number {
    let total = 0
    for (let i = 0; i < maxFrames && smoother.active(); i++) total += smoother.advance(dt)
    expect(smoother.active()).toBe(false)   // maxFrames 内必须收敛
    return total
  }

  it('总量守恒：各帧位移之和恒等于 push 总量（平滑只改时间分布）', () => {
    const s = createFlyZoomSmoother()
    s.pushDisplacement(-3.6)
    expect(drain(s, 0.1, 17)).toBeCloseTo(-3.6, 9)
  })

  it('同帧相反输入精确抵消：+100/-100 往返净位移为 0', () => {
    const s = createFlyZoomSmoother()
    s.pushDisplacement(3.6)
    s.pushDisplacement(-3.6)
    expect(s.active()).toBe(false)
    expect(s.advance(0.1)).toBe(0)
  })

  it('连续同向累加：3 × +100 的总位移 = 3 × 单次（视距不变的旧语义）', () => {
    const s = createFlyZoomSmoother()
    s.pushDisplacement(3.6); s.pushDisplacement(3.6); s.pushDisplacement(3.6)
    expect(drain(s, 1 / 60, 120)).toBeCloseTo(10.8, 9)
  })

  it('帧率无关：同一预算在 10/30/60 FPS 下收敛终点一致', () => {
    for (const [dt, frames] of [[0.1, 17], [1 / 30, 60], [1 / 60, 120]] as const) {
      const s = createFlyZoomSmoother()
      s.pushDisplacement(-10.8)
      expect(drain(s, dt, frames)).toBeCloseTo(-10.8, 9)
    }
  })

  it('尾段不拖尾：残差 ≤ FLY_SETTLE_EPS 时整段付清', () => {
    const s = createFlyZoomSmoother()
    s.pushDisplacement(0.008)
    expect(s.advance(0)).toBeCloseTo(0.008, 12)   // dt=0 也不拖尾（残差已小于阈值）
  })

  it('fail-closed：非有限位移不进预算', () => {
    const s = createFlyZoomSmoother()
    s.pushDisplacement(Number.NaN)
    s.pushDisplacement(Number.POSITIVE_INFINITY)
    expect(s.active()).toBe(false)
  })

  it('reset 清空预算', () => {
    const s = createFlyZoomSmoother()
    s.pushDisplacement(3.6)
    s.reset()
    expect(s.active()).toBe(false)
    expect(s.advance(0.1)).toBe(0)
  })
})

describe('常数契约', () => {
  it('tau/eps 在合理手感窗内（0.05–0.2s / ≤1% 残差）', () => {
    expect(ZOOM_SMOOTH_TAU_SEC).toBeGreaterThanOrEqual(0.05)
    expect(ZOOM_SMOOTH_TAU_SEC).toBeLessThanOrEqual(0.2)
    expect(ZOOM_SETTLE_LOG_EPS).toBeLessThan(Math.log(1.01))
  })
})
