import { onMounted, onScopeDispose, ref, watch } from 'vue'
import { forcedLandscapeDevice } from '../platform/screenForm.js'

export function useReplayAutoFullscreen(options: {
  token: () => number
  key: () => unknown
  ready: () => boolean
  active: () => boolean
  enter: () => void | Promise<boolean>
}) {
  const result = ref<'idle' | 'entered' | 'failed'>('idle')
  const eligible = ref(false)
  let disposed = false
  let consumedToken: number | null = null
  let consumedKey: unknown = undefined

  function tryConsume() {
    if (!eligible.value || !options.active() || !options.ready()) return
    const token = options.token()
    const key = options.key()
    if (token <= 0 || key == null) return
    if (consumedToken === token && consumedKey === key) return
    consumedToken = token
    consumedKey = key
    result.value = 'idle'
    void Promise.resolve(options.enter()).then(
      (entered) => { if (!disposed) result.value = entered === false ? 'failed' : 'entered' },
      () => { if (!disposed) result.value = 'failed' },
    )
  }

  onMounted(() => {
    void forcedLandscapeDevice().then((device) => {
      if (disposed) return
      eligible.value = device === 'android-phone-app'
    })
  })
  watch([eligible, options.token, options.key, options.ready, options.active], tryConsume, { flush: 'post', immediate: true })
  onScopeDispose(() => { disposed = true })
  return { result }
}
