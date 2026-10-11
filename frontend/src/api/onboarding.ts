import type { components } from './generated/http-contract.js'
import { onboardingReceiptValidator, saveOnboardingReceiptValidator } from './generated/contract-validators.js'
import { optionalBearer } from './replay-capabilities.js'
import { useAuth } from '../composables/useAuth.js'
import { ApiError, apiFetch, requireOk } from '../utils/http.js'

export type OnboardingReceipt = components['schemas']['OnboardingReceipt']
export type SaveOnboardingReceipt = components['schemas']['SaveOnboardingReceipt']

const endpoint = '/api/users/onboarding'

/** Caller owns profile bootstrap and connectivity; this boundary owns Bearer, identity and wire validation. */
async function request(options: RequestInit = {}): Promise<OnboardingReceipt> {
  const auth = useAuth()
  const epoch = auth.authEpoch()
  if (!auth.isAuthenticated()) throw new ApiError({ errorCode: 'AUTH_UNAUTHENTICATED', status: 401 })
  const headers = await optionalBearer(auth)
  function requireCurrentSession() {
    if (options.signal?.aborted || epoch !== auth.authEpoch() || !auth.isAuthenticated()) {
      throw new ApiError({ errorCode: 'REQUEST_ABORTED', retryable: false })
    }
  }
  requireCurrentSession()
  if (!headers.Authorization) throw new ApiError({ errorCode: 'AUTH_UNAUTHENTICATED', status: 401 })
  const response = await apiFetch(endpoint, {
    ...options, headers: { ...headers, ...options.headers },
  })
  requireCurrentSession()
  await requireOk(response)
  requireCurrentSession()
  let value: unknown
  try {
    value = await response.json()
  } catch (cause) {
    requireCurrentSession()
    throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false, cause })
  }
  requireCurrentSession()
  if (!onboardingReceiptValidator(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
  return value as OnboardingReceipt
}

export function readOnboardingReceipt(signal?: AbortSignal): Promise<OnboardingReceipt> {
  return request({ signal })
}

export function saveOnboardingReceipt(receipt: SaveOnboardingReceipt, signal?: AbortSignal): Promise<OnboardingReceipt> {
  if (!saveOnboardingReceiptValidator(receipt)) {
    return Promise.reject(new ApiError({ errorCode: 'INVALID_REQUEST', status: 400, retryable: false }))
  }
  return request({
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(receipt), signal,
  })
}
