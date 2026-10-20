import type { components } from './generated/http-contract.js'
import { optionalBearer, type ReplayAuthSession } from './replay-capabilities.js'
import { apiFetch } from '../utils/http.js'

export type UsageEvent = components['schemas']['ObservabilityEvent']
/** Ordinary telemetry that still uses the five-second in-memory queue. */
export type GenericUsageEvent = components['schemas']['GenericObservabilityEvent']

/** Best effort only: callers never wait for telemetry before completing product work. */
export async function postUsageEvents(
  events: UsageEvent[],
  activity?: { auth: ReplayAuthSession; isCurrent: () => boolean },
): Promise<void> {
  const headers = activity ? await optionalBearer(activity.auth) : {}
  // Refresh may outlive the foreground session or change the signed-in account.
  if (activity && (!headers.Authorization || !activity.isCurrent())) return
  await apiFetch('/api/observability/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ events }),
    signal: AbortSignal.timeout(10_000),
    keepalive: true,
  })
}
