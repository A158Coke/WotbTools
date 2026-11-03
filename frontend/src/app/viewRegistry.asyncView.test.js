// @vitest-environment happy-dom
// #845：异步视图统一加载/错误契约的行为测试。loading 面由 defineAsyncComponent 的
// delay（--duration-slow token）控制 flicker；latest-wins 由卸载语义保证；错误面
// 的重试走 onError retry 重新执行 loader。
// 注意：fake timers 下 test-utils 的 flushPromises（setTimeout 0）不会推进，
// 全部用 advanceTimersByTimeAsync 推进微任务与定时器；宿主用 <div> 包住异步
// 组件（未 resolve 时组件根 vnode 为 null，直接作为 mount 根会让 find 崩溃）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { asyncView, VIEW_LOAD_DELAY_MS } from './viewRegistry.js'

const ReadMotionTokens = vi.hoisted(() => ({ slow: 0.3 }))
vi.mock('../shared/motion/motionPolicy', () => ({
  readMotionTokens: () => ({ slow: ReadMotionTokens.slow, fast: 0.15, base: 0.2, ease: [0.2, 0, 0, 1] }),
}))

const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms)
  await nextTick()
}

const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** 宿主 div 包住被测异步组件：find 在宿主元素内查询；$t 按仓库测试约定 mock。 */
const mountView = (loader) => {
  const comp = asyncView(loader)
  const Host = defineComponent({ setup: () => () => h('div', { 'data-testid': 'host' }, [h(comp)]) })
  return mount(Host, { global: { mocks: { $t: (key) => key } } })
}

describe('asyncView（View 切换统一加载/错误契约，#845）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ReadMotionTokens.slow = 0.3
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('chunk 在阈值内完成：loading 面从不出现，直接渲染内容（flicker-free）', async () => {
    const d = deferred()
    const wrapper = mountView(() => d.promise)
    d.resolve(Page)
    await settle(VIEW_LOAD_DELAY_MS - 1)
    expect(wrapper.find('[data-testid="view-transition-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="probe-page"]').exists()).toBe(true)
    await settle(1)
    expect(wrapper.find('[data-testid="view-transition-loading"]').exists()).toBe(false)
  })

  it('chunk 超过 --duration-slow 阈值：显示统一 loading，完成后原子替换为内容', async () => {
    const d = deferred()
    const wrapper = mountView(() => d.promise)
    await settle(VIEW_LOAD_DELAY_MS)
    expect(wrapper.find('[data-testid="view-transition-loading"]').exists()).toBe(true)
    d.resolve(Page)
    await settle()
    expect(wrapper.find('[data-testid="probe-page"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="view-transition-loading"]').exists()).toBe(false)
  })

  it('阈值取 --duration-slow token（300ms），设计改档时跟随', async () => {
    const d = deferred()
    ReadMotionTokens.slow = 0.15   // 设计 token 改档 → 阈值跟随
    const wrapper = mountView(() => d.promise)
    await settle(150)
    expect(wrapper.find('[data-testid="view-transition-loading"]').exists()).toBe(true)
    d.resolve(Page)
    await settle()
    expect(wrapper.find('[data-testid="probe-page"]').exists()).toBe(true)
  })

  it('加载失败：进入统一错误面（不无限 spinner），重试重新执行 loader', async () => {
    const first = deferred()
    let attempt = 0
    const loader = vi.fn(() => (attempt++ === 0 ? first.promise : Promise.resolve(Page)))
    const wrapper = mountView(loader)
    first.reject(new Error('chunk 404'))
    await settle()
    expect(wrapper.find('[data-testid="view-transition-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="view-transition-loading"]').exists()).toBe(false)
    await wrapper.find('[data-testid="view-transition-retry"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="probe-page"]').exists()).toBe(true)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('latest-wins：切换后 pending loader 的 resolve 不会再渲染（stale 结果被丢弃）', async () => {
    const d = deferred()
    const wrapper = mountView(() => d.promise)
    await settle(VIEW_LOAD_DELAY_MS)
    expect(wrapper.find('[data-testid="view-transition-loading"]').exists()).toBe(true)
    // 用户已切走（宿主卸载 pending 的 async component 实例）
    wrapper.unmount()
    d.resolve(Page)
    await settle()
    expect(document.querySelector('[data-testid="probe-page"]')).toBeNull()
  })
})

const Page = defineComponent({
  name: 'ProbePage',
  setup() {
    return () => h('p', { 'data-testid': 'probe-page' }, 'content')
  },
})
