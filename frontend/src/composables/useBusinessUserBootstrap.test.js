import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectivityState } from '../platform/connectivity.js'
import { businessProfileAvailability, resetBusinessUserBootstrap, shouldEnsureBusinessUser, useBusinessUserBootstrap } from './useBusinessUserBootstrap.js'

vi.mock('../utils/api-user.js', () => ({
  ensureUserProfile: vi.fn(async () => ({})),
}))

const { ensureUserProfile } = await import('../utils/api-user.js')

/**
 * 业务用户 bootstrap 的**离线准入**（PR B review blocker）。
 *
 * 原则：profile ensure 是一次 backend 调用，准入必须来自 capability SSOT
 * （`Feature.ACCOUNT_PROFILE` 是 ONLINE_REQUIRED），而不是散落的 `connectivity === 'online'`。
 * 只有 online 才允许；offline / unknown / degraded / service-unavailable 一律不发请求。
 */
describe('business profile bootstrap policy', () => {
  it('allows the backend call only when authenticated AND the profile feature is available', () => {
    expect(shouldEnsureBusinessUser({
      authInitState: 'authenticated',
      authenticated: true,
      connectivity: ConnectivityState.ONLINE,
    })).toBe(true)
  })

  it('never allows the backend call for offline / unknown / degraded / service-unavailable', () => {
    for (const connectivity of [
      ConnectivityState.OFFLINE,
      ConnectivityState.UNKNOWN,
      ConnectivityState.DEGRADED,
      ConnectivityState.SERVICE_UNAVAILABLE,
      'nonsense',
      undefined,
    ]) {
      expect(shouldEnsureBusinessUser({
        authInitState: 'authenticated',
        authenticated: true,
        connectivity,
      }), String(connectivity)).toBe(false)
    }
  })

  it('never allows the backend call while unauthenticated', () => {
    for (const authInitState of ['idle', 'initializing', 'unauthenticated', 'authenticated']) {
      for (const authenticated of [false, undefined]) {
        expect(shouldEnsureBusinessUser({
          authInitState,
          authenticated,
          connectivity: ConnectivityState.ONLINE,
        }), `${authInitState}/${authenticated}`).toBe(false)
      }
    }
  })

  it('derives the gate from the capability model (ACCOUNT_PROFILE is ONLINE_REQUIRED)', () => {
    expect(businessProfileAvailability(ConnectivityState.ONLINE).available).toBe(true)
    const offline = businessProfileAvailability(ConnectivityState.OFFLINE)
    expect(offline.available).toBe(false)
    expect(offline.requirement).toBe('online-required')
    // unknown 不是「离线」，但同样不可用（且文案与 offline 不同）。
    const unknown = businessProfileAvailability(ConnectivityState.UNKNOWN)
    expect(unknown.available).toBe(false)
    expect(unknown.messageKey).toBe('connectivityNotice.unknown')
  })
})

/**
 * AppShell 的 watch 逻辑 = 「策略 + ensure 去重」。这里用一个最小的 driver 复现它，
 * 从而在不挂载 Vue 的前提下验证「online 才触发、且只触发一次」。
 */
