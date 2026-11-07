import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { forcedLandscapeDevice, setNativeLandscapeLock } from '../platform/screenForm.js'
import type { ForcedLandscapeDevice } from '../platform/screenForm.js'

/**
 * 场景页强制横屏（design-language §9「强制横屏」）。`active` 由页面给出（场景真正在显示时为 true）。
 * - Android 手机 App：active 期间原生锁横屏，失活 / 卸载 / KeepAlive 停用即释放；
 * - iPhone Safari：无法锁定，竖屏时 `blocked` 为 true，页面改显示旋转提示；
 * - 其它设备（桌面、平板、Android 浏览器）：`required` 恒为 false，什么都不发生。
 */
export function useForcedLandscape(active: Readonly<Ref<boolean>>) {
  const device = ref<ForcedLandscapeDevice>(null)
  const portrait = ref(false)
  const visible = ref(true)
  let query: MediaQueryList | null = null
  const syncOrientation = () => { portrait.value = !!query?.matches }

  const required = computed(() => visible.value && active.value && device.value !== null)
  const blocked = computed(() => required.value && portrait.value)

  let locked = false
  function applyLock(next: boolean) {
    if (device.value !== 'android-phone-app' || next === locked) return
    locked = next
    void setNativeLandscapeLock(next)
  }
  watch(required, value => applyLock(value))

  onMounted(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      query = window.matchMedia('(orientation: portrait)')
      query.addEventListener?.('change', syncOrientation)
      syncOrientation()
    }
    void forcedLandscapeDevice().then((value) => {
      device.value = value
      applyLock(required.value)
    })
  })
  onActivated(() => { visible.value = true })
  onDeactivated(() => { visible.value = false; applyLock(false) })
  onBeforeUnmount(() => {
    query?.removeEventListener?.('change', syncOrientation)
    applyLock(false)
  })

  return { device, required, blocked }
}
