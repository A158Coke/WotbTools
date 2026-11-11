import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { forcedLandscapeDevice, setNativeOrientationLock } from '../platform/screenForm.js'
import type { ForcedLandscapeDevice } from '../platform/screenForm.js'

/**
 * 场景页强制横屏（design-language §9「强制横屏」）。`active` 由页面给出（场景真正在显示时为 true）。
 * - Android 手机 App：active 期间原生锁横屏，失活 / 卸载 / KeepAlive 停用即释放；
 * - iPhone Safari：无法锁定，竖屏时 `blocked` 为 true，页面改显示旋转提示；
 * - 其它设备（桌面、平板、Android 浏览器）：`required` 恒为 false，什么都不发生。
 *
 * `androidOrientation`（默认 landscape）：回放工作台查看器传 `portrait`——Android 手机 App 非全屏时
 * 固定竖屏（全屏由 MainActivity.enterFullscreen 自己锁横屏并在退出时还原到这个竖屏锁）；
 * 此时 Android 不需要旋转提示，iPhone Safari 的 `blocked` 行为不变。
 * `androidActive`：仅 Android 手机 App 用它代替 `active`（空查看器 / 解析中也要锁竖屏；iPhone 的旋转提示仍按 `active`）。
 */
export function useForcedLandscape(active: Readonly<Ref<boolean>>, options: { androidOrientation?: 'landscape' | 'portrait'; androidActive?: Readonly<Ref<boolean>> } = {}) {
  const androidOrientation = options.androidOrientation ?? 'landscape'
  const device = ref<ForcedLandscapeDevice>(null)
  const portrait = ref(false)
  const visible = ref(true)
  let query: MediaQueryList | null = null
  const syncOrientation = () => { portrait.value = !!query?.matches }

  const required = computed(() => visible.value && device.value !== null
    && (device.value === 'android-phone-app' && options.androidActive ? options.androidActive.value : active.value))
  const blocked = computed(() => required.value && portrait.value && !(androidOrientation === 'portrait' && device.value === 'android-phone-app'))

  let locked = false
  /** 卸载后异步设备判定才返回：不得再给已离开的页面加锁（否则下一个页面被锁在横屏且无人释放） */
  let disposed = false
  function applyLock(next: boolean) {
    if (device.value !== 'android-phone-app' || next === locked) return
    locked = next
    void setNativeOrientationLock(next ? androidOrientation : 'unspecified')
  }
  watch(required, value => applyLock(value))

  onMounted(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      query = window.matchMedia('(orientation: portrait)')
      query.addEventListener?.('change', syncOrientation)
      syncOrientation()
    }
    void forcedLandscapeDevice().then((value) => {
      if (disposed) return
      device.value = value
      applyLock(required.value)
    })
  })
  onActivated(() => { visible.value = true })
  onDeactivated(() => { visible.value = false; applyLock(false) })
  onBeforeUnmount(() => {
    disposed = true
    visible.value = false
    query?.removeEventListener?.('change', syncOrientation)
    applyLock(false)
  })

  return { device, required, blocked }
}
