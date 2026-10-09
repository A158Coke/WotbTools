// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const scenario = vi.hoisted(() => ({ init: null, received: null, calls: 0, authOwner: null, pending: [] }))
vi.mock('keycloak-js', () => ({
  default: class {
    authenticated = false
    async init() {
      scenario.calls++
      scenario.received = { search: location.search, hash: location.hash }
      // The adapter owns callback consumption; the application must not rewrite it first.
      const url = new URL(location.href)
      if (new URLSearchParams(url.hash.slice(1)).has('state')) url.hash = ''
      history.replaceState(history.state, '', url)
      this.authenticated = await scenario.init()
    }
  },
}))
vi.mock('./app/AppShell.vue', async () => {
  const { defineComponent, h } = await import('vue')
  const { RouterView } = await import('vue-router')
  return { default: defineComponent({
    setup() {
      const auth = scenario.authOwner()
      return () => h('main', { 'data-testid': 'public-shell', 'data-auth': auth.authInitState.value }, h(RouterView))
    },
  }) }
})
vi.mock('./app/ViewHost.vue', () => ({ default: { template: '<p>Public tool</p>' } }))
vi.mock('./locales/messages.js', () => ({ messages: { zh: { nav: { replay: 'Replay', hof: 'HoF', home: 'Home' } } } }))

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  const pending = { promise, resolve, reject }
  scenario.pending.push(pending)
  return pending
}
const shell = () => document.querySelector('[data-testid="public-shell"]')
const aliases = [['reconstruction', 'battle-playback'], ['extended', 'replay'], ['leaderboard', 'hof']]

beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('__BUILD_COMMIT__', 'test')
  vi.stubGlobal('__BUILD_TIME__', 'test')
  document.body.innerHTML = '<div id="app"></div>'
  history.replaceState(null, '', '/?view=profile')
  localStorage.clear()
  scenario.received = null
  scenario.calls = 0
  scenario.init = () => Promise.resolve(false)
  scenario.pending = []
  scenario.authOwner = (await import('./composables/useAuth.js')).useAuth
})
afterEach(async () => {
  scenario.pending.forEach(pending => pending.resolve(false))
  await vi.dynamicImportSettled()
  const app = document.querySelector('#app')?.__vue_app__
  app?.unmount()
  const { default: router } = await import('./app/router.js')
  router.options.history.destroy()
  delete window.WotbNative
  delete window.wotbtoolsOnAuthChanged
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('application startup preserves the authentication callback', () => {
  it.each(aliases)('%s consumes the original callback before canonicalizing to %s', async (legacy, canonical) => {
    const callback = '#state=fixture-state&code=fixture-code&session_state=fixture-session'
    history.replaceState(null, '', `/?view=${legacy}&tank=13825${callback}`)
    const pending = deferred()
    scenario.init = () => pending.promise
    await import('./main.js')
    await vi.waitFor(() => expect(scenario.calls).toBe(1))
    expect(scenario.received.hash).toBe(callback)
    expect(location.search).toContain(`view=${legacy}`)
    expect(shell()).toBeNull()
    pending.resolve(true)
    await vi.waitFor(() => expect(shell()?.dataset.auth).toBe('authenticated'))
    const { default: router } = await import('./app/router.js')
    expect(router.currentRoute.value.query).toEqual({ view: canonical, tank: '13825' })
    expect(router.currentRoute.value.hash).toBe('')
    expect(location.hash).toBe('')
    expect(scenario.calls).toBe(1)
  })

  it('waits on a query-looking return without adding SDK query-mode support', async () => {
    history.replaceState(null, '', '/?view=extended&tank=13825&state=fixture-state&code=fixture-code#details')
    const pending = deferred()
    scenario.init = () => pending.promise
    await import('./main.js')
    await vi.waitFor(() => expect(scenario.calls).toBe(1))
    expect(scenario.received.search).toContain('code=fixture-code')
    expect(location.search).toContain('view=extended')
    pending.resolve(false)
    await vi.waitFor(() => expect(shell()?.dataset.auth).toBe('unauthenticated'))
    expect(new URLSearchParams(location.search).get('code')).toBe('fixture-code')
    expect(new URLSearchParams(location.search).get('state')).toBe('fixture-state')
    expect(new URLSearchParams(location.search).get('tank')).toBe('13825')
    expect(location.hash).toBe('#details')
  })

  it('handles an error return and mounts the existing failed-auth UI after rejection', async () => {
    history.replaceState(null, '', '/?view=reconstruction#state=fixture-state&error=access_denied')
    const pending = deferred()
    scenario.init = () => pending.promise
    await import('./main.js')
    await vi.waitFor(() => expect(scenario.calls).toBe(1))
    expect(scenario.received.hash).toContain('error=access_denied')
    pending.reject(new Error('fixture-auth-failure'))
    await vi.waitFor(() => expect(shell()?.dataset.auth).toBe('failed'))
    expect(new URLSearchParams(location.search).get('view')).toBe('battle-playback')
  })

  it('mounts after the existing callback watchdog and ignores a late successful init', async () => {
    vi.useFakeTimers()
    history.replaceState(null, '', '/?view=extended#state=fixture-state&code=fixture-code')
    const pending = deferred()
    scenario.init = () => pending.promise
    await import('./main.js')
    await vi.waitFor(() => expect(scenario.calls).toBe(1))
    expect(shell()).toBeNull()
    await vi.advanceTimersByTimeAsync(12_000)
    await vi.waitFor(() => expect(shell()?.dataset.auth).toBe('failed'))
    pending.resolve(true)
    await vi.dynamicImportSettled()
    const { useAuth } = await import('./composables/useAuth.js')
    expect(useAuth().authenticated.value).toBe(false)
    const { default: router } = await import('./app/router.js')
    expect(router.currentRoute.value.hash).toBe('')
    expect(location.hash).toBe('')
  })

  it('does not block an anonymous public page on a slow SSO check', async () => {
    vi.useFakeTimers()
    const pending = deferred()
    scenario.init = () => pending.promise
    history.replaceState(null, '', '/?view=extended#details')
    await import('./main.js')
    await vi.waitFor(() => expect(shell()?.dataset.auth).toBe('initializing'))
    expect(new URLSearchParams(location.search).get('view')).toBe('replay')
    expect(location.hash).toBe('#details')
    pending.resolve(false)
    await vi.waitFor(() => expect(shell()?.dataset.auth).toBe('unauthenticated'))
  })

  it('does not rewrite the localhost Home preview until the callback has been consumed', async () => {
    history.replaceState(null, '', '/#state=fixture-state&code=fixture-code')
    const pending = deferred()
    scenario.init = () => pending.promise
    await import('./main.js')
    await vi.waitFor(() => expect(scenario.calls).toBe(1))
    expect(location.search).toBe('')
    pending.resolve(true)
    await vi.waitFor(() => expect(shell()?.dataset.auth).toBe('authenticated'))
    expect(new URLSearchParams(location.search).get('view')).toBe('home')
    expect(location.hash).toBe('')
  })

  it('mounts the APK shell during a slow Native init without constructing keycloak-js', async () => {
    vi.useFakeTimers()
    const replies = []
    const listeners = new Set()
    window.WotbNative = {
      addEventListener: (_, listener) => listeners.add(listener),
      removeEventListener: (_, listener) => listeners.delete(listener),
      postMessage(json) {
        const message = JSON.parse(json)
        const result = message.method === 'getBridgeVersion' ? 2
          : message.method === 'getCapabilities' ? ['native-auth'] : null
        const reply = () => listeners.forEach(listener => listener({ data: { id: message.id, result } }))
        if (message.method === 'authGetState') replies.push(reply)
        else reply()
      },
    }
    // Even a callback-looking URL in WebView must stay with the Native auth owner.
    history.replaceState(null, '', '/?view=extended#state=fixture-state&code=fixture-code')
    await import('./main.js')
    await vi.waitFor(() => expect(shell()?.dataset.auth).toBe('initializing'))
    expect(scenario.calls).toBe(0)
    expect(location.hash).toContain('code=fixture-code')
    replies.forEach(reply => reply())
    await vi.waitFor(() => expect(shell()?.dataset.auth).toBe('unauthenticated'))
  })
})
