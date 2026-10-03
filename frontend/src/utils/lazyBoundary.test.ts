// @vitest-environment happy-dom
/**
 * 懒加载可用性边界：部署换掉 chunk 文件名后，旧页面进入能力时 import 必然失败。
 * 该失败**不得**中断整页渲染，必须变成可见、可操作、可恢复的失败态。
 * （生产事故：AiReviewWorkspacePane chunk 404 把整个工作台打成空壳）
 *
 * 关键 regression：`retry()` 必须创建**新一代** async wrapper，并让 Pane 真正回到 DOM。
 * 只断言「raw loader 第二次成功」是不够的——那正是被修掉的假恢复：
 * error 被清空、Banner 消失，而 async wrapper 仍停在已 reject 的 pendingRequest 上，面板空白。
 */
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, nextTick, ref } from 'vue'
import { defineLazyModule, reloadForFreshBundle } from './lazyModule.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const CHUNK_404 = 'Failed to fetch dynamically imported module: /assets/AiReviewWorkspacePane-Ch0MEGwr.js'
const CSS_404 = 'Unable to preload CSS for /assets/AiReviewWorkspacePane-Ch0MEGwr.css'

const Pane = defineComponent({
  name: 'Pane',
  template: '<div data-testid="lazy-pane">loaded</div>',
})

/** 等 Vue 的 async wrapper 落定（loader promise → 渲染 → DOM）。 */
async function settle() {
  await flushPromises()
  await vi.dynamicImportSettled()
  await flushPromises()
  await nextTick()
  await flushPromises()
}

/** 让异步组件的加载（含其内部 delay 定时器）有机会发起。 */
async function triggerLoad() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await flushPromises()
}

/**
 * 宿主模拟能力的真实消费方式：失败态由 module.error 驱动，Pane 由 module.component 渲染。
 * 两者同处一个宿主，因此「error 清空但 Pane 没回来」会立刻暴露。
 */
function mountHost(module: ReturnType<typeof defineLazyModule>) {
  const Host = defineComponent({
    components: { Pane: module.component },
    setup: () => ({ failure: module.error }),
    template: `
      <div data-testid="host">
        <div v-if="failure" data-testid="failure-banner">failed</div>
        <Pane v-else />
      </div>`,
  })
  return mount(Host)
}

describe('defineLazyModule — 真实 DOM 恢复', () => {
  it('Test 1：失败 → 宿主保持挂载 + 失败态可见 → retry → Pane 真正回到 DOM', async () => {
    const first = deferred<typeof Pane>()
    let calls = 0
    const module = defineLazyModule(() => {
      calls += 1
      return calls === 1 ? first.promise : Promise.resolve(Pane)
    })
    const wrapper = mountHost(module)

    // attempt #1：404
    await triggerLoad()
    first.reject(new Error(CSS_404))
    await settle()

    expect(wrapper.find('[data-testid="host"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="failure-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="lazy-pane"]').exists()).toBe(false)
    expect(module.error.value).toBeInstanceOf(Error)

    // 用户按下 Retry：必须创建新一代 async wrapper（一次 retry = 恰好一次加载）
    const retryResult = module.retry()
    await triggerLoad()
    await expect(retryResult).resolves.toBe(Pane)
    await settle()

    expect(wrapper.find('[data-testid="lazy-pane"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="failure-banner"]').exists()).toBe(false)
    expect(module.error.value).toBeNull()
    expect(calls).toBe(2)
  })

  it('Test 3：retry 再次失败 → 保持失败态；再 retry 成功 → 恢复渲染', async () => {
    const attempts: Array<ReturnType<typeof deferred<typeof Pane>>> = []
    const module = defineLazyModule(() => {
      const attempt = deferred<typeof Pane>()
      attempts.push(attempt)
      return attempt.promise
    })
    const wrapper = mountHost(module)

    // attempt #1 fail
    await triggerLoad()
    attempts[0].reject(new Error(CHUNK_404))
    await settle()
    expect(wrapper.find('[data-testid="failure-banner"]').exists()).toBe(true)

    // attempt #2 fail：失败态必须保留，不能出现空白
    const second = module.retry()
    await triggerLoad()
    attempts[1].reject(new Error(CHUNK_404))
    await expect(second).resolves.toBeNull()
    await settle()
    expect(wrapper.find('[data-testid="failure-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="lazy-pane"]').exists()).toBe(false)
    expect(module.error.value).toBeInstanceOf(Error)

    // attempt #3 success
    const third = module.retry()
    await triggerLoad()
    attempts[2].resolve(Pane)
    await expect(third).resolves.toBe(Pane)
    await settle()
    expect(wrapper.find('[data-testid="lazy-pane"]').exists()).toBe(true)
    expect(module.error.value).toBeNull()
  })

  it('每一次 retry 都产生新的 async wrapper（不复用已 reject 的 pendingRequest）', async () => {
    const attempts: Array<ReturnType<typeof deferred<typeof Pane>>> = []
    const module = defineLazyModule(() => {
      const attempt = deferred<typeof Pane>()
      attempts.push(attempt)
      return attempt.promise
    })
    mountHost(module)
    await triggerLoad()
    expect(attempts.length).toBeGreaterThanOrEqual(1)

    // 首次加载失败：失败的 promise 已被这一代 wrapper 记住
    attempts[0].reject(new Error(CHUNK_404))
    await settle()
    const afterFirstFailure = attempts.length

    const retryResult = module.retry()
    await triggerLoad()
    expect(attempts.length).toBeGreaterThan(afterFirstFailure)

    // 新一代加载成功后 retry 才能 settle（不依赖旧 wrapper 的 reject 缓存）
    attempts[attempts.length - 1].resolve(Pane)
    await expect(retryResult).resolves.toBe(Pane)
  })

  it('Test 4：加载失败不产生未捕获的渲染错误（onError 走 fail()，不向上抛）', async () => {
    const errors: unknown[] = []
    const module = defineLazyModule(() => Promise.reject(new Error(CHUNK_404)))
    const Host = defineComponent({
      components: { Pane: module.component },
      setup: () => ({ failure: module.error }),
      template: '<div data-testid="host"><Pane v-if="!failure" /></div>',
    })
    const wrapper = mount(Host, { global: { config: { errorHandler: (e: unknown) => errors.push(e) } } })
    await settle()

    expect(wrapper.find('[data-testid="host"]').exists()).toBe(true)
    expect(module.error.value).toBeInstanceOf(Error)
    expect(errors).toEqual([])
  })

  it('retry 失败时返回 null 并保留失败原因（调用方可据此判断）', async () => {
    const module = defineLazyModule(() => Promise.reject(new Error('still gone')))
    await expect(module.retry()).resolves.toBeNull()
    expect(module.error.value).toBeInstanceOf(Error)
  })
})

