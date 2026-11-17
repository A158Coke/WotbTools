import { vi } from 'vitest'

const ADMIN_CLAIMS = Object.freeze({
  displayName: 'A158布丁',
  realm_access: { roles: ['wotbtools-admin'] },
})
const USER_CLAIMS = Object.freeze({
  displayName: 'CN Player',
  realm_access: { roles: ['wotbtools-user'] },
})

/** 模拟 origin-scoped bridge：postMessage → native reply → 'message' 事件（同 id）。 */
function stubNative(results = {}) {
  const listeners = []
  const calls = []
  window.WotbNative = {
    postMessage: vi.fn((json) => {
      const msg = JSON.parse(json)
      calls.push({ method: msg.method, params: msg.params })
      listeners.forEach(cb =>
        cb({ data: JSON.stringify({ id: msg.id, result: results[msg.method] ?? null }) })
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

function androidBridge(overrides = {}) {
  return stubNative({
    getBridgeVersion: 4,
    getCapabilities: ['native-auth'],
    authGetState: { authenticated: false, expiresAt: null },
    ...overrides,
  })
}

export { ADMIN_CLAIMS, USER_CLAIMS, androidBridge, stubNative }
