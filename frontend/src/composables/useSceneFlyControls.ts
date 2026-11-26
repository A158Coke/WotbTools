import { onBeforeUnmount, onMounted } from 'vue'
import type { Vector3 } from 'three'

interface TextEntryTarget {
  isContentEditable?: boolean
  tagName?: string
  type?: string
}

export interface FlyCamera {
  position: Vector3
}

export interface FlyControls {
  target: Vector3
  __flyDist?: number
}

export interface SceneFlyControlsAdapter {
  setFlySpeed: (n: number) => void
  isActive?: () => boolean
  canFly?: () => boolean
  getSceneApi?: () => { flyTick?: (dt: number, pressed: Set<string>) => boolean; invalidate?: () => void; settleCamera?: () => void } | null
}


export function isTextEntryTarget(target: TextEntryTarget | null | undefined): boolean {
  if (!target) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (target.type || 'text').toLowerCase()
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(type)
  }
  return false
}

export const FLY_SPEEDS = Object.freeze([2, 6, 15, 40, 90, 200])
export const DEFAULT_FLY_SPEED_INDEX = 3

export function isFlySpeedIndex(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= FLY_SPEEDS.length
}

const FLY_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'])

export const TOUCH_PAN_MIN_HEIGHT = 5
const TOUCH_PAN_MIN_GRAZE_TAN = 0.14
const TWO_FINGER_DECIDE_PX = 12
const TWO_FINGER_SAME_DIR_RATIO = 0.4

export function groundPanOffset(dir: { x: number; y: number; z: number }, height: number): { x: number; z: number } {
  const horiz = Math.hypot(dir.x, dir.z)
  const down = Math.max(-dir.y, horiz * TOUCH_PAN_MIN_GRAZE_TAN)
  if (!(down > 0)) return { x: 0, z: 0 }
  return { x: dir.x * height / down, z: dir.z * height / down }
}

export function freeVerticalDistancePose(
  { camY, targetY, terrainY, clearanceMin, heightMax, v }: {
    camY: number; targetY: number; terrainY: number; clearanceMin: number; heightMax: number; v: number
  },
): { camY: number; targetY: number } {
  const cMax = Math.max(clearanceMin + 1e-3, heightMax - terrainY)
  const wanted = cMax - v * (cMax - clearanceMin)
  const clampedY = Math.min(heightMax, Math.max(terrainY + clearanceMin, camY + (wanted - (camY - terrainY))))
  const deltaY = clampedY - camY
  return { camY: clampedY, targetY: targetY + deltaY }
}

export function classifyTwoFinger(
  a0: { x: number; y: number },
  b0: { x: number; y: number },
  a1: { x: number; y: number },
  b1: { x: number; y: number },
): 'look' | 'pinch' | null {
  const ax = a1.x - a0.x, ay = a1.y - a0.y
  const bx = b1.x - b0.x, by = b1.y - b0.y
  const ta = Math.hypot(ax, ay), tb = Math.hypot(bx, by)
  const fast = Math.max(ta, tb), slow = Math.min(ta, tb)
  if (fast < TWO_FINGER_DECIDE_PX) return null
  return ax * bx + ay * by > 0 && slow >= fast * TWO_FINGER_SAME_DIR_RATIO ? 'look' : 'pinch'
}

/**
 * 纯推进一帧相机位移（模块级导出——playbackScene.flyTick 与工厂 tickFly 共用实现）。
 * pressed：按下的 code 集合；speed：米/秒（档表 FLY_SPEEDS[n-1]）。
 * 以相机朝向为基准：W/S 沿 target 方向的**水平分量**前进/后退（俯仰不改变水平速度，
 * 防俯视时 W 钻地）；A/D 沿朝向的水平左/右；Q 升 / E 降（用户实测裁定，世界系垂直）。
 * **自由飞行的旋转中心 = 相机自身**（FPS 语义，用户裁定）：平移只推相机，位移后把
 * target 重钉到相机前方固定视距（首飞行帧冻结，缩放改距离后下轮飞行重新冻结）——
 * 环绕半径恒定，旋转永远绕着自己；地形与高度边界由场景约束统一处理。
 * @returns {boolean} 是否发生位移（并入 cameraMoved 按需渲染判定）
 */
export function advanceFly(pressed: Set<string> | null | undefined, dt: number, camera: FlyCamera | null | undefined, controls: FlyControls | null | undefined, speed = 1, fallbackYaw: number | null = null): boolean {
  if (!pressed || !pressed.size || !camera || !controls || !(dt > 0)) return false
  const tx0 = controls.target.x - camera.position.x
  const ty0 = controls.target.y - camera.position.y
  const tz0 = controls.target.z - camera.position.z
  const dist = controls.__flyDist ?? Math.hypot(tx0, ty0, tz0)
  controls.__flyDist = dist
  const step = speed * dt
  const fwd = { x: controls.target.x - camera.position.x, z: controls.target.z - camera.position.z }
  const fwdLen = Math.hypot(fwd.x, fwd.z)
  let ux = 0, uz = 0
  if (fwdLen > 1e-6) { ux = fwd.x / fwdLen; uz = fwd.z / fwdLen }
  else if (fallbackYaw != null && Number.isFinite(fallbackYaw)) { ux = -Math.sin(fallbackYaw); uz = -Math.cos(fallbackYaw) }
  const lx = uz, lz = -ux
  const moveW = pressed.has('KeyW') ? 1 : 0
  const moveS = pressed.has('KeyS') ? 1 : 0
  const moveA = pressed.has('KeyA') ? 1 : 0
  const moveD = pressed.has('KeyD') ? 1 : 0
  let dx = (moveW - moveS) * ux + (moveA - moveD) * lx
  let dz = (moveW - moveS) * uz + (moveA - moveD) * lz
  const len = Math.hypot(dx, dz)
  if (len > 1e-6) { dx /= len; dz /= len } else { dx = 0; dz = 0 }
  let moved = false
  if (dx !== 0 || dz !== 0) {
    camera.position.x += dx * step
    camera.position.z += dz * step
    moved = true
  }
  const dy = (pressed.has('KeyQ') ? 1 : 0) - (pressed.has('KeyE') ? 1 : 0)
  if (dy !== 0) {
    camera.position.y += dy * step
    moved = true
  }
  if (moved) {
    const n = Math.hypot(tx0, ty0, tz0) || 1
    controls.target.x = camera.position.x + (tx0 / n) * dist
    controls.target.y = camera.position.y + (ty0 / n) * dist
    controls.target.z = camera.position.z + (tz0 / n) * dist
  }
  return moved
}

