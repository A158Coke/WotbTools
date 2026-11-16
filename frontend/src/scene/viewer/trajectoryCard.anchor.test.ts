// @vitest-environment happy-dom
// 结果卡命中点跟随（行为测试）：渲染循环每帧调用 updateTrajInfoPos()，相机旋转后同一世界
// 命中点的投影改变 → 卡片位置随之改变；命中点转到相机后方时隐藏。2026-11-16 用户裁示：
// 射击结果卡保持在命中位置附近（旋转视角时），不是固定屏幕坐标或顶部停靠。
import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createTrajectoryCard } from './trajectoryCard.js'

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, right: left + width, bottom: top + height, width, height, x: left, y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 1000)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  return camera
}

function mount() {
  document.body.innerHTML = `
    <div id="canvas-container"><div id="traj-info"></div></div>
    <div id="corner-tl"></div><div id="corner-tr"></div>
    <div id="turret-controls"></div><div class="armor-back"></div>
    <div class="armor-shot-view-switch"></div>`
  const host = document.getElementById('canvas-container') as HTMLElement
  host.getBoundingClientRect = () => rect(0, 0, 800, 600)
  const card = document.getElementById('traj-info') as HTMLElement
  Object.defineProperty(card, 'offsetWidth', { configurable: true, value: 180 })
  Object.defineProperty(card, 'offsetHeight', { configurable: true, value: 90 })
  card.style.display = 'none'
  return { card }
}

describe('traj-info 命中点跟随', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('相机旋转后卡片位置改变（每帧重投影世界命中点，不依赖 dirty）', () => {
    const { card } = mount()
    const camera = makeCamera()
    const tc = createTrajectoryCard({
      isDestroyed: () => false,
      clearShotError: () => {},
      clearHeBlast: () => {},
      getFxScene: () => new THREE.Scene(),
      getCamera: () => camera,
      L: {} as never,
      armorDebug: () => false,
    })
    tc.setTrajInfoPos(new THREE.Vector3(2, 0, 0))
    tc.updateTrajInfoPos()
    expect(card.style.display).toBe('block')
    const first = { left: card.style.left, top: card.style.top }
    expect(first.left).toMatch(/px$/)

    // 相机绕到 +X 轴（仍看向原点）：同一世界命中点的投影移动，卡片必须跟着走。
    camera.position.set(10, 0, 0)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    tc.updateTrajInfoPos()
    expect({ left: card.style.left, top: card.style.top }).not.toEqual(first)
  })

  it('命中点在相机后方时隐藏，回到正面后重新显示', () => {
    const { card } = mount()
    const camera = makeCamera()
    const tc = createTrajectoryCard({
      isDestroyed: () => false,
      clearShotError: () => {},
      clearHeBlast: () => {},
      getFxScene: () => new THREE.Scene(),
      getCamera: () => camera,
      L: {} as never,
      armorDebug: () => false,
    })
    tc.setTrajInfoPos(new THREE.Vector3(0, 0, 20))
    tc.updateTrajInfoPos()
    expect(card.style.display).toBe('none')

    tc.setTrajInfoPos(new THREE.Vector3(0, 0, 0))
    tc.updateTrajInfoPos()
    expect(card.style.display).toBe('block')
  })

  it('避让单发分析页右下视角切换（.armor-shot-view-switch），不与 HUD 相交', () => {
    const { card } = mount()
    const camera = makeCamera()
    const viewSwitch = document.querySelector('.armor-shot-view-switch') as HTMLElement
    // 覆盖命中点附近的首选位（右下偏移），强制 chooser 选别处。
    viewSwitch.getBoundingClientRect = () => rect(300, 200, 500, 400)
    const tc = createTrajectoryCard({
      isDestroyed: () => false,
      clearShotError: () => {},
      clearHeBlast: () => {},
      getFxScene: () => new THREE.Scene(),
      getCamera: () => camera,
      L: {} as never,
      armorDebug: () => false,
    })
    tc.setTrajInfoPos(new THREE.Vector3(0, 0, 0))
    tc.updateTrajInfoPos()
    const box = {
      left: parseFloat(card.style.left),
      top: parseFloat(card.style.top),
      right: parseFloat(card.style.left) + 180,
      bottom: parseFloat(card.style.top) + 90,
    }
    const overlap = box.right > 300 && box.left < 800 && box.bottom > 200 && box.top < 600
    expect(overlap).toBe(false)
  })

  it('面板在定位后展开（dirty 重排）：强制重新落位，不留在面板覆盖区', () => {
    const { card } = mount()
    const panel = document.getElementById('corner-tl') as HTMLElement
    panel.getBoundingClientRect = () => rect(0, 0, 0, 0)
    const camera = makeCamera()
    const tc = createTrajectoryCard({
      isDestroyed: () => false,
      clearShotError: () => {},
      clearHeBlast: () => {},
      getFxScene: () => new THREE.Scene(),
      getCamera: () => camera,
      L: {} as never,
      armorDebug: () => false,
    })
    tc.setTrajInfoPos(new THREE.Vector3(0, 0, 0))
    tc.updateTrajInfoPos()
    expect(card.style.display).toBe('block')
    // 模拟 HUD 面板展开覆盖原来的卡片区域（browser-armor-aiming 的门禁夹具同样会外部
    // 写入卡片位置，再断言产品在 dirty 后把它移出）。
    panel.getBoundingClientRect = () => rect(0, 0, 600, 600)
    tc.markTrajInfoDirty()
    tc.updateTrajInfoPos()
    const left = parseFloat(card.style.left)
    const top = parseFloat(card.style.top)
    const overlapsPanel = left + 180 > 0.5 && left < 599.5 && top + 90 > 0.5 && top < 599.5
    expect(overlapsPanel).toBe(false)
  })
})
