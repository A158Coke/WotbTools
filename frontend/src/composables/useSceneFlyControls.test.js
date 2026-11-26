// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { FLY_SPEEDS, isFlySpeedIndex, advanceFly, classifyTwoFinger, groundPanOffset, freeVerticalDistancePose, isTextEntryTarget, useSceneFlyControls } from './useSceneFlyControls.ts'

function makeRig(pressedKeys, { cam = [0, 20, 30], target = [0, 0, 0] } = {}) {
  const pressed = new Set(pressedKeys)
  const camera = { position: { x: cam[0], y: cam[1], z: cam[2] } }
  const controls = { target: { x: target[0], y: target[1], z: target[2] } }
  function tick(dt, fallbackYaw = null) {
    return advanceFly(pressed, dt, camera, controls, FLY_SPEEDS[0], fallbackYaw)
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

describe('groundPanOffset 贴地平移几何', () => {
  it('直下射线落在相机正下方', () => {
    expect(groundPanOffset({ x: 0, y: -1, z: 0 }, 50)).toEqual({ x: 0, z: 0 })
  })

  it('斜视射线落到平面上的真实交点', () => {
    const n = Math.SQRT1_2
    const o = groundPanOffset({ x: n, y: -n, z: 0 }, 50)
    expect(o.x).toBeCloseTo(50, 8)
    expect(o.z).toBeCloseTo(0, 8)
  })

  it('掠射和地平线以上的射线不飞到天边，方向保留', () => {
    for (const dir of [{ x: 1, y: -0.001, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0.5, z: 0 }]) {
      const o = groundPanOffset(dir, 100)
      expect(o.x).toBeGreaterThan(0)
      expect(o.x).toBeLessThanOrEqual(100 / 0.14 + 1e-6)
    }
  })

  it('零向量返回零偏移而不是 NaN', () => {
    expect(groundPanOffset({ x: 0, y: 0, z: 0 }, 100)).toEqual({ x: 0, z: 0 })
  })
})

describe('classifyTwoFinger 判定', () => {
  const p = (x, y) => ({ x, y })
  const a0 = p(100, 300), b0 = p(300, 300)

  it('走得不够远时继续等', () => {
    expect(classifyTwoFinger(a0, b0, p(103, 300), p(308, 300))).toBeNull()
  })

  it('两指同向 = 转视角，方向不限', () => {
    expect(classifyTwoFinger(a0, b0, p(100, 320), p(300, 318))).toBe('look')
    expect(classifyTwoFinger(a0, b0, p(120, 300), p(322, 300))).toBe('look')
  })

  it('并拢起步：两指一起走是转视角，分开是缩放', () => {
    const c0 = p(200, 300), d0 = p(230, 300)
    expect(classifyTwoFinger(c0, d0, p(200, 330), p(230, 330))).toBe('look')
    expect(classifyTwoFinger(c0, d0, p(170, 300), p(260, 300))).toBe('pinch')
  })

  it('两指反向 = 缩放', () => {
    expect(classifyTwoFinger(a0, b0, p(120, 300), p(280, 300))).toBe('pinch')
  })

  it('一指不动（含抖动）= 缩放，不算一起拖', () => {
    expect(classifyTwoFinger(a0, b0, p(100, 300), p(340, 300))).toBe('pinch')
    expect(classifyTwoFinger(a0, b0, p(103, 301), p(340, 300))).toBe('pinch')
  })
})

describe('fly 键盘守卫只让出文本输入', () => {
  it('按钮 / 链接 / 滑杆不拦截；文本类输入拦截', () => {
    expect(isTextEntryTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isTextEntryTarget({ tagName: 'A' })).toBe(false)
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'range' })).toBe(false)
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'text' })).toBe(true)
    expect(isTextEntryTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isTextEntryTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTextEntryTarget({ tagName: 'SELECT' })).toBe(true)
    expect(isTextEntryTarget({ isContentEditable: true })).toBe(true)
    expect(isTextEntryTarget(null)).toBe(false)
  })
})