describe('business profile bootstrap driver (policy + dedupe)', () => {
  afterEach(() => {
    resetBusinessUserBootstrap()
    vi.mocked(ensureUserProfile).mockClear()
  })

  /** 复现 AppShell 的 watch 回调：只有策略允许才 ensure。 */
  async function drive({ authInitState, authenticated, connectivity }) {
    if (!shouldEnsureBusinessUser({ authInitState, authenticated, connectivity })) return null
    return useBusinessUserBootstrap().ensure()
  }

  it('authenticated + online → ensure runs exactly once', async () => {
    await drive({ authInitState: 'authenticated', authenticated: true, connectivity: ConnectivityState.ONLINE })
    expect(ensureUserProfile).toHaveBeenCalledTimes(1)
  })

  it('authenticated + offline → no backend request at all', async () => {
    await drive({ authInitState: 'authenticated', authenticated: true, connectivity: ConnectivityState.OFFLINE })
    expect(ensureUserProfile).not.toHaveBeenCalled()
    expect(useBusinessUserBootstrap().failed.value).toBe(false)
  })

  it('unauthenticated + online → no backend request', async () => {
    await drive({ authInitState: 'unauthenticated', authenticated: false, connectivity: ConnectivityState.ONLINE })
    expect(ensureUserProfile).not.toHaveBeenCalled()
  })

  it('offline → online while authenticated → ensure exactly once (no restart, no retry loop)', async () => {
    await drive({ authInitState: 'authenticated', authenticated: true, connectivity: ConnectivityState.OFFLINE })
    expect(ensureUserProfile).not.toHaveBeenCalled()

    await drive({ authInitState: 'authenticated', authenticated: true, connectivity: ConnectivityState.ONLINE })
    expect(ensureUserProfile).toHaveBeenCalledTimes(1)

    // 之后重复的 online 通知（推送抖动）不得再发第二次请求：ready 去重生效。
    await drive({ authInitState: 'authenticated', authenticated: true, connectivity: ConnectivityState.ONLINE })
    await drive({ authInitState: 'authenticated', authenticated: true, connectivity: ConnectivityState.ONLINE })
    expect(ensureUserProfile).toHaveBeenCalledTimes(1)
  })

  it('online → offline → online does not re-request an already ready profile', async () => {
    await drive({ authInitState: 'authenticated', authenticated: true, connectivity: ConnectivityState.ONLINE })
    await drive({ authInitState: 'authenticated', authenticated: true, connectivity: ConnectivityState.OFFLINE })
    await drive({ authInitState: 'authenticated', authenticated: true, connectivity: ConnectivityState.ONLINE })
    expect(ensureUserProfile).toHaveBeenCalledTimes(1)
  })

  it('concurrent triggers share one in-flight request', async () => {
    const bootstrap = useBusinessUserBootstrap()
    await Promise.all([bootstrap.ensure(), bootstrap.ensure(), bootstrap.ensure()])
    expect(ensureUserProfile).toHaveBeenCalledTimes(1)
  })

  it('offline cold start never fabricates a failure state', async () => {
    // 冷启动流程：init 之前先收到 offline（Airplane mode）。
    await drive({ authInitState: 'idle', authenticated: false, connectivity: ConnectivityState.OFFLINE })
    await drive({ authInitState: 'authenticated', authenticated: true, connectivity: ConnectivityState.OFFLINE })
    const bootstrap = useBusinessUserBootstrap()
    expect(bootstrap.failed.value).toBe(false)
    expect(bootstrap.state.value).toBe('idle')
    expect(ensureUserProfile).not.toHaveBeenCalled()
  })
})

/**
 * 浏览器交互 harness 用 alias 把本模块替换成 `scripts/browser-fixtures/use-business-user-bootstrap-stub.js`。
 * 只要真实模块新增一个被 AppShell 使用的导出而 fixture 没跟上，整个 mobile 交互回归会因为
 * `does not provide an export named ...` 直接挂掉（PR #467 上真实发生过）。这里把「两个文件导出面一致」
 * 变成确定性断言。
 */
describe('browser-interaction stub surface', () => {
  it('exports every named export the real module provides', async () => {
    const real = await readFile(new URL('./useBusinessUserBootstrap.js', import.meta.url), 'utf8')
    const stub = await readFile(
      new URL('../../scripts/browser-fixtures/use-business-user-bootstrap-stub.js', import.meta.url), 'utf8')
    const names = source => (source.match(/export (?:async )?function (\w+)/g) || [])
      .map(match => match.replace(/export (?:async )?function /, ''))
    const realNames = names(real).sort()
    expect(realNames.length).toBeGreaterThan(0)
    expect(names(stub).sort()).toEqual(expect.arrayContaining(realNames))
  })
})
