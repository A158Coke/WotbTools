// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

const kcInit = vi.fn()
const kcLogin = vi.fn(() => Promise.resolve(true))
const kcLogout = vi.fn(() => Promise.resolve(undefined))
const kcUpdateToken = vi.fn(() => Promise.resolve(false))
const kcInstances = []

vi.mock('keycloak-js', () => ({
  default: class {
    constructor(config) {
      this.config = config
      this.authenticated = false
      this.tokenParsed = null
      this.token = ''
      kcInstances.push(this)
    }
    init = (options) => {
      kcInit(options)
      return Promise.resolve(true)
    }
    login = kcLogin
    logout = kcLogout
    updateToken = kcUpdateToken
  },
}))

import { createBrowserAuthProvider } from './browserAuthProvider.js'

function lastAdapter() {
  return kcInstances.at(-1)
}

describe('browserAuthProvider', () => {
  afterEach(() => {
    kcInit.mockClear()
    kcLogin.mockReset().mockImplementation(() => Promise.resolve(true))
    kcLogout.mockReset().mockImplementation(() => Promise.resolve(undefined))
    kcUpdateToken.mockReset().mockImplementation(() => Promise.resolve(false))
  })

  it('使用生产 Keycloak issuer 配置，并保持 check-sso（未登录不跳转）语义', async () => {
    const provider = createBrowserAuthProvider()

    await provider.init({ mode: 'normal' })

    expect(provider.name).toBe('web')
    expect(lastAdapter().config).toEqual({
      url: 'https://auth.wotbtools.com',
      realm: 'wotbtools',
      clientId: 'wotbtools-web',
    })
    expect(kcInit).toHaveBeenCalledTimes(1)
    expect(kcInit).toHaveBeenCalledWith({
      onLoad: 'check-sso',
      pkceMethod: 'S256',
      silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
      checkLoginIframe: false,
    })
  })

  it('login-recovery 重建 adapter 时不再重复 check-sso bootstrap', async () => {
    const provider = createBrowserAuthProvider()

    await provider.init({ mode: 'login-recovery' })

    expect(kcInit).toHaveBeenCalledWith({ pkceMethod: 'S256', checkLoginIframe: false })
    expect(kcInit.mock.calls[0][0]).not.toHaveProperty('onLoad')
  })

  it('authenticated / tokenParsed / token 读取当前 adapter', async () => {
    const provider = createBrowserAuthProvider()
    await provider.init({ mode: 'normal' })

    expect(provider.authenticated).toBe(false)
    expect(provider.tokenParsed).toBe(null)
    expect(provider.token()).toBe('')

    lastAdapter().authenticated = true
    lastAdapter().tokenParsed = { displayName: 'A158布丁' }
    lastAdapter().token = 'access-token'

    expect(provider.authenticated).toBe(true)
    expect(provider.tokenParsed).toEqual({ displayName: 'A158布丁' })
    expect(provider.token()).toBe('access-token')
  })

  it('login(redirectUri) / logout(redirectUri) 原样透传 redirect 参数', async () => {
    const provider = createBrowserAuthProvider()

    await expect(provider.login('https://wotbtools.com/?view=profile')).resolves.toBe(true)
    expect(kcLogin).toHaveBeenCalledWith({ redirectUri: 'https://wotbtools.com/?view=profile' })

    await provider.logout('https://wotbtools.com/profile')
    expect(kcLogout).toHaveBeenCalledWith({ redirectUri: 'https://wotbtools.com/profile' })
  })

  it('ensureToken 未登录时不刷新，直接 false', async () => {
    const provider = createBrowserAuthProvider()
    await provider.init({ mode: 'normal' })

    await expect(provider.ensureToken(30)).resolves.toBe(false)
    expect(kcUpdateToken).not.toHaveBeenCalled()
  })

  it('ensureToken 调用 updateToken(minValidity) 并在成功时返回 true', async () => {
    const provider = createBrowserAuthProvider()
    await provider.init({ mode: 'normal' })
    lastAdapter().authenticated = true
    lastAdapter().tokenParsed = { displayName: 'refreshed' }
    kcUpdateToken.mockResolvedValueOnce(true)

    await expect(provider.ensureToken(45)).resolves.toBe(true)

    expect(kcUpdateToken).toHaveBeenCalledWith(45)
    expect(provider.tokenParsed).toEqual({ displayName: 'refreshed' })
  })

  it('ensureToken 瞬时刷新失败时保留 session、隐藏旧 token，并允许下一次重试恢复', async () => {
    const provider = createBrowserAuthProvider()
    await provider.init({ mode: 'normal' })
    lastAdapter().authenticated = true
    lastAdapter().token = 'old-access-token'
    kcUpdateToken.mockRejectedValueOnce(new Error('refresh failed'))

    await expect(provider.ensureToken(30)).resolves.toBe(false)
    expect(provider.authenticated).toBe(true)
    expect(provider.token()).toBe('')

    lastAdapter().token = 'fresh-access-token'
    kcUpdateToken.mockResolvedValueOnce(true)
    await expect(provider.ensureToken(30)).resolves.toBe(true)
    expect(provider.authenticated).toBe(true)
    expect(provider.token()).toBe('fresh-access-token')
  })

  it('onAuthChanged 是 no-op（浏览器没有 Native 推送，也不设任何全局）', async () => {
    const provider = createBrowserAuthProvider()
    const unsubscribe = provider.onAuthChanged(() => {
      throw new Error('browser provider must never emit auth changes')
    })

    expect(typeof unsubscribe).toBe('function')
    expect(() => unsubscribe()).not.toThrow()
    expect(window.wotbtoolsOnAuthChanged).toBeUndefined()
  })

  it('每代 transaction 都是独立 adapter：被放弃的一代无法写回新状态', async () => {
    const abandoned = createBrowserAuthProvider()
    await abandoned.init({ mode: 'normal' })
    const abandonedAdapter = lastAdapter()
    abandonedAdapter.authenticated = true
    abandonedAdapter.tokenParsed = { displayName: 'stale' }

    // retry / login-recovery 会新建 provider，因此拿到全新 adapter（不复用被放弃的实例）。
    const current = createBrowserAuthProvider()
    await current.init({ mode: 'login-recovery' })

    expect(lastAdapter()).not.toBe(abandonedAdapter)
    expect(current.authenticated).toBe(false)
    expect(current.tokenParsed).toBe(null)
    // 旧 provider 仍指向自己的 adapter，但它已不是任何 transaction 的 owner。
    expect(abandoned.authenticated).toBe(true)
  })
})
