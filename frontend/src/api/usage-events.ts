import type { components } from './generated/http-contract.js'
import { optionalBearer, type ReplayAuthSession } from './replay-capabilities.js'
import { apiFetch } from '../utils/http.js'

export type UsageEvent = components['schemas']['ObservabilityEvent']
export type GenericUsageEvent = components['schemas']['GenericObservabilityEvent']

export async function postUsageEvents(
  events: UsageEvent[],
  activity?: { auth: ReplayAuthSession; isCurrent: () => boolean },
): Promise<void> {
  const headers = activity ? await optionalBearer(activity.auth) : {}
  if (activity && (!headers.Authorization || !activity.isCurrent())) return
  await apiFetch('/api/observability/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ events }),
    signal: AbortSignal.timeout(10_000),
    keepalive: true,
  })
}
