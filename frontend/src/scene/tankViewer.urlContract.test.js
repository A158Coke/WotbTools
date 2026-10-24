// tankViewer URL 契约基线（2026-10-24，current-plan.md Step B1）：装甲查看器的
// `?shooter=&shell=&shot=&heatmap=1` 参数链最终落到这两个纯导出——dollyZoomFov
// （相机 FOV 标定）与 mirrorShotData（世界镜像一次性变换）。本文件锁**当前数值行为**
// 作为拆分（Step B2+）前的回归基线：解析恒等式 + 单调性 + 夹取边界 + 镜像不变性。
import { describe, expect, it } from 'vitest'
import { dollyZoomFov, mirrorShotData } from './tankViewer.js'

describe('dollyZoomFov（URL 相机契约基线）', () => {
  it('enabled=false 恒原生 FOV（两车 world 总览路径；经 min/max 夹取）', () => {
    expect(dollyZoomFov(30, false, 50)).toBe(50)
    expect(dollyZoomFov(500, false, 50, 30, 1, 80)).toBe(50)
  })

  it('参考距离处 FOV = base（解析恒等式：product = tan(base/2)·refDist）', () => {
    expect(dollyZoomFov(30, true, 50, 30)).toBeCloseTo(50, 9)
    expect(dollyZoomFov(40, true, 60, 40)).toBeCloseTo(60, 9)
  })

  it('enabled 时 FOV 随距离单调收窄（dolly-zoom：车体屏幕尺寸保持 refDist 比例）', () => {
    let prev = Infinity
    for (const d of [10, 20, 30, 45, 60, 120, 300, 600]) {
      const fov = dollyZoomFov(d, true, 50, 30)
      expect(fov).toBeLessThanOrEqual(prev)
      prev = fov
    }
    // 黄金值（回归基线，拆分 B2+ 不得漂移）：2·atan(tan(25°)·30/d)
    expect(dollyZoomFov(60, true, 50, 30)).toBeCloseTo(26.25, 1)
    expect(dollyZoomFov(300, true, 50, 30)).toBeCloseTo(5.34, 1)
  })

  it('farProductGain/productScale：远距车体略小的 Armor Inspector 标定项', () => {
    const plain = dollyZoomFov(300, true, 50, 30)
    const gained = dollyZoomFov(300, true, 50, 30, 1, Infinity, 0.01)
    expect(gained).toBeGreaterThan(plain)                       // product 随距离增大 → FOV 更宽（车更小）
    // farProductMax 触顶：product = min(5, 13.99+270×0.01) = 5 ⇒ fov = 2·atan(5/300)
    const capped = dollyZoomFov(300, true, 50, 30, 1, Infinity, 0.01, 5)
    expect(capped).toBeLessThan(gained)
    expect(capped).toBeCloseTo(1.91, 2)
    // productScale 放大 product（车体屏幕尺寸按 1/scale 缩小）：FOV 随之变宽
    const scaled = dollyZoomFov(300, true, 50, 30, 1, Infinity, 0, Infinity, 2)
    expect(scaled).toBeGreaterThan(plain)
    expect(scaled).toBeLessThan(plain * 2)                      // atan 非线性：放大小于 2×
  })

  it('min/max 夹取：近距封顶 maxFovDeg、远距钳底 minFovDeg', () => {
    expect(dollyZoomFov(5, true, 50, 30, 1, 80)).toBe(80)       // 无夹取时 ≈140°，封到 80
    expect(dollyZoomFov(2000, true, 50, 30, 5)).toBe(5)         // 无夹取时 ≈0.8°，钳到 5
  })
})

describe('mirrorShotData（世界镜像一次性变换契约）', () => {
  const makeShot = () => ({
    ball_a: [1.5, 2, 3], ball_b: [4, 5, 6], launch_velocity: [7, 8, 9],
    via: [[1, 2, 3], [4, 5, 6]],
    shooter_pos: [1, 1, 1], target_pos: [2, 2, 2],
    aim_point: [3, 3, 3], launch_point_rel: [0.5, 0.5, 0.5],
    shooter_ang: [10, 20, 30], target_ang: [-10, 5, -30],       // [yaw, pitch, roll]
    shooter_turret_yaw: 15, target_turret_yaw: -25,
    tick_samples: [{ pos: [1, 2, 3], yaw: 4, pitch: 5, roll: 6 }],
    shooter_tick_samples: [{ pos: [-1, 2, -3], yaw: -4, pitch: 5, roll: -6 }],
    terrain_impact: { impact_point: [1, 2, 3], terminal_dir: [4, 5, 6] },
    shooter_aim: { turret_rel_yaw: 7 },
    target_render: { pos: [1, 2, 3], ang: [8, 9, 10] },
    shooter_render: { pos: [-1, -2, -3], ang: [-8, 9, -10] },
    target_render_timeline: [{ pos: [1, 2, 3], yaw: 4, pitch: 5, roll: 6 }],
    shooter_render_timeline: [{ pos: [2, 3, 4], yaw: -7, pitch: 8, roll: 9 }],
  })

  it('x/yaw/roll 取反、pitch 与 y/z 不变；折线整链同变', () => {
    const s = makeShot()
    mirrorShotData(s)
    expect(s.ball_a[0]).toBe(-1.5); expect(s.ball_a[1]).toBe(2); expect(s.ball_a[2]).toBe(3)
    for (const p of s.via) expect(p[0]).toBeLessThan(0)          // 原值全正 → 镜像后 x 全负
    expect(s.shooter_ang).toEqual([-10, 20, -30])                // yaw/roll 取反、pitch 不变
    expect(s.target_ang).toEqual([10, 5, 30])
    expect(s.shooter_turret_yaw).toBe(-15); expect(s.target_turret_yaw).toBe(25)
    expect(s.tick_samples[0]).toEqual({ pos: [-1, 2, 3], yaw: -4, pitch: 5, roll: -6 })
    expect(s.terrain_impact.impact_point[0]).toBe(-1)
    expect(s.shooter_aim.turret_rel_yaw).toBe(-7)
    expect(s.target_render.pos[0]).toBe(-1); expect(s.target_render.ang).toEqual([-8, 9, -10])
    expect(s.target_render_timeline[0].roll).toBe(-6)
  })

  it('幂等（__worldMirrored 哨兵：数据入口只变换一次）', () => {
    const s = makeShot()
    mirrorShotData(s)
    const frozen = JSON.stringify(s)
    mirrorShotData(s)
    expect(JSON.stringify(s)).toBe(frozen)
  })
})
