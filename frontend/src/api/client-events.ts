import type { components } from './generated/http-contract.js'
import { useAuth } from '../composables/useAuth.js'
import { apiFetch } from '../utils/http.js'

type ClientEvent = components['schemas']['ClientEvent']
const reported = new Set<ClientEvent['event']>()

/** Fixed critical events only; no exception text, URL, replay data, retry or recursion. */
export function reportClientFailure(event: ClientEvent['event'], errorCode: ClientEvent['errorCode']): void {
  if (reported.has(event)) return
  reported.add(event)
  const accessToken = useAuth().token()
  const body: ClientEvent = { event, errorCode, platform: 'web' }
  void apiFetch('/api/observability/client-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(body),
    keepalive: true,
    signal: AbortSignal.timeout(5000),
  }).catch(() => { /* Best effort reporting must never recurse. */ })
}
