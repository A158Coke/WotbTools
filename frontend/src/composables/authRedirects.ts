import { stringifyQuery, type LocationQueryRaw } from 'vue-router'
import { hasAuthReturn } from '../platform/authDiagnostics.js'

export type LoginDestination = string | { path?: string; query?: LocationQueryRaw; hash?: string } | null | undefined

export function loginRedirectUri(destination: LoginDestination) {
  const current = new URL(window.location.href)
  let url: URL
  if (typeof destination === 'string') {
    url = current.searchParams.get('view') === destination
      ? current
      : new URL(current.origin + current.pathname)
    url.searchParams.set('view', destination)
  } else if (!destination) {
    url = current
  } else {
    url = new URL(destination.path || current.pathname, current.origin)
    if (url.origin !== current.origin) throw new Error('AUTH_REDIRECT_ORIGIN_MISMATCH')
    url.search = stringifyQuery(destination.query || {})
    url.hash = destination.hash || ''
  }
  if (hasAuthReturn({ search: url.search, hash: '' })) {
    for (const key of ['code', 'state', 'session_state', 'iss', 'error', 'error_description',
      'error_uri', 'kc_action_status', 'kc_action']) url.searchParams.delete(key)
  }
  return url.toString()
}

export function logoutRedirectUri() {
  return window.location.origin + '/'
}
