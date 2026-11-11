import { onMounted, onScopeDispose, ref, watch } from 'vue'
import { forcedLandscapeDevice } from '../platform/screenForm.js'

/**
 * 回放查看器「成功就绪 → 自动横屏全屏」的边沿触发消费者（Android 手机 App 专属）。
 *
 * 工作台（ReplayWorkspace）在每次进入查看器时递增 `token`；查看器给出：
 * - `ready`：**成功**就绪（加载中、终态错误、被阻断都为 false；不要用 `data-pane-ready`）；
 * - `key`：回放身份（目标 File）；换回放 = 新的进入事件；
 * - `active`：能力是否仍激活。
 * 一个 (token, key) 身份至多自动尝试一次：用户主动退出全屏后，同一身份不会因「仍然 Ready」再次进入（I2）。
 * 未激活时不消费，晚到的就绪不会让非激活查看器全屏。平台闸门只认 `android-phone-app`
 * （不是 usePlaybackFullscreen 的 isPhone，它包含移动浏览器）。
 */
export function useReplayAutoFullscreen(options: {
  token: () => number
  key: () => unknown
  ready: () => boolean
  active: () => boolean
  /** 返回真实结果：true = 已进入全屏；false = 失败 / 被拒（不重试，退化为手动按钮） */
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