describe('tickFly 位移语义', () => {
  it('W = 沿观察方向水平前进；target 重钉固定视距（旋转中心 = 相机自身）', () => {
    const rig = makeRig(['KeyW'], { cam: [0, 20, 30], target: [0, 0, 0] })
    expect(rig.tick(2)).toBe(true)
    expect(rig.camera.position.x).toBeCloseTo(0)
    expect(rig.camera.position.z).toBeCloseTo(26)
    expect(rig.controls.target.z).toBeCloseTo(-4)
    expect(rig.controls.target.x).toBeCloseTo(0)
  })

  it('水平投影：俯冲视角下 W 不改变高度、水平速度恒定', () => {
    const rig = makeRig(['KeyW'], { cam: [0, 100, 10], target: [0, 0, 0] })
    const y0 = rig.camera.position.y
    rig.tick(1)
    expect(rig.camera.position.y).toBe(y0)
    const horiz = Math.hypot(rig.camera.position.x, rig.camera.position.z - 10)
    expect(horiz).toBeCloseTo(2)
  })

  it('正俯视没有水平投影时，Free 朝向 yaw 仍让 WASD 可用且不改变相机高度', () => {
    const rig = makeRig(['KeyW'], { cam: [0, 300, 0], target: [0, 0, 0] })
    expect(rig.tick(1, 0)).toBe(true)
    expect(rig.camera.position.z).toBeCloseTo(-2)
    expect(rig.camera.position.y).toBe(300)
  })

  it('A/D = 朝向的左右；朝 -z 看，A 向 -x（左）', () => {
    const rig = makeRig(['KeyA'], { cam: [0, 20, 30], target: [0, 0, 0] })
    rig.tick(1)
    expect(rig.camera.position.x).toBeCloseTo(-2)
    expect(rig.camera.position.z).toBeCloseTo(30)
  })

  it('Q 升 E 降（世界系，与朝向无关；高度由场景约束负责）', () => {
    const up = makeRig(['KeyQ'], { cam: [10, 20, 10], target: [-40, 0, 10] })
    up.tick(1)
    expect(up.camera.position.y).toBeCloseTo(22)
    expect(up.controls.target.y).toBeCloseTo(2)
    const down = makeRig(['KeyE'])
    down.tick(1)
    expect(down.camera.position.y).toBeCloseTo(18)
    const overview = makeRig(['KeyQ', 'KeyW'], { cam: [0, 300, 0.01], target: [0, 0, 0] })
    expect(overview.tick(1)).toBe(true)
    expect(overview.camera.position.y).toBe(302)
    expect(overview.camera.position.z).not.toBeCloseTo(0.01)
  })

  it('斜向移动归一（W+A 同距，不超速）；dt=0 / 无按键 = 零位移', () => {
    const diag = makeRig(['KeyW', 'KeyA'], { cam: [0, 20, 30], target: [0, 0, 0] })
    diag.tick(1)
    const dx = diag.camera.position.x, dz = diag.camera.position.z - 30
    expect(Math.hypot(dx, dz)).toBeCloseTo(2)
    const still = makeRig([])
    expect(still.tick(1)).toBe(false)
    const zeroDt = makeRig(['KeyW'])
    expect(zeroDt.tick(0)).toBe(false)
  })
})

describe('飞行循环的生命周期（评审 P2）', () => {
  it('面板失活：下一帧即停推进并清空按键，重新激活不会自己继续飞', async () => {
    let active = true
    const calls = []
    const api = {
      flyTick: (_dt, pressed) => { calls.push(pressed.size); return true },
      invalidate: () => {},
    }
    const Comp = defineComponent({
      setup() {
        useSceneFlyControls({
          setFlySpeed: () => {},
          isActive: () => active,
          canFly: () => true,
          getSceneApi: () => api,
        })
        return () => h('div')
      },
    })
    const wrapper = mount(Comp)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0), { timeout: 1000 })
    active = false
    await new Promise((r) => setTimeout(r, 80))
    const stopped = calls.length
    await new Promise((r) => setTimeout(r, 120))
    expect(calls.length).toBe(stopped)
    active = true
    await new Promise((r) => setTimeout(r, 120))
    expect(calls.length).toBe(stopped)
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }))
    wrapper.unmount()
  })
})

describe('WASD 交互收口（评审 P2）', () => {
  function mountFly(settleCamera) {
    const api = { flyTick: () => false, invalidate: () => {}, settleCamera }
    const Comp = defineComponent({
      setup() {
        useSceneFlyControls({
          setFlySpeed: () => {},
          isActive: () => true,
          canFly: () => true,
          getSceneApi: () => api,
        })
        return () => h('div')
      },
    })
    return mount(Comp)
  }

  it('还有其它飞行键按住时不收口；最后一个键松开收口一次', () => {
    const settleCamera = vi.fn()
    const wrapper = mountFly(settleCamera)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }))
    expect(settleCamera).not.toHaveBeenCalled()
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA' }))
    expect(settleCamera).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA' }))
    expect(settleCamera).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('按住飞行键时窗口失焦：清键后收口一次', () => {
    const settleCamera = vi.fn()
    const wrapper = mountFly(settleCamera)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))
    window.dispatchEvent(new Event('blur'))
    expect(settleCamera).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('blur'))
    expect(settleCamera).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})

describe('freeVerticalDistancePose 竖向距离位姿（滑条 Free 模式）', () => {
  const base = { terrainY: 0, clearanceMin: 0.5, heightMax: 100 }

  it('斜视降低相机：camera 与 target 加同一高度差，yaw/pitch 不变', () => {
    const pose = freeVerticalDistancePose({ ...base, camY: 100, targetY: 0, v: 1 })
    expect(pose.camY).toBe(0.5)
    expect(pose.targetY).toBe(0 - (100 - 0.5))
  })

  it('升高相机：target 同步上移，方向保持', () => {
    const pose = freeVerticalDistancePose({ ...base, camY: 20, targetY: 5, v: 0 })
    expect(pose.camY).toBe(100)
    expect(pose.targetY).toBe(5 + 80)
  })

  it('撞到贴地下限：相机停在 terrain+clearance，target 只跟随实际生效差值', () => {
    const pose = freeVerticalDistancePose({ ...base, camY: 30, targetY: 10, v: 1 })
    expect(pose.camY).toBe(0.5)
    expect(pose.targetY).toBe(10 - (30 - 0.5))
  })

  it('地形不为 0 时上下限整体随 terrainY 平移', () => {
    const pose = freeVerticalDistancePose({ ...base, terrainY: 10, camY: 200, targetY: 20, v: 1 })
    expect(pose.camY).toBe(10.5)
    expect(pose.targetY).toBe(20 - (200 - 10.5))
  })
})
