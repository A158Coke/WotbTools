// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, nextTick, ref } from 'vue'
import { defineLazyModule, reloadForFreshBundle, tryReloadForFreshBundle } from './lazyModule.js'

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

async function settle() {
  await flushPromises()
  await vi.dynamicImportSettled()
  await flushPromises()
  await nextTick()
  await flushPromises()
}

async function triggerLoad() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await flushPromises()
}

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

    await triggerLoad()
    first.reject(new Error(CSS_404))
    await settle()

    expect(wrapper.find('[data-testid="host"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="failure-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="lazy-pane"]').exists()).toBe(false)
    expect(module.error.value).toBeInstanceOf(Error)

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

    await triggerLoad()
    attempts[0].reject(new Error(CHUNK_404))
    await settle()
    expect(wrapper.find('[data-testid="failure-banner"]').exists()).toBe(true)

    const second = module.retry()
    await triggerLoad()
    attempts[1].reject(new Error(CHUNK_404))
    await expect(second).resolves.toBeNull()
    await settle()
    expect(wrapper.find('[data-testid="failure-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="lazy-pane"]').exists()).toBe(false)
    expect(module.error.value).toBeInstanceOf(Error)

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

    attempts[0].reject(new Error(CHUNK_404))
    await settle()
    const afterFirstFailure = attempts.length

    const retryResult = module.retry()
    await triggerLoad()
    expect(attempts.length).toBeGreaterThan(afterFirstFailure)

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

    wrapper.vm.visible = false
    await nextTick()
    expect(wrapper.find('[data-testid="failure-banner"]').exists()).toBe(true)

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

describe('tryReloadForFreshBundle contract', () => {
  function reloadTarget(
    { readThrows = false, writeThrows = false }: { readThrows?: boolean; writeThrows?: boolean } = {},
  ) {
    const values = new Map<string, string>()
    const reload = vi.fn()
    return {
      reload,
      target: {
        sessionStorage: {
          getItem: (key: string) => {
            if (readThrows) throw new Error('storage read denied')
            return values.get(key) ?? null
          },
          setItem: (key: string, value: string) => {
            if (writeThrows) throw new Error('storage write denied')
            values.set(key, value)
          },
        },
        location: { reload },
      },
    }
  }

  it('manual：guard 持久化成功 → 调用 beforeReload + reload 一次，返回 true', () => {
    const { target, reload } = reloadTarget()
    const beforeReload = vi.fn()
    expect(tryReloadForFreshBundle(beforeReload, target)).toBe(true)
    expect(beforeReload).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(beforeReload.mock.invocationCallOrder[0])
      .toBeLessThan(reload.mock.invocationCallOrder[0])
  })

  it('manual：storage 不可用仍 reload（保留用户主动恢复）', () => {
    const { target, reload } = reloadTarget({ writeThrows: true })
    const beforeReload = vi.fn()
    expect(tryReloadForFreshBundle(beforeReload, target)).toBe(true)
    expect(beforeReload).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('manual：60 秒 cooldown 内 → false，不调用 beforeReload / reload', () => {
    const { target, reload } = reloadTarget()
    expect(tryReloadForFreshBundle(() => {}, target)).toBe(true)
    reload.mockClear()
    const beforeReload = vi.fn()
    expect(tryReloadForFreshBundle(beforeReload, target)).toBe(false)
    expect(beforeReload).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('automatic：guard 持久化成功 → preventDefault hook + reload 一次，返回 true', () => {
    const { target, reload } = reloadTarget()
    const beforeReload = vi.fn()
    expect(tryReloadForFreshBundle(beforeReload, target, { requirePersistentGuard: true })).toBe(true)
    expect(beforeReload).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(beforeReload.mock.invocationCallOrder[0])
      .toBeLessThan(reload.mock.invocationCallOrder[0])
  })

  it('automatic：storage 写入失败 → false，不调用 beforeReload / reload', () => {
    const { target, reload } = reloadTarget({ writeThrows: true })
    const beforeReload = vi.fn()
    expect(tryReloadForFreshBundle(beforeReload, target, { requirePersistentGuard: true })).toBe(false)
    expect(beforeReload).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('automatic：storage 读取失败 → false，不调用 beforeReload / reload', () => {
    const { target, reload } = reloadTarget({ readThrows: true })
    const beforeReload = vi.fn()
    expect(tryReloadForFreshBundle(beforeReload, target, { requirePersistentGuard: true })).toBe(false)
    expect(beforeReload).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('automatic：已有 cooldown → false，不调用 beforeReload / reload', () => {
    const { target, reload } = reloadTarget()
    expect(tryReloadForFreshBundle(() => {}, target, { requirePersistentGuard: true })).toBe(true)
    reload.mockClear()
    const beforeReload = vi.fn()
    expect(tryReloadForFreshBundle(beforeReload, target, { requirePersistentGuard: true })).toBe(false)
    expect(beforeReload).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('explicit：automatic 刚写入 guard（cooldown 内）→ 用户主动点击仍 reload', () => {
    const { target, reload } = reloadTarget()
    expect(tryReloadForFreshBundle(() => {}, target, { requirePersistentGuard: true })).toBe(true)
    reload.mockClear()
    expect(tryReloadForFreshBundle(() => {}, target, { explicit: true })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('explicit：reload 后仍写入 guard，后续 automatic 恢复继续受 cooldown 保护', () => {
    const { target, reload } = reloadTarget()
    expect(tryReloadForFreshBundle(() => {}, target, { explicit: true })).toBe(true)
    reload.mockClear()
    expect(tryReloadForFreshBundle(() => {}, target, { requirePersistentGuard: true })).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('explicit：storage 不可用仍 reload（manual 语义不变）', () => {
    const { target, reload } = reloadTarget({ readThrows: true })
    expect(tryReloadForFreshBundle(() => {}, target, { explicit: true })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('返回值与真实 reload 次数严格对应（true ⇔ 1 次，false ⇔ 0 次）', () => {
    const cases: Array<{
      options?: { requirePersistentGuard?: boolean }
      storage?: { readThrows?: boolean; writeThrows?: boolean }
      expected: boolean
    }> = [
      { storage: {}, expected: true },
      { storage: { writeThrows: true }, expected: true },
      { options: { requirePersistentGuard: true }, storage: {}, expected: true },
      { options: { requirePersistentGuard: true }, storage: { writeThrows: true }, expected: false },
      { options: { requirePersistentGuard: true }, storage: { readThrows: true }, expected: false },
    ]
    for (const { options, storage, expected } of cases) {
      const { target, reload } = reloadTarget(storage)
      const result = tryReloadForFreshBundle(() => {}, target, options)
      expect(result).toBe(expected)
      expect(reload).toHaveBeenCalledTimes(expected ? 1 : 0)
    }
  })
})
