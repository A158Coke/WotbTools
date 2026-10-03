// @vitest-environment happy-dom
/**
 * 懒加载可用性边界：部署换掉 chunk 文件名后，旧页面进入能力时 import 必然失败。
 * 该失败**不得**中断整页渲染，必须变成可见、可操作、可重试的失败态。
 * （生产事故：AiReviewWorkspacePane chunk 404 把整个工作台打成空壳）
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { defineLazyModule } from './lazyModule.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const CHUNK_404 = 'Failed to fetch dynamically imported module: /assets/AiReviewWorkspacePane-Ch0MEGwr.js'
const CSS_404 = 'Unable to preload CSS for /assets/AiReviewWorkspacePane-Ch0MEGwr.css'

function failureOf(lazy: { error: { value: unknown } }): Error {
  expect(lazy.error.value).toBeInstanceOf(Error)
  return lazy.error.value as Error
}

describe('defineLazyModule', () => {
  const Pane = defineComponent({ name: 'Pane', render: () => null })

  it('加载成功 → 无失败记录，模块可用', async () => {
    const lazy = defineLazyModule(async () => ({ default: Pane }))
    const module = await lazy.retry()
    expect(module?.default).toBe(Pane)
    expect(lazy.error.value).toBeNull()
  })

  it('加载失败 → 记录失败原因（不吞错），边界本身不抛出', async () => {
    const lazy = defineLazyModule(() => Promise.reject(new Error(CSS_404)))
    await expect(lazy.retry()).resolves.toBeNull()
    expect(failureOf(lazy).message).toBe(CSS_404)
  })

  it('retry 成功 → 清空失败记录并恢复渲染（网络瞬断可原地恢复）', async () => {
    const first = deferred<{ default: typeof Pane }>()
    let calls = 0
    const lazy = defineLazyModule(() => {
      calls += 1
      return calls === 1 ? first.promise : Promise.resolve({ default: Pane })
    })
    first.reject(new Error(CHUNK_404))
    await expect(lazy.retry()).resolves.toBeNull()
    expect(failureOf(lazy).message).toBe(CHUNK_404)

    await expect(lazy.retry()).resolves.toEqual({ default: Pane })
    expect(lazy.error.value).toBeNull()
    expect(calls).toBe(2)
  })

  it('异步组件挂载时加载失败 → 宿主组件仍挂载（onError 返回 false 阻断上抛）', async () => {
    const errors: unknown[] = []
    const lazy = defineLazyModule(() => Promise.reject(new Error(CHUNK_404)))
    const Host = defineComponent({
      components: { Pane: lazy.component },
      setup: () => ({ failure: lazy.error }),
      template: '<div data-test="host"><Pane v-if="!failure" /></div>',
    })
    const wrapper = mount(Host, { global: { config: { errorHandler: (e: unknown) => errors.push(e) } } })
    await vi.dynamicImportSettled()
    await Promise.resolve()
    await Promise.resolve()
    expect(wrapper.find('[data-test="host"]').exists()).toBe(true)
    expect(failureOf(lazy).message).toBe(CHUNK_404)
    expect(errors).toEqual([])
  })
})
