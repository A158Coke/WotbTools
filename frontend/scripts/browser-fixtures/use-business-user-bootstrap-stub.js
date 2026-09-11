import { computed, ref } from 'vue'

/**
 * `src/composables/useBusinessUserBootstrap.js` 的浏览器测试替身（见 use-auth-stub.js 说明）。
 *
 * 只在浏览器 harness 的 Vite 实例里经 alias 生效。存在的唯一理由是：真实实现会在认证后
 * 打 `/api/.../profile` ensure 请求，而 harness 没有后端；这里让它直接 ready，
 * 避免把「后端不可达」的噪音混进 mobile 交互回归断言。
 */
const state = ref('ready')
const error = ref(null)

export function ensureBusinessUser() {
  return Promise.resolve(true)
}

export async function whenBusinessUserSettled() {
  return true
}

export function retryBusinessUser() {
  return Promise.resolve(true)
}

export function resetBusinessUserBootstrap() {
  state.value = 'ready'
  error.value = null
}

export function useBusinessUserBootstrap() {
  return {
    state,
    error,
    ready: computed(() => true),
    failed: computed(() => false),
    ensure: ensureBusinessUser,
    whenSettled: whenBusinessUserSettled,
    retry: retryBusinessUser,
  }
}
