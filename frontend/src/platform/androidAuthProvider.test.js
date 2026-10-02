// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

// 模拟 keycloak-js：android provider 只允许走 bridge，构造 keycloak 就是回归。
const kcInstances = []

vi.mock('keycloak-js', () => ({
  default: class {
    constructor() {
      kcInstances.push(this)
    }
    init = () => Promise.resolve(true)
    login = () => Promise.resolve(true)
    logout = () => Promise.resolve(undefined)
    updateToken = () => Promise.resolve(false)
  },
}))

import Keycloak from 'keycloak-js'
import { createAndroidAuthProvider, createUnsupportedAuthProvider } from './androidAuthProvider.js'

/** 哨兵：Native 永不回这条 RPC（模拟网络挂起，只能由 callBridge 的超时兜底）。 */
const NO_REPLY = Symbol('no-reply')

/** 模拟 origin-scoped bridge：postMessage → native reply → 'message' 事件（同 id）。 */
function stubNative(results = {}) {
  const listeners = []
  const calls = []
  window.WotbNative = {
    postMessage: vi.fn((json) => {
      const msg = JSON.parse(json)
      calls.push({ method: msg.method, params: msg.params })
      const result = results[msg.method]
      if (result === NO_REPLY) return
      listeners.forEach(cb =>
        cb({ data: JSON.stringify({ id: msg.id, result: result ?? null }) })
      )
    }),
    addEventListener: vi.fn((type, cb) => listeners.push(cb)),
    removeEventListener: vi.fn((type, cb) => {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    }),
  }
  return { calls, results }
}

const ADMIN_CLAIMS = Object.freeze({
  displayName: 'A158布丁',
  realm_access: { roles: ['wotbtools-admin'] },
})

function methodsOf(native) {
  return native.calls.map(call => call.method)
}

