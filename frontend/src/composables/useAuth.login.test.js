// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

const kcLogin = vi.fn(() => Promise.resolve(true))
const kcLogout = vi.fn(() => Promise.resolve(undefined))
const kcUpdateToken = vi.fn(() => Promise.resolve(false))
const kcInit = vi.fn()
const kcInstances = []

/**
 * keycloak-js 替身 scenario：
 * - `initResult` 同时决定 init() 的 resolve 值与落定后的 `adapter.authenticated`
 *   （真实 keycloak-js 中两者同源：check-sso 命中 → true + tokenParsed）；
 * - `initImpl` 覆盖 init 返回的 promise，用于悬挂 / reject 场景；
 * - `tokenParsed` 是 check-sso 命中时 adapter 上的 claims。
 */
const kcScenario = {
  initResult: false,
  tokenParsed: null,
  initImpl: null,
}

vi.mock('keycloak-js', () => ({
  default: class {
    constructor(config) {
      this.config = config
      this.authenticated = false
      this.tokenParsed = null
      this.token = 'kc-access-token'
      kcInstances.push(this)
    }
    init = (options) => {
      kcInit(options)
      const returnUrl = new URL(location.href)
      const settle = (value) => {
        this.authenticated = value === true
        this.tokenParsed = value === true ? kcScenario.tokenParsed : null
        // A query-looking return cannot match the SDK's default fragment callback.
        if (!this.authenticated && options.onLoad && returnUrl.searchParams.has('state')
          && !new URLSearchParams(returnUrl.hash.slice(1)).has('state')) this.login()
        return value
      }
      if (kcScenario.initImpl) return Promise.resolve(kcScenario.initImpl()).then(settle)
      return Promise.resolve(kcScenario.initResult).then(settle)
    }
    login = kcLogin
    logout = kcLogout
    updateToken = kcUpdateToken
  },
}))

import { useAuth } from './useAuth.js'
import { androidBridge } from '../test/useAuthTestHelpers.js'

describe('useAuth — login destinations', () => {
  afterEach(() => {
    vi.useRealTimers()
    delete window.WotbNative
    delete window.wotbtoolsOnAuthChanged
    kcInit.mockClear()
    kcLogin.mockReset().mockImplementation(() => Promise.resolve(true))
    kcLogout.mockReset().mockImplementation(() => Promise.resolve(undefined))
    kcUpdateToken.mockReset().mockImplementation(() => Promise.resolve(false))
    kcScenario.initResult = false
    kcScenario.tokenParsed = null
    kcScenario.initImpl = null
  })

  it('login(view) 在浏览器里带 ?view= 回到本页，且不注入 idpHint', async () => {
    const auth = useAuth()
    await auth.retryAuth()

    await auth.login('profile')

    expect(kcLogin).toHaveBeenCalledWith(expect.objectContaining({
      redirectUri: expect.stringContaining('view=profile'),
    }))
    expect(kcLogin).not.toHaveBeenCalledWith(
      expect.objectContaining({ idpHint: expect.any(String) }))
  })

  it('same capability login preserves query and hash; changing destination drops unrelated context', async () => {
    const auth = useAuth()
    await auth.retryAuth()
    window.history.replaceState({}, '', '/?view=agent-replay&replay=abc#selected')
    try {
      await auth.login('agent-replay')
      expect(new URL(kcLogin.mock.calls.at(-1)[0].redirectUri).searchParams.get('replay')).toBe('abc')
      expect(new URL(kcLogin.mock.calls.at(-1)[0].redirectUri).hash).toBe('#selected')
      await auth.login('profile')
      expect(new URL(kcLogin.mock.calls.at(-1)[0].redirectUri).search).toBe('?view=profile')
    } finally {
      window.history.replaceState({}, '', '/')
    }
  })

  it('explicit query-return recovery removes OIDC parameters from the new redirect and preserves product context', async () => {
    history.replaceState(null, '', '/?view=profile&tank=13825&state=old-state&code=old-code&session_state=old-session&iss=old-issuer#details')
    try {
      const auth = useAuth()
      await auth.retryAuth()
      expect(auth.authInitState.value).toBe('failed')
      await auth.login('profile')
      const redirect = new URL(kcLogin.mock.calls.at(-1)[0].redirectUri)
      expect(Object.fromEntries(redirect.searchParams)).toEqual({ view: 'profile', tank: '13825' })
      expect(redirect.hash).toBe('#details')
      expect(kcInit.mock.calls.at(-1)[0]).not.toHaveProperty('onLoad')
    } finally {
      history.replaceState(null, '', '/')
    }
  })

  it('login accepts a full armor scene location without losing any scene query', async () => {
    const auth = useAuth()
    await auth.retryAuth()
    const query = {
      view: 'agent-armor', tank: '13825', shooter: '19969', config: '1', scfg: '0', shell: '0',
      shot: '2', world: '1', heatmap: '1', az: '45', h: '6', d: '12',
    }
    await auth.login({ path: '/', query, hash: '#shot' })
    const redirect = new URL(kcLogin.mock.calls.at(-1)[0].redirectUri)
    expect(Object.fromEntries(redirect.searchParams)).toEqual(query)
    expect(redirect.hash).toBe('#shot')
    expect(redirect.origin).toBe(window.location.origin)
  })

  it('login rejects an external destination before handing it to the provider', async () => {
    const auth = useAuth()
    await auth.retryAuth()
    await expect(auth.login({ path: 'https://external.example/' })).rejects.toThrow('AUTH_REDIRECT_ORIGIN_MISMATCH')
    expect(kcLogin).not.toHaveBeenCalled()
    expect(auth.loginInFlight.value).toBe(false)
  })

  it('Android login() 走 native external user-agent：不导航 WebView、不构造 keycloak-js', async () => {
    const keycloakBefore = kcInstances.length
    const native = androidBridge({ authLogin: true })
    const hrefBefore = window.location.href
    const auth = useAuth()
    await auth.retryAuth()

    await expect(auth.login('profile')).resolves.toBe(true)

    expect(native.calls.at(-1)).toEqual({ method: 'authLogin', params: { locale: 'zh' } })
    expect(window.location.href).toBe(hrefBefore)
    expect(kcInstances.length).toBe(keycloakBefore)
    expect(kcInit).not.toHaveBeenCalled()
  })

  it('login() 只对「同一进行中的 redirect」去重，失败/取消后必须能重新发起', async () => {
    const auth = useAuth()
    await auth.retryAuth()

    let rejectFirst
    kcLogin.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject }))
    const first = auth.login('replay')
    await vi.waitFor(() => expect(auth.loginInFlight.value).toBe(true))

    // 同一个进行中的 redirect：不重复发起（不产生第二次导航）
    await expect(auth.login('replay')).resolves.toBe(false)

    rejectFirst(new Error('AUTH_NAVIGATION_FAILED'))
    await expect(first).rejects.toThrow('AUTH_NAVIGATION_FAILED')
    // 不是 component-lifetime 锁：失败后必须回到可重试状态
    expect(auth.loginInFlight.value).toBe(false)

    kcLogin.mockImplementationOnce(() => Promise.resolve(true))
    await expect(auth.login('ai-review')).resolves.toBe(true)
    expect(kcLogin).toHaveBeenLastCalledWith(expect.objectContaining({
      redirectUri: expect.stringContaining('view=ai-review'),
    }))
    expect(auth.loginInFlight.value).toBe(false)
  })
})
