/** auth init/会话诊断与身份键（拆分自 useAuth.ts，行为原样）。 */
import type { AuthClaims } from '../types/auth.js'
import type { AuthTransaction } from './authTransaction.js'
import { isAndroidApp } from './usePlatformBridge.js'

export function platformName() {
  return isAndroidApp() ? 'android' : 'web'
}

export function errorType(error: unknown) {
  const failure = error as { name?: unknown; error?: unknown } | null | undefined
  if (failure?.name && typeof failure.name === 'string') return failure.name
  if (failure?.error && typeof failure.error === 'string') return failure.error
  return 'unknown'
}

export function elapsedMs(transaction: AuthTransaction) {
  return Date.now() - transaction.startedAt
}

export function logInitStarted(transaction: AuthTransaction) {
  console.debug(
    `[auth] init_started generation=${transaction.generation} platform=${platformName()} `
    + `reason=${transaction.reason}`,
  )
}

/** 身份键：已登录取 token 的 `sub`（缺失时用占位键——仍是"已登录"这个身份），未登录为 null。 */
export function identityKeyOf(isAuthenticatedValue: boolean, parsedToken: AuthClaims | null | undefined) {
  if (!isAuthenticatedValue) return null
  const sub = parsedToken && typeof parsedToken === 'object' ? parsedToken.sub : null
  return typeof sub === 'string' && sub ? `sub:${sub}` : 'authenticated:unknown-sub'
}