/**
 * @param {object} adapter
 * @param {(n: number) => void} adapter.setFlySpeed  1–6 档位写入场景（透传给内核）
 * @param {() => boolean} [adapter.isActive]  播放器当前是否可见/可交互（缺省可交互）
 * @param {() => boolean} [adapter.canFly]    当前是否允许飞行（如 DATA 就绪、非触屏）
 */
export function useSceneFlyControls(adapter: SceneFlyControlsAdapter) {
  const pressed = new Set<string>()
  let speedIndex = DEFAULT_FLY_SPEED_INDEX

  function flySpeed() { return FLY_SPEEDS[speedIndex - 1] }

  function handleKeydown(event: KeyboardEvent): void {
    if (adapter.isActive && !adapter.isActive()) return
    if (adapter.canFly && !adapter.canFly()) return
    if (isTextEntryTarget(event.target as TextEntryTarget | null)) return
    if (event.code === 'Space' || event.key === ' ') return
    if (/^Digit[1-6]$/.test(event.code)) {
      event.preventDefault()
      const n = Number(event.code.slice(5))
      speedIndex = n
      adapter.setFlySpeed(n)
      return
    }
    if (FLY_KEYS.has(event.code)) {
      event.preventDefault()
      pressed.add(event.code)
      startLoop()
    }
  }

  function settleCamera(): void {
    adapter.getSceneApi?.()?.settleCamera?.()
  }

  function handleKeyup(event: KeyboardEvent): void {
    const wasPressed = pressed.delete(event.code)
    if (wasPressed && pressed.size === 0) settleCamera()
  }

  function clearPressed() { pressed.clear() }

  function handleBlur(): void {
    const wasFlying = pressed.size > 0
    clearPressed()
    if (wasFlying) settleCamera()
  }

  /**
   * 推进一帧相机位移（工厂内包装：速率取当前档，按键集合取本实例）。
   * 纯推进实现 = 模块级 {@link advanceFly}（playbackScene.flyTick 经它导入——
   * 保持单一实现；导出缺失会让整条 import 链在加载期失败，3D 面板白屏）。
   * mode: 'free' | 'follow'（follow 由调用方短路——跟随语义是车体锚定）。
   * @returns {boolean} 是否发生位移（并入 cameraMoved 按需渲染判定）
   */
  function tickFly(dt: number, camera: FlyCamera, controls: FlyControls): boolean {
    return advanceFly(pressed, dt, camera, controls, flySpeed())
  }

  let rafId = 0
  let ivId: ReturnType<typeof setInterval> | 0 = 0
  let lastT = 0
  function stepFly() {
    if (adapter.isActive?.() === false || adapter.canFly?.() === false) { stopLoop(); return }
    const now = performance.now()
    const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0
    lastT = now
    const api = adapter.getSceneApi?.()
    if (api?.flyTick) {
      if (api.flyTick(dt, pressed)) api.invalidate?.()
    }
    if (!pressed.size || adapter.canFly?.() === false) {
      if (rafId) cancelAnimationFrame(rafId)
      if (ivId) clearInterval(ivId)
      rafId = 0; ivId = 0; lastT = 0
    }
  }
  function frame(): void {
    rafId = 0
    stepFly()
    if (pressed.size && adapter.canFly?.() !== false) {
      rafId = requestAnimationFrame(frame)
    }
  }
  function startLoop() {
    if (!rafId && !ivId && pressed.size && typeof requestAnimationFrame !== 'undefined') {
      lastT = 0
      rafId = requestAnimationFrame(frame)
      ivId = setInterval(() => {
        if (pressed.size && performance.now() - lastT > 50) stepFly()
      }, 16)
    }
  }
  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId)
    if (ivId) clearInterval(ivId)
    rafId = 0; ivId = 0; lastT = 0
    clearPressed()
  }

  if (typeof window !== 'undefined') {
    onMounted(() => {
      window.addEventListener('keydown', handleKeydown)
      window.addEventListener('keyup', handleKeyup)
      window.addEventListener('blur', handleBlur)
    })
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', handleKeydown)
      window.removeEventListener('keyup', handleKeyup)
      window.removeEventListener('blur', handleBlur)
      stopLoop()
    })
  }

  return { tickFly, flySpeed, flySpeedIndex: () => speedIndex, isTextEntryTarget, startLoop, stopLoop }
}
