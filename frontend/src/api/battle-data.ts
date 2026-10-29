import type { components } from './generated/http-contract.js'
import { battleDataRequestValidator } from './generated/contract-validators.js'
import { resolveApiUrl } from '../platform/runtime.js'

/** Collector 专用静默 transport：没有认证、cookie、重试或用户错误副作用。 */
export async function postBattleData(payload: components['schemas']['BattleDataRequest']): Promise<void> {
  try {
    if (navigator.onLine === false || !battleDataRequestValidator(payload)) return
    await fetch(resolveApiUrl('/api/battle-data'), {
      method: 'POST', credentials: 'omit', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    })
  } catch { /* 所有网络、协议、超时与校验失败均丢弃；不重试。 */ }
}
