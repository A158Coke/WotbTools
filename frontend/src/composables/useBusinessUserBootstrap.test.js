import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectivityState } from '../platform/connectivity.js'
import {
  businessProfileAvailability,
  ensureBusinessUserIfAllowed,
  resetBusinessUserBootstrap,
  retryBusinessUserIfAllowed,
  shouldEnsureBusinessUser,
  useBusinessUserBootstrap,
  whenBusinessUserSettled,
} from './useBusinessUserBootstrap.js'

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
  async function drive(context) {
    // 真实调用点（AppShell watch）就是这样传 context 的。
    if (!shouldEnsureBusinessUser(context)) return null
    return useBusinessUserBootstrap().ensure(context)
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
    const context = { authInitState: 'authenticated', authenticated: true, connectivity: ConnectivityState.ONLINE }
    await Promise.all([bootstrap.ensure(context), bootstrap.ensure(context), bootstrap.ensure(context)])
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

/**
 * **每一个** backend bootstrap 入口都必须过连通性策略（PR #467 review blocker）。
 *
 * 真实缺陷：页面调用 `whenBusinessUserSettled()` 时，它内部会触发 ensure → ensureUserProfile，
 * 于是「已认证 + 离线 + 打开 Profile」照样发 backend 请求。这里把「offline / unknown /
 * degraded / service-unavailable 时任何入口都不得进入 run()」变成确定性断言。
 */
describe('business bootstrap entrypoints are connectivity-gated', () => {
  const offlineStates = [
    ConnectivityState.OFFLINE,
    ConnectivityState.UNKNOWN,
    ConnectivityState.DEGRADED,
    ConnectivityState.SERVICE_UNAVAILABLE,
  ]

  afterEach(() => {
    resetBusinessUserBootstrap()
    vi.mocked(ensureUserProfile).mockClear()
  })

  it('whenBusinessUserSettled never calls ensureUserProfile while backend is unavailable', async () => {
    for (const connectivity of offlineStates) {
      resetBusinessUserBootstrap()
      vi.mocked(ensureUserProfile).mockClear()
      const settled = await whenBusinessUserSettled({
        authInitState: 'authenticated',
        authenticated: true,
        connectivity,
      })
      expect(settled, String(connectivity)).toBe(false)
      expect(ensureUserProfile, String(connectivity)).not.toHaveBeenCalled()
    }
  })

  it('whenBusinessUserSettled without a context is fail-closed (no request)', async () => {
    await expect(whenBusinessUserSettled()).resolves.toBe(false)
    expect(ensureUserProfile).not.toHaveBeenCalled()
  })

  it('whenBusinessUserSettled runs ensure when online', async () => {
    const settled = await whenBusinessUserSettled({
      authInitState: 'authenticated',
      authenticated: true,
      connectivity: ConnectivityState.ONLINE,
    })
    expect(settled).toBe(true)
    expect(ensureUserProfile).toHaveBeenCalledTimes(1)
  })

  it('gated ensure / retry primitives refuse to touch the backend while unavailable', async () => {
    for (const connectivity of offlineStates) {
      resetBusinessUserBootstrap()
      vi.mocked(ensureUserProfile).mockClear()
      const context = { authInitState: 'authenticated', authenticated: true, connectivity }

      await expect(ensureBusinessUserIfAllowed(context), String(connectivity)).resolves.toBe(false)
      await expect(retryBusinessUserIfAllowed(context), String(connectivity)).resolves.toBe(false)
      expect(ensureUserProfile, String(connectivity)).not.toHaveBeenCalled()
      // 也没有把状态机推进到 pending/failed（离线不是失败）。
      expect(useBusinessUserBootstrap().state.value).toBe('idle')
      expect(useBusinessUserBootstrap().failed.value).toBe(false)
    }
  })

  it('gated ensure / retry work when online', async () => {
    const context = { authInitState: 'authenticated', authenticated: true, connectivity: ConnectivityState.ONLINE }
    await expect(ensureBusinessUserIfAllowed(context)).resolves.toBe(true)
    expect(ensureUserProfile).toHaveBeenCalledTimes(1)
    resetBusinessUserBootstrap()
    vi.mocked(ensureUserProfile).mockClear()
    await expect(retryBusinessUserIfAllowed(context)).resolves.toBe(true)
    expect(ensureUserProfile).toHaveBeenCalledTimes(1)
  })

  it('the hook only exposes gated entrypoints', () => {
    const bootstrap = useBusinessUserBootstrap()
    // ensure/retry 指向 gated 版本：页面无法误用 raw backend primitive。
    expect(bootstrap.ensure).toBe(ensureBusinessUserIfAllowed)
    expect(bootstrap.retry).toBe(retryBusinessUserIfAllowed)
  })
})
