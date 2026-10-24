import { onBeforeUnmount, onMounted } from 'vue'

/**
 * 3D 回放的键盘自由视角移动（PC）：WASD 平移、Q 升 E 降、1–6 调速率。
 *
 * 不持有相机：唯一 owner 仍是场景内核（OrbitControls）。本 composable 只做三件事：
 * - keydown/keyup 维护按下键集合（keydown 重复触发不重复登记；窗口失焦即清空，
 *   防"按住 W 切走再回来一直在飞"）；
 * - 1–6 直接调 adapter.setFlySpeed(n)（即时生效，不需要按住）；
 * - 暴露 tickFly(dt, camera, controls, mode)：以相机朝向为基准推进一帧位移，
 *   返回是否发生位移——调用方把它并入按需渲染的 cameraMoved 判定（暂停时也要出帧）。
 *
 * 键位与播放传输（空格 / ←→，usePlaybackTransport）并行不冲突；**只跳过文本输入**
 * （INPUT 文本类 / TEXTAREA / SELECT / contentEditable）——按钮不跳过：模式按钮点击后
 * 仍持有焦点，若按 BUTTON 跳过，用户「点过自由按钮再按 WASD」会全部失效（实测）。
 * 跟随（follow）模式不接管——跟随语义是车体锚定；top（正俯视）下 WASD 生效、QE 忽略。
 */

/** 焦点是否落在**文本输入**目标上（只有这类目标需要让出键盘）。
 *  按钮 / 链接 / 滑杆等不消费 WASD/QE/数字键，继续响应飞行。 */
