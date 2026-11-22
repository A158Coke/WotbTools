/** init 交易与生命周期助手（拆分自 useAuth.ts，行为原样）。
 *  交易对象由 useAuth 持有（模块级 currentTransaction），本文件只做无状态推进。 */
import type { AuthProvider } from '../types/auth.js'

export interface AuthTransaction {
  generation: number
  provider: AuthProvider | null
  unsubscribe: (() => void) | null
  reason: string
  startedAt: number
  settled: boolean
  abandoned: boolean
  watchdog: ReturnType<typeof setTimeout> | null
  pendingLog: ReturnType<typeof setTimeout> | null
  timeoutLogged: boolean
  publicResolved: boolean
  resolve: ((result: boolean) => void) | null
  promise: Promise<boolean> | null
}


export function resolveTransaction(transaction: AuthTransaction, result: boolean) {
  if (transaction.publicResolved) return
  transaction.publicResolved = true
  transaction.resolve!(result)
}

/** 退订 Native 推送：transaction 一旦不再是 owner（被放弃或被新一代取代）就必须解除。 */
export function releaseProvider(transaction: AuthTransaction | null) {
  if (!transaction?.unsubscribe) return
  transaction.unsubscribe()
  transaction.unsubscribe = null
}

export function abandonTransaction(transaction: AuthTransaction) {
  if (!transaction || transaction.settled || transaction.abandoned) return
  transaction.abandoned = true
  clearTimeout(transaction.watchdog!)
  clearTimeout(transaction.pendingLog!)
  releaseProvider(transaction)
  resolveTransaction(transaction, false)
  console.debug(`[auth] init_abandoned generation=${transaction.generation}`)
}
