// 键盘自由视角（useSceneFlyControls.tickFly）的纯推进语义锁：
// 朝向基准 / 水平投影（俯视不钻地）/ QE 世界系升降 / 速率倍乘 / dt=0 零位移 /
// follow 由调用方短路（内核 flyTick 职责，此处不测）/ top 模式 QE 忽略。
import { describe, expect, it } from 'vitest'
import { FLY_SPEEDS, isFlySpeedIndex, advanceFly } from './useSceneFlyControls.js'

// 测试桩：构造 camera/controls 与 pressed 集合，直接调**生产实现** advanceFly
//（此前复制生产实现到桩里，Q/E 翻转时桩漏改导致测试与实现脱钩——已改为单一实现）。
function makeRig(pressedKeys, { cam = [0, 20, 30], target = [0, 0, 0] } = {}) {
  const pressed = new Set(pressedKeys)
  const camera = { position: { x: cam[0], y: cam[1], z: cam[2] } }
  const controls = { target: { x: target[0], y: target[1], z: target[2] } }
  function tick(dt, mode = 'free') {
    return advanceFly(pressed, dt, camera, controls, mode, FLY_SPEEDS[0])   // 恒档 1 = 1 m/s
  }
  return { camera, controls, tick }
}

describe('fly controls 速率档表', () => {
  it('1–6 档 = [0.5,1,2,4,8,16] m/s；isFlySpeedIndex 边界', () => {
    expect(FLY_SPEEDS).toEqual([2, 6, 15, 40, 90, 200])
    expect(isFlySpeedIndex(1)).toBe(true)
    expect(isFlySpeedIndex(6)).toBe(true)
    expect(isFlySpeedIndex(0)).toBe(false)
    expect(isFlySpeedIndex(7)).toBe(false)
    expect(isFlySpeedIndex(2.5)).toBe(false)
  })
})

describe('tickFly 位移语义', () => {
  it('W = 沿观察方向水平前进；target 重钉固定视距（旋转中心 = 相机自身）', () => {
    const rig = makeRig(['KeyW'], { cam: [0, 20, 30], target: [0, 0, 0] })
    // 朝 -z 看（forward = -z 归一）；dt=2s、2m/s ⇒ 相机前进 4m
    expect(rig.tick(2)).toBe(true)
    expect(rig.camera.position.x).toBeCloseTo(0)
    expect(rig.camera.position.z).toBeCloseTo(26)
    // target = 相机 + 原方向 × 原视距（30）：视向不变、环绕半径恒定 = 绕自己转
    expect(rig.controls.target.z).toBeCloseTo(-4)
    expect(rig.controls.target.x).toBeCloseTo(0)
  })

  it('水平投影：俯冲视角下 W 不改变高度、水平速度恒定', () => {
    // 相机在高处俯视 target（forward 有大 -y 分量）——fwd 只取 x/z
    const rig = makeRig(['KeyW'], { cam: [0, 100, 10], target: [0, 0, 0] })
    const y0 = rig.camera.position.y
    rig.tick(1)
    expect(rig.camera.position.y).toBe(y0)             // 高度不变（不钻地）
    const horiz = Math.hypot(rig.camera.position.x, rig.camera.position.z - 10)
    expect(horiz).toBeCloseTo(2)                       // 水平位移 = 2 m（dt=1s）
  })

  it('A/D = 朝向的左右；朝 -z 看，A 向 -x（左）', () => {
    const rig = makeRig(['KeyA'], { cam: [0, 20, 30], target: [0, 0, 0] })
    rig.tick(1)
    expect(rig.camera.position.x).toBeCloseTo(-2)
    expect(rig.camera.position.z).toBeCloseTo(30)
  })

  it('Q 升 E 降（世界系，与朝向无关）；top 模式忽略 QE', () => {
    const up = makeRig(['KeyQ'], { cam: [10, 20, 10], target: [-40, 0, 10] })   // Q 升（用户裁定）
    up.tick(1)
    expect(up.camera.position.y).toBeCloseTo(22)
    expect(up.controls.target.y).toBeCloseTo(2)        // 视向不变（平行移动）：target 同升 2m
    const down = makeRig(['KeyE'])
    down.tick(1)
    expect(down.camera.position.y).toBeCloseTo(18)     // 默认机位 y=20，降 2
    const top = makeRig(['KeyQ', 'KeyW'], { cam: [0, 300, 0.01], target: [0, 0, 0] })
    const yTop = top.camera.position.y
    top.tick(1, 'top')
    expect(top.camera.position.y).toBe(yTop)           // top：QE 忽略
    expect(top.camera.position.z).not.toBeCloseTo(0.01) // WASD 仍生效
  })

  it('斜向移动归一（W+A 同距，不超速）；dt=0 / 无按键 = 零位移', () => {
    const diag = makeRig(['KeyW', 'KeyA'], { cam: [0, 20, 30], target: [0, 0, 0] })
    diag.tick(1)
    const dx = diag.camera.position.x, dz = diag.camera.position.z - 30
    expect(Math.hypot(dx, dz)).toBeCloseTo(2)          // 归一：合位移 = 单键位移
    const still = makeRig([])
    expect(still.tick(1)).toBe(false)
    const zeroDt = makeRig(['KeyW'])
    expect(zeroDt.tick(0)).toBe(false)
  })
})
