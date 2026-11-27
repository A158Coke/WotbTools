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
