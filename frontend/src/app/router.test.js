// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from './router.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Android route canonicalization', () => {
  it('replaces stale Home deep links with the Replay-root URL and preserves unrelated query/hash', async () => {
    vi.stubEnv('MODE', 'android')
    const router = createAppRouter(createMemoryHistory())

    await router.push('/?view=home&lang=zh#guide')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/')
    expect(router.currentRoute.value.query).toEqual({ lang: 'zh' })
    expect(router.currentRoute.value.hash).toBe('#guide')
  })

  it('does not rewrite the Web Home deep link', async () => {
    vi.stubEnv('MODE', 'test')
    const router = createAppRouter(createMemoryHistory())

    await router.push('/?view=home&lang=zh#guide')
    await router.isReady()

    expect(router.currentRoute.value.query).toEqual({ view: 'home', lang: 'zh' })
    expect(router.currentRoute.value.hash).toBe('#guide')
  })
})
