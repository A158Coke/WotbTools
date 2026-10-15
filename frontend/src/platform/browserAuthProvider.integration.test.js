// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import Keycloak from 'keycloak-js'
import { createBrowserAuthProvider } from './browserAuthProvider.js'

// Use the installed SDK and its actual callback store/PKCE/nonce handling. Only HTTP is fake.
const config = { url: 'https://auth.wotbtools.com', realm: 'wotbtools', clientId: 'wotbtools-web' }
const requests = []
let nonce = ''
let invalidNonce = false
function jwt(claims) {
  return [btoa('{}'), btoa(JSON.stringify(claims)), 'fixture-signature'].join('.')
}
class TokenRequest {
  open(method, url) { this.method = method; this.url = url }
  setRequestHeader() {}
  send(body) {
    requests.push({ method: this.method, url: this.url, body })
    queueMicrotask(() => {
      const claims = { sub: 'fixture-user', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 }
      this.status = 200
      this.readyState = 4
      this.responseText = JSON.stringify({ access_token: jwt(claims), refresh_token: jwt(claims),
        id_token: jwt({ ...claims, nonce: invalidNonce ? 'wrong-nonce' : nonce }) })
      this.onreadystatechange()
    })
  }
}

async function startLogin(options = {}) {
  const sdk = new Keycloak(config)
  await sdk.init({ pkceMethod: 'S256', checkLoginIframe: false })
  const url = new URL(await sdk.createLoginUrl({ redirectUri: `${window.location.origin}/?view=profile`, ...options }))
  nonce = url.searchParams.get('nonce')
  return url.searchParams.get('state')
}
function returnToSite(state, result = 'code=fixture-code') {
  history.replaceState(null, '', `/?view=profile#state=${state}&${result}`)
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('XMLHttpRequest', TokenRequest)
  history.replaceState(null, '', '/')
  localStorage.clear()
  requests.length = 0
  nonce = ''
  invalidNonce = false
})
afterEach(() => {
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
  localStorage.clear()
  document.querySelectorAll('iframe').forEach(frame => frame.remove())
})

describe('browser callback recovery with real keycloak-js', () => {
  it('same browser/new tab consumes the shared callback store and exchanges with PKCE', async () => {
    const state = await startLogin()
    returnToSite(state)
    const provider = createBrowserAuthProvider()
    await provider.init({ mode: 'normal' })
    expect(provider.authenticated).toBe(true)
    expect(provider.tokenParsed.sub).toBe('fixture-user')
    expect(window.location.hash).toBe('')
    expect(requests).toHaveLength(1)
    const body = new URLSearchParams(requests[0].body)
    expect(body.get('code')).toBe('fixture-code')
    expect(body.get('code_verifier')).toBeTruthy()
    expect(requests[0].url).toBe(`${config.url}/realms/wotbtools/protocol/openid-connect/token`)
  })

  it('a matching prompt=none login_required return completes as signed out', async () => {
    returnToSite(await startLogin({ prompt: 'none' }), 'error=login_required')
    const provider = createBrowserAuthProvider()
    await expect(provider.init({ mode: 'normal' })).resolves.toBeUndefined()
    expect(provider.authenticated).toBe(false)
    expect(provider.token()).toBe('')
    expect(window.location.hash).toBe('')
    expect(requests).toHaveLength(0)
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('login_required from an interactive transaction remains rejected by the SDK', async () => {
    returnToSite(await startLogin(), 'error=login_required')
    const provider = createBrowserAuthProvider()
    await expect(provider.init({ mode: 'normal' })).rejects.toMatchObject({ error: 'login_required' })
    expect(provider.authenticated).toBe(false)
    expect(window.location.hash).toBe('')
    expect(requests).toHaveLength(0)
  })

  it('login_required without the original transaction cannot masquerade as a signed-out probe', async () => {
    returnToSite('not-in-this-browser', 'error=login_required')
    const provider = createBrowserAuthProvider()
    await expect(provider.init({ mode: 'normal' })).rejects.toMatchObject({ code: 'AUTH_RETURN_NOT_COMPLETED' })
    expect(provider.authenticated).toBe(false)
    expect(window.location.hash).toBe('')
    expect(requests).toHaveLength(0)
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('missing state cannot use receiver SSO: no code exchange or check-sso iframe', async () => {
    returnToSite('not-in-this-browser')
    const provider = createBrowserAuthProvider()
    await expect(provider.init({ mode: 'normal' })).rejects.toMatchObject({ code: 'AUTH_RETURN_NOT_COMPLETED' })
    expect(provider.authenticated).toBe(false)
    expect(provider.token()).toBe('')
    expect(requests).toHaveLength(0)
    expect(document.querySelector('iframe')).toBeNull()
    expect(window.location.hash).toBe('')
    // Explicit retry starts a fresh S256 transaction in this browser; it does not reuse the rejected state.
    const freshState = await startLogin()
    expect(freshState).not.toBe('not-in-this-browser')
    returnToSite(freshState)
    const retry = createBrowserAuthProvider()
    await retry.init({ mode: 'normal' })
    expect(retry.authenticated).toBe(true)
  })

  it('nonce mismatch remains rejected', async () => {
    returnToSite(await startLogin())
    invalidNonce = true
    const provider = createBrowserAuthProvider()
    await expect(provider.init({ mode: 'normal' })).rejects.toBeUndefined()
    expect(provider.authenticated).toBe(false)
    expect(provider.token()).toBe('')
  })

  it('an expired interactive return fails without the SDK restarting authorization', async () => {
    returnToSite(await startLogin(), 'error=login_required&error_description=authentication_expired')
    const provider = createBrowserAuthProvider()
    await expect(provider.init({ mode: 'normal' })).rejects.toMatchObject({ code: 'AUTH_RETURN_NOT_COMPLETED' })
    expect(provider.authenticated).toBe(false)
    expect(window.location.hash).toBe('')
    expect(requests).toHaveLength(0)
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('cancelled authorization remains rejected and permits a new transaction', async () => {
    returnToSite(await startLogin(), 'error=access_denied')
    const provider = createBrowserAuthProvider()
    await expect(provider.init({ mode: 'normal' })).rejects.toMatchObject({ error: 'access_denied' })
    expect(requests).toHaveLength(0)
    expect(provider.authenticated).toBe(false)
    returnToSite(await startLogin())
    const retry = createBrowserAuthProvider()
    await retry.init({ mode: 'normal' })
    expect(retry.authenticated).toBe(true)
  })

  it('an unsupported query return permits explicit recovery without exchanging its code or checking SSO', async () => {
    history.replaceState(null, '', '/?view=profile&state=unmatched-query&code=old-code')
    const normal = createBrowserAuthProvider()
    await expect(normal.init({ mode: 'normal' })).rejects.toMatchObject({ code: 'AUTH_RETURN_NOT_COMPLETED' })
    const recovery = createBrowserAuthProvider()
    await expect(recovery.init({ mode: 'login-recovery' })).resolves.toBeUndefined()
    expect(recovery.authenticated).toBe(false)
    expect(requests).toHaveLength(0)
    expect(document.querySelector('iframe')).toBeNull()
    const state = await startLogin()
    expect(state).not.toBe('unmatched-query')
    returnToSite(state)
    const returned = createBrowserAuthProvider()
    await returned.init({ mode: 'normal' })
    expect(returned.authenticated).toBe(true)
    expect(new URLSearchParams(requests[0].body).get('code_verifier')).toBeTruthy()
  })

})
