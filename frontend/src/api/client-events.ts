import type { components } from './generated/http-contract.js'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { apiFetch } from '../utils/http.js'

type ClientEvent = components['schemas']['ClientEvent']
const reported = new Set<string>()

/** Fixed critical events only; no exception text, URL, replay data, retry or recursion. */
export function reportClientFailure(event: ClientEvent['event'], errorCode: ClientEvent['errorCode'], authFields: Pick<ClientEvent, 'stage' | 'clientSessionId'> = {}, accessToken?: string): void {
  const dedupeKey = `${event}:${authFields.clientSessionId || ''}`
  if (reported.has(dedupeKey)) return
  if (reported.size >= 100) return
  reported.add(dedupeKey)
  const platform = isAndroidApp() ? 'android' : 'web'
  const body: ClientEvent = { event, errorCode, platform, ...authFields }
  const send = (bearer: string) => apiFetch('/api/observability/client-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
    keepalive: true,
    signal: AbortSignal.timeout(5000),
  })
  // Lazy, read-only lookup avoids an auth ↔ telemetry module initialization cycle.
  const delivery = accessToken === undefined
    ? import('../composables/useAuth.js').then(auth => send(auth.currentAuthToken()))
    : send(accessToken)
  void delivery.catch(() => { /* Best effort reporting must never recurse. */ })
}