describe('androidAuthProvider', () => {
  afterEach(() => {
    vi.useRealTimers()
    delete window.WotbNative
    delete window.wotbtoolsOnAuthChanged
  })

  it('init() 把 authGetState + authGetAccessToken 映射成 authenticated / token / claims', async () => {
    const native = stubNative({
      authGetState: { authenticated: true, expiresAt: 1_700_000_000 },
      authGetAccessToken: {
        token: 'native-token',
        expiresAt: 1_700_000_000,
        claims: ADMIN_CLAIMS,
        error: null,
      },
    })
    const provider = createAndroidAuthProvider()

    await provider.init({ mode: 'normal' })

    expect(provider.name).toBe('android')
    expect(provider.authenticated).toBe(true)
    expect(provider.tokenParsed).toEqual(ADMIN_CLAIMS)
    expect(provider.token()).toBe('native-token')
    expect(native.calls).toEqual([
      { method: 'authGetState', params: {} },
      { method: 'authGetAccessToken', params: { minValiditySeconds: 30 } },
    ])
  })

  it('init() 在未登录时立即落定，不再请求 token', async () => {
    const native = stubNative({
      authGetState: { authenticated: false, expiresAt: null },
      authGetAccessToken: { token: 'must-not-be-requested', expiresAt: null, claims: null, error: null },
    })
    const provider = createAndroidAuthProvider()

    await expect(provider.init({ mode: 'normal' })).resolves.toBeUndefined()

    expect(provider.authenticated).toBe(false)
    expect(provider.tokenParsed).toBe(null)
    expect(provider.token()).toBe('')
    expect(methodsOf(native)).toEqual(['authGetState'])
  })

  it('init() 遇到 error 回复（refresh-failed）按未登录处理，绝不留下半登录态', async () => {
    stubNative({
      authGetState: { authenticated: true, expiresAt: 1_700_000_000 },
      authGetAccessToken: { token: null, expiresAt: null, claims: null, error: 'refresh-failed' },
    })
    const provider = createAndroidAuthProvider()

    await provider.init({ mode: 'normal' })

    expect(provider.authenticated).toBe(false)
    expect(provider.tokenParsed).toBe(null)
    expect(provider.token()).toBe('')
  })

  it('init() 遇到 null 回复（超时 / 未知方法）同样落定为未登录，不会卡在 initializing', async () => {
    stubNative({ authGetState: null })
    const provider = createAndroidAuthProvider()

    await expect(provider.init({ mode: 'normal' })).resolves.toBeUndefined()

    expect(provider.authenticated).toBe(false)
    expect(provider.token()).toBe('')
  })

  it('claims 缺失时 tokenParsed 保持 null（不伪造空对象），token 仍可用', async () => {
    stubNative({
      authGetState: { authenticated: true, expiresAt: 1_700_000_000 },
      authGetAccessToken: { token: 'native-token', expiresAt: 1_700_000_000, claims: null, error: null },
    })
    const provider = createAndroidAuthProvider()

    await provider.init({ mode: 'normal' })

    expect(provider.authenticated).toBe(true)
    expect(provider.tokenParsed).toBe(null)
    expect(provider.token()).toBe('native-token')
  })

  it('login() 调用 authLogin 并如实透传 Native 的启动结果', async () => {
    const native = stubNative({ authLogin: true })
    const provider = createAndroidAuthProvider()

    await expect(provider.login('https://wotbtools.com/?view=profile')).resolves.toBe(true)
    expect(native.calls).toEqual([{ method: 'authLogin', params: {} }])

    native.results.authLogin = false
    await expect(provider.login()).resolves.toBe(false)

    native.results.authLogin = null
    await expect(provider.login()).resolves.toBe(false)
  })

  it('logout() 调用 authLogout 并把本地状态落回未登录', async () => {
    const native = stubNative({
      authGetState: { authenticated: true, expiresAt: 1_700_000_000 },
      authGetAccessToken: { token: 'native-token', expiresAt: 1_700_000_000, claims: ADMIN_CLAIMS, error: null },
    })
    const provider = createAndroidAuthProvider()
    await provider.init({ mode: 'normal' })
    expect(provider.authenticated).toBe(true)

    native.results.authLogout = true
    await expect(provider.logout('ignored-redirect-uri')).resolves.toBeUndefined()

    expect(methodsOf(native).at(-1)).toBe('authLogout')
    expect(provider.authenticated).toBe(false)
    expect(provider.tokenParsed).toBe(null)
    expect(provider.token()).toBe('')
  })

  it('ensureToken() 用 authGetAccessToken 续期并回写最新 token / claims', async () => {
    const native = stubNative({
      authGetState: { authenticated: true, expiresAt: 1_700_000_000 },
      authGetAccessToken: { token: 'stale-token', expiresAt: 1_700_000_000, claims: ADMIN_CLAIMS, error: null },
    })
    const provider = createAndroidAuthProvider()
    await provider.init({ mode: 'normal' })

    native.results.authGetAccessToken = {
      token: 'fresh-token',
      expiresAt: 1_700_000_600,
      claims: { realm_access: { roles: ['wotbtools-user'] } },
      error: null,
    }
    await expect(provider.ensureToken(120)).resolves.toBe(true)

    expect(native.calls.at(-1)).toEqual({
      method: 'authGetAccessToken',
      params: { minValiditySeconds: 120 },
    })
    expect(provider.token()).toBe('fresh-token')
    expect(provider.tokenParsed).toEqual({ realm_access: { roles: ['wotbtools-user'] } })
  })

  it('ensureToken() 失败（refresh-failed / null）返回 false 并清空本地会话', async () => {
    const native = stubNative({
      authGetState: { authenticated: true, expiresAt: 1_700_000_000 },
      authGetAccessToken: { token: 'native-token', expiresAt: 1_700_000_000, claims: ADMIN_CLAIMS, error: null },
    })
    const provider = createAndroidAuthProvider()
    await provider.init({ mode: 'normal' })

    native.results.authGetAccessToken = { token: null, expiresAt: null, claims: null, error: 'refresh-failed' }
    await expect(provider.ensureToken(30)).resolves.toBe(false)
    expect(provider.authenticated).toBe(false)
    expect(provider.tokenParsed).toBe(null)
    expect(provider.token()).toBe('')

    // 未登录后不再发起任何 RPC。
    const callsBefore = native.calls.length
    await expect(provider.ensureToken(30)).resolves.toBe(false)
    expect(native.calls.length).toBe(callsBefore)
  })

  it('auth RPC 用 20s 预算：超时按未登录落定，而不是挂死', async () => {
    vi.useFakeTimers()
    stubNative({ authGetState: NO_REPLY })
    const provider = createAndroidAuthProvider()

    let settled = false
    const pending = provider.init().then(() => { settled = true })

    // 通用 5s 预算不适用于 auth 调用（OIDC discovery + refresh 可以更久）。
    await vi.advanceTimersByTimeAsync(5_000)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(15_000)
    await pending
    expect(settled).toBe(true)
    expect(provider.authenticated).toBe(false)
  })

  it('authLogin 超时解析为 false（不导航、不挂起）', async () => {
    vi.useFakeTimers()
    const native = stubNative({ authLogin: NO_REPLY })
    const provider = createAndroidAuthProvider()

    const pending = provider.login()
    await vi.advanceTimersByTimeAsync(20_000)

    await expect(pending).resolves.toBe(false)
    expect(methodsOf(native)).toEqual(['authLogin'])
  })

  it('onAuthChanged 注册 Native 全局，回读状态后通知 owner，退订清掉全局', async () => {
    const native = stubNative({
      authGetState: { authenticated: false, expiresAt: null },
      authGetAccessToken: null,
    })
    const provider = createAndroidAuthProvider()
    await provider.init({ mode: 'normal' })
    const onChange = vi.fn()
    const unsubscribe = provider.onAuthChanged(onChange)

    expect(typeof window.wotbtoolsOnAuthChanged).toBe('function')

    // Native 在 external browser 里完成登录后推送：WebView 停在原页面，只回读状态。
    native.results.authGetState = { authenticated: true, expiresAt: 1_700_000_100 }
    native.results.authGetAccessToken = {
      token: 'fresh-token',
      expiresAt: 1_700_000_100,
      claims: ADMIN_CLAIMS,
      error: null,
    }
    window.wotbtoolsOnAuthChanged()

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(provider.authenticated).toBe(true)
    expect(provider.token()).toBe('fresh-token')
    expect(provider.tokenParsed).toEqual(ADMIN_CLAIMS)

    unsubscribe()
    expect(window.wotbtoolsOnAuthChanged).toBeUndefined()
  })

  it('onAuthChanged 推送后 Native 报告未登录时同样会通知 owner（logout 方向）', async () => {
    const native = stubNative({
      authGetState: { authenticated: true, expiresAt: 1_700_000_000 },
      authGetAccessToken: { token: 'native-token', expiresAt: 1_700_000_000, claims: ADMIN_CLAIMS, error: null },
    })
    const provider = createAndroidAuthProvider()
    await provider.init({ mode: 'normal' })
    const onChange = vi.fn()
    provider.onAuthChanged(onChange)

    native.results.authGetState = { authenticated: false, expiresAt: null }
    window.wotbtoolsOnAuthChanged()

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(provider.authenticated).toBe(false)
    expect(provider.tokenParsed).toBe(null)
  })

  it('unsupported provider 显式失败且绝不触碰 keycloak / bridge / 导航', async () => {
    const native = stubNative({})
    const hrefBefore = window.location.href
    const provider = createUnsupportedAuthProvider('bridge-v1')

    expect(provider.name).toBe('android-unsupported')
    expect(provider.authenticated).toBe(false)
    expect(provider.tokenParsed).toBe(null)
    expect(provider.token()).toBe('')
    expect(Keycloak).toBeTypeOf('function')

    const initError = await provider.init({ mode: 'normal' }).catch(error => error)
    expect(initError.name).toBe('NATIVE_AUTH_UNSUPPORTED')
    expect(initError.code).toBe('NATIVE_AUTH_UNSUPPORTED')
    expect(initError.reason).toBe('bridge-v1')
    expect(initError.message).toContain('NATIVE_AUTH_UNSUPPORTED: bridge-v1')

    const loginError = await provider.login('https://wotbtools.com/?view=profile').catch(error => error)
    expect(loginError.code).toBe('NATIVE_AUTH_UNSUPPORTED')

    await expect(provider.logout('https://wotbtools.com/')).resolves.toBeUndefined()
    await expect(provider.ensureToken(30)).resolves.toBe(false)

    const unsubscribe = provider.onAuthChanged(() => {
      throw new Error('unsupported provider must never emit auth changes')
    })
    expect(() => unsubscribe()).not.toThrow()

    expect(native.calls).toEqual([])
    expect(kcInstances.length).toBe(0)
    expect(window.wotbtoolsOnAuthChanged).toBeUndefined()
    expect(window.location.href).toBe(hrefBefore)
  })
})
