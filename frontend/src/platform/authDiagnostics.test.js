// @vitest-environment happy-dom
/**
 * 认证诊断（2.1.0 Phase 2.5）的字段纪律与接线回归：
 *
 * `cookie_not_found` 取证的前提是诊断**存在且不泄密**。这里锁两件事：
 * 1. 事件里只出现布尔 / 枚举（URL 参数存在性、Keycloak 错误码），绝不复制参数值
 *    （code/state/token/cookie 值是 secrets，进了日志就等于泄漏）；
 * 2. browserAuthProvider 在**正确的时点**留下 breadcrumbs：login 跳转前、
 *    adapter init 之前（失败路径也留痕）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetAuthDiagnosticsForTest,
  errorCategory,
  record,
  recordLoginStart,
  recordReturnFacts,
  returnParamFacts,
  snapshot,
} from './authDiagnostics.js'

const consoleSpy = () => vi.spyOn(console, 'info').mockImplementation(() => {})

afterEach(() => {
  __resetAuthDiagnosticsForTest()
  vi.restoreAllMocks()
})

describe('returnParamFacts：只读存在性，绝不复制参数值', () => {
  it('成功回程：code/state/session_state 布尔为真，无错误', () => {
    const facts = returnParamFacts('?state=SECRET_STATE&session_state=SECRET&iss=https%3A%2F%2Fauth.wotbtools.com&code=SECRET_CODE')
    expect(facts).toEqual({
      hasCode: true, hasState: true, hasSessionState: true,
      hasError: false, error: 'none', hasIss: true,
    })
    // 快照里永远不出现参数值
    expect(JSON.stringify(facts)).not.toContain('SECRET')
  })

  it('错误回程：error 码（固定枚举）可见，code 缺席', () => {
    const facts = returnParamFacts('?error=identity_provider_login_failure&state=X')
    expect(facts.hasError).toBe(true)
    expect(facts.error).toBe('identity_provider_login_failure')
    expect(facts.hasCode).toBe(false)
  })

  it('普通首访（无 OIDC 参数）：全布尔为假，error=none', () => {
    expect(returnParamFacts('')).toEqual({
      hasCode: false, hasState: false, hasSessionState: false,
      hasError: false, error: 'none', hasIss: false,
    })
  })

  it('errorCategory：无 error 参数时为空串；多参数时只取 error 的值', () => {
    expect(errorCategory('')).toBe('')
    expect(errorCategory('?error=access_denied&other=1')).toBe('access_denied')
    expect(errorCategory('?other=1')).toBe('')
  })
})

describe('record / snapshot：环形缓冲 + console 输出', () => {
  it('快照按序保留事件并带 ISO 时间戳；超过 30 条挤掉最旧', () => {
    const spy = consoleSpy()
    for (let i = 0; i < 35; i++) record('probe', { seq: i })
    const snap = snapshot()
    expect(snap).toHaveLength(30)
    expect(snap[0].event).toBe('probe')
    expect(snap[0].seq).toBe(5)                       // 最旧的 5 条被挤出
    expect(Number.isNaN(Date.parse(snap[0].at))).toBe(false)
    expect(spy).toHaveBeenCalledTimes(35)
    const [, payload] = spy.mock.calls[0]
    expect(() => JSON.parse(payload)).not.toThrow()
  })

  it('序列化失败（循环引用等）静默丢弃，绝不反噬登录流程', () => {
    const spy = consoleSpy()
    const circular = {}
    circular.self = circular
    expect(() => record('bad', { circular })).not.toThrow()
    // 缓冲只收序列化成功的条目（快照永远是 JSON 安全的）
    expect(snapshot()).toHaveLength(0)
    expect(spy).toHaveBeenCalledTimes(0)
  })
})

describe('recordLoginStart：只记 view/路径，不记完整 URL', () => {
  it('带 view 的本站 URL 只落 view 名', () => {
    consoleSpy()
    recordLoginStart('https://wotbtools.com/?view=profile&lang=x')
    const [entry] = snapshot()
    expect(entry.event).toBe('login_started')
    expect(entry.destination).toBe('profile')
    expect(JSON.stringify(entry)).not.toContain('lang=x')
  })

  it('无 view（完整 router location）落路径', () => {
    consoleSpy()
    recordLoginStart('https://wotbtools.com/some/path?other=1')
    expect(snapshot()[0].destination).toBe('/some/path')
    expect(JSON.stringify(snapshot()[0])).not.toContain('other=1')
  })
})

describe('recordReturnFacts：默认读当前 URL（接线口径）', () => {
  it('从 window.location.search 取事实', () => {
    consoleSpy()
    window.history.replaceState({}, '', '/?code=c&state=s')
    try {
      recordReturnFacts()
      expect(snapshot()[0].event).toBe('return_facts')
      expect(snapshot()[0].hasCode).toBe(true)
    } finally {
      window.history.replaceState({}, '', '/')
    }
  })
})
