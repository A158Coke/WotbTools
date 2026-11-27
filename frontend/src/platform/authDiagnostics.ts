
const BUFFER_LIMIT = 30
const buffer: unknown[] = []

export function errorCategory(search?: string | null) {
  let error = ''
  for (const [key, value] of new URLSearchParams(search || '')) {
    if (key === 'error') error = String(value || '')
  }
  return error
}

export function hasAuthReturn(location: Pick<Location, 'search' | 'hash'> = window.location) {
  return [location.search, location.hash.slice(1)].some(value => {
    const params = new URLSearchParams(value)
    return params.has('state') && (params.has('code') || params.has('error'))
  })
}

export function returnParamFacts(search?: string | null) {
  const params = new URLSearchParams(search || '')
  return {
    hasCode: params.has('code'),
    hasState: params.has('state'),
    hasSessionState: params.has('session_state'),
    hasError: params.has('error'),
    error: params.has('error') ? errorCategory(search) : 'none',
    hasIss: params.has('iss'),
  }
}

export function record(event: string, fields: Record<string, unknown> = {}) {
  const entry = { at: new Date().toISOString(), event, ...fields }
  try {
    const line = JSON.stringify(entry)
    buffer.push(JSON.parse(line))
    if (buffer.length > BUFFER_LIMIT) buffer.shift()
    console.info('[auth-diag]', line)
  } catch {
    // 序列化失败（不该发生）：静默丢弃本条。
  }
  return entry
}

export function recordLoginStart(redirectUri: string | null) {
  let destination = 'invalid'
  try {
    const url = new URL(redirectUri as string, typeof window !== 'undefined' ? window.location.origin : 'https://wotbtools.invalid')
    destination = url.searchParams.get('view') || url.pathname
  } catch {
    destination = 'invalid'
  }
  return record('login_started', { destination })
}

export function recordReturnFacts(search = typeof window !== 'undefined' ? window.location.search : '') {
  return record('return_facts', returnParamFacts(search))
}

export function snapshot() {
  return [...buffer]
}

export function __resetAuthDiagnosticsForTest() {
  buffer.length = 0
}