/**
 * Test 2 —— 失败态必须**持久**。
 *
 * 宿主按 ReplayWorkspace 的真实形态最小化复刻：能力面板由 `v-if="visible && !loadError"` 控制挂载，
 * 失败 Banner 由 `loadError` 控制显示（Banner 显示期间面板本身不在树上）。
 * 这里锁定的是被修掉的行为：重新进入 capability 时偷偷清掉失败态 → 面板空白且没有任何提示。
 */
describe('懒加载失败态的持久性（能力切走再切回）', () => {
  function mountCapabilityHost(module: ReturnType<typeof defineLazyModule>) {
    const Host = defineComponent({
      components: { Pane: module.component },
      setup() {
        const visible = ref(true)
        const loadError = computed(() => (module.error.value ? 'workspace.pane_load_failed' : ''))
        return { visible, loadError }
      },
      template: `
        <div data-testid="workspace">
          <div v-if="loadError" data-testid="failure-banner">{{ loadError }}</div>
          <Pane v-if="visible && !loadError" />
        </div>`,
    })
    return mount(Host)
  }

  it('失败 → 切走 → 切回：失败 Banner 仍在，面板不会静默变空白', async () => {
    const module = defineLazyModule(() => Promise.reject(new Error(CHUNK_404)))
    const wrapper = mountCapabilityHost(module)
    await triggerLoad()
    await settle()

    expect(wrapper.find('[data-testid="failure-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="lazy-pane"]').exists()).toBe(false)

    // 切到别的 capability：面板卸载
    wrapper.vm.visible = false
    await nextTick()
    expect(wrapper.find('[data-testid="failure-banner"]').exists()).toBe(true)

    // 切回来：必须仍然是「有提示的失败」，而不是「没有提示的空白」
    wrapper.vm.visible = true
    await settle()
    expect(module.error.value).toBeInstanceOf(Error)
    expect(wrapper.find('[data-testid="failure-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="lazy-pane"]').exists()).toBe(false)
  })

  it('切走再切回不会自动重试（仍由用户显式点 Retry 恢复）', async () => {
    let calls = 0
    const module = defineLazyModule(() => {
      calls += 1
      return Promise.reject(new Error(CHUNK_404))
    })
    const wrapper = mountCapabilityHost(module)
    await triggerLoad()
    await settle()
    const callsAfterFailure = calls

    wrapper.vm.visible = false
    await nextTick()
    wrapper.vm.visible = true
    await settle()
    expect(calls).toBe(callsAfterFailure)

    // 用户显式重试：才会发起新一代加载
    const retried = module.retry()
    await expect(retried).resolves.toBeNull()
    expect(calls).toBeGreaterThan(callsAfterFailure)
    expect(wrapper.find('[data-testid="failure-banner"]').exists()).toBe(true)
  })
})

describe('reloadForFreshBundle', () => {
  it('首次触发刷新，窗口内第二次不再自动跳转（防刷新成环）', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    reloadForFreshBundle()
    reloadForFreshBundle()
    expect(reload).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
