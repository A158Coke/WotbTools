// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { nextVisibleCount, useIncrementalList } from './useIncrementalList.js'

describe('nextVisibleCount', () => {
  it('追加一页且不超过总数', () => {
    expect(nextVisibleCount(48, 100, 48)).toBe(96)
    expect(nextVisibleCount(96, 100, 48)).toBe(100)
    expect(nextVisibleCount(100, 100, 48)).toBe(100)
  })

  it('非法输入按安全值处理', () => {
    expect(nextVisibleCount(-5, 10, 0)).toBe(1)
    expect(nextVisibleCount(Number.NaN, 3, 2)).toBe(2)
    expect(nextVisibleCount(0, -1, 5)).toBe(0)
  })
})

describe('useIncrementalList', () => {
  const observers = []
  class FakeObserver {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this) }
    observe(el) { this.targets.add(el) }
    unobserve(el) { this.targets.delete(el) }
    disconnect() { this.targets.clear() }
    fire(isIntersecting = true) { this.callback([...this.targets].map(target => ({ target, isIntersecting }))) }
  }

  afterEach(() => {
    observers.length = 0
    vi.unstubAllGlobals()
  })

  function mountList(items, filterKey) {
    let api
    const Host = defineComponent({
      setup() {
        api = useIncrementalList(items, { pageSize: 2, resetKey: () => filterKey.value })
        return () => h('div', [
          ...api.visible.value.map(item => h('span', { class: 'item' }, item)),
          api.hasMore.value ? h('div', { class: 'sentinel', ref: api.sentinel }) : null,
        ])
      },
    })
    const wrapper = mount(Host)
    return { wrapper, api: () => api }
  }

  it('首屏一页，哨兵进入视口时追加下一页', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const items = ref(['a', 'b', 'c', 'd', 'e'])
    const { wrapper } = mountList(items, ref(''))
    expect(wrapper.findAll('.item')).toHaveLength(2)
    expect(observers).toHaveLength(1)

    observers[0].fire(true)
    await nextTick()
    expect(wrapper.findAll('.item')).toHaveLength(4)

    observers[0].fire(false)   // 离开视口不追加
    await nextTick()
    expect(wrapper.findAll('.item')).toHaveLength(4)

    observers[0].fire(true)
    await nextTick()
    expect(wrapper.findAll('.item')).toHaveLength(5)
    expect(wrapper.find('.sentinel').exists()).toBe(false)
  })

  it('筛选条件变化时回到第一页；没有 IntersectionObserver 时可手动 loadMore', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const items = ref(['a', 'b', 'c', 'd', 'e'])
    const key = ref('x')
    const { wrapper, api } = mountList(items, key)
    api().loadMore()
    await nextTick()
    expect(wrapper.findAll('.item')).toHaveLength(4)
    key.value = 'y'
    await nextTick()
    expect(wrapper.findAll('.item')).toHaveLength(2)
    expect(observers).toHaveLength(0)
  })
})
