import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { forcedLandscapeDevice, setNativeOrientationLock } from '../platform/screenForm.js'
import type { ForcedLandscapeDevice } from '../platform/screenForm.js'

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