export function isTextEntryTarget(target) {
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

/** 视角移动速率档（1–6 选择；与播放速度档独立）：米/秒。
 *  用户实测两轮校准：[0.5..16] 与 [1..60] 均反馈"太慢/没反应"——回放地图 ±300m、
 *  初始机位数百米外，日常巡航需要 10m/s 量级才可感；精细贴地仍留低速档。 */
export const FLY_SPEEDS = Object.freeze([2, 6, 15, 40, 90, 200])
export const DEFAULT_FLY_SPEED_INDEX = 3   // 档 3 = 15 m/s（默认即可感的巡航速度）

export function isFlySpeedIndex(n) {
  return Number.isInteger(n) && n >= 1 && n <= FLY_SPEEDS.length
}

const FLY_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'])

/**
 * 纯推进一帧相机位移（模块级导出——playbackScene.flyTick 与工厂 tickFly 共用实现）。
 * pressed：按下的 code 集合；speed：米/秒（档表 FLY_SPEEDS[n-1]）。
 * 以相机朝向为基准：W/S 沿 target 方向的**水平分量**前进/后退（俯仰不改变水平速度，
 * 防俯视时 W 钻地）；A/D 沿朝向的水平左/右；Q 升 / E 降（用户实测裁定，世界系垂直）。
 * **自由飞行的旋转中心 = 相机自身**（FPS 语义，用户裁定）：平移只推相机，位移后把
 * target 重钉到相机前方固定视距（首飞行帧冻结，缩放改距离后下轮飞行重新冻结）——
 * 环绕半径恒定，旋转永远绕着自己。mode 'top' 忽略 QE（正俯视防穿地）。
 * @returns {boolean} 是否发生位移（并入 cameraMoved 按需渲染判定）
 */
export function advanceFly(pressed, dt, camera, controls, mode = 'free', speed = 1) {
  if (!pressed || !pressed.size || !camera || !controls || !(dt > 0)) return false
  // 飞行视距：**移动前**取值冻结（首帧 = 进入飞行时的实际相机→target 距离；缩放
  // 改距离后下一轮飞行首帧重新冻结）。放最前，防「移动后测距」把首帧距离算错。
  const tx0 = controls.target.x - camera.position.x
  const ty0 = controls.target.y - camera.position.y
  const tz0 = controls.target.z - camera.position.z
  const dist = controls.__flyDist ?? Math.hypot(tx0, ty0, tz0)
  controls.__flyDist = dist
  const step = speed * dt
  // 朝向 = target − camera（OrbitControls 的观察方向）
  const fwd = { x: controls.target.x - camera.position.x, z: controls.target.z - camera.position.z }
  const fwdLen = Math.hypot(fwd.x, fwd.z)
  let ux = 0, uz = 0
  if (fwdLen > 1e-6) { ux = fwd.x / fwdLen; uz = fwd.z / fwdLen }
  // 水平左向量 = forward × up（右手系）归一：朝 -z 看时左 = -x ✓，朝 +x 看时左 = +z ✓
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
  // Q 升 / E 降（世界系垂直，与朝向无关）；top（正俯视）忽略（防穿地，正俯视下也无意义）
  if (mode !== 'top') {
    const dy = (pressed.has('KeyQ') ? 1 : 0) - (pressed.has('KeyE') ? 1 : 0)
    if (dy !== 0) {
      camera.position.y += dy * step
      moved = true
    }
  }
  if (moved) {
    // target 重钉到相机前方固定视距（环绕半径恒定 = 绕自己旋转）
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
export function useSceneFlyControls(adapter) {
  const pressed = new Set()
  // 速率档存 composable 内（键 1–6 的唯一写者；场景侧只存展示值）
  let speedIndex = DEFAULT_FLY_SPEED_INDEX

  function flySpeed() { return FLY_SPEEDS[speedIndex - 1] }

  // 文本输入目标不劫持（按钮持有焦点时照常响应——模式按钮点击后焦点不会自动离开）
  function handleKeydown(event) {
    if (adapter.isActive && !adapter.isActive()) return
    if (adapter.canFly && !adapter.canFly()) return
    if (isTextEntryTarget(event.target)) return
    if (event.code === 'Space' || event.key === ' ') return   // 播放传输的键，不碰
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
      startLoop()   // 首键即起循环（幂等；空闲时循环自停）
    }
  }

  function handleKeyup(event) {
    pressed.delete(event.code)
  }

  function clearPressed() { pressed.clear() }

  /**
   * 推进一帧相机位移（工厂内包装：速率取当前档，按键集合取本实例）。
   * 纯推进实现 = 模块级 {@link advanceFly}（playbackScene.flyTick 经它导入——
   * 保持单一实现；导出缺失会让整条 import 链在加载期失败，3D 面板白屏）。
   * mode: 'free' | 'follow' | 'top'（follow 由调用方短路——跟随语义是车体锚定）。
   * @returns {boolean} 是否发生位移（并入 cameraMoved 按需渲染判定）
   */
  function tickFly(dt, camera, controls, mode = 'free') {
    return advanceFly(pressed, dt, camera, controls, mode, flySpeed())
  }

  // ---- 场景飞行循环（组件层自驱；场景内核的 animate 不感知键盘）----
  // rAF 为主、按住键期间 setInterval(16ms) 兜底：后台 tab / 无合成器信号的环境
  // （无头、部分省电模式）rAF 被节流到 1–2Hz，飞行会"按了没反应"；interval 保证
  // 键按住期间推进稳定，rAF 恢复时 interval 帧因 rafId 去重不重复跑。空闲零成本。
  let rafId = 0
  let ivId = 0
  let lastT = 0
  function stepFly() {
    const now = performance.now()
    const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0
    lastT = now
    const api = adapter.getSceneApi?.()
    if (api?.flyTick) {
      // pressed 集合由本实例持有，经参数交给内核 flyTick（相机数学/钳制在内核，
      // 键盘态在 pane——两侧职责以这条参数线切分）。invalidate 缺席（旧内核）
      // 不致命：播放中场景本来每帧都画。
      if (api.flyTick(dt, pressed)) api.invalidate?.()
    }
    if (!pressed.size || adapter.canFly?.() === false) {
      // 松键/失能：停双驱动并重置 dt 基准（恢复按键时首帧不跳变）
      if (rafId) cancelAnimationFrame(rafId)
      if (ivId) clearInterval(ivId)
      rafId = 0; ivId = 0; lastT = 0
    }
  }
  function frame() {
    rafId = 0
    stepFly()
    if (pressed.size && adapter.canFly?.() !== false) {
      rafId = requestAnimationFrame(frame)
    }
  }
  /** 有键按下时确保双驱动在跑（keydown 后调用；幂等） */
  function startLoop() {
    if (!rafId && !ivId && pressed.size && typeof requestAnimationFrame !== 'undefined') {
      lastT = 0
      rafId = requestAnimationFrame(frame)
      ivId = setInterval(() => {
        // rAF 正常时它自己会推进；这里只在 rAF 被节流/停摆时补帧
        // （判断：距上次推进 >50ms 且仍有按键）
        if (pressed.size && performance.now() - lastT > 50) stepFly()
      }, 16)
    }
  }
  /** 场景销毁/组件卸载时停双驱动并清键 */
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
      window.addEventListener('blur', clearPressed)
    })
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', handleKeydown)
      window.removeEventListener('keyup', handleKeyup)
      window.removeEventListener('blur', clearPressed)
      stopLoop()
    })
  }

  return { tickFly, flySpeed, flySpeedIndex: () => speedIndex, isTextEntryTarget, startLoop, stopLoop }
}
