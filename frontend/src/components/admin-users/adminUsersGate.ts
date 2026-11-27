import { ApiError } from '../../utils/http.js'
import { apiErrorCodeLabel, apiErrorLabel } from '../../utils/display.js'
import type { useI18n } from 'vue-i18n'

type Translate = ReturnType<typeof useI18n>['t']
type GateContext = {
  gate: () => boolean
  initPromise: Promise<unknown>
  ensureAuthToken: (minimumValiditySeconds: number) => Promise<boolean>
  login: () => void
  t: Translate
  te: (key: string) => boolean
}

export function createAdminUsersGate({ gate, initPromise, ensureAuthToken, login, t, te }: GateContext) {
  function requireAdminUsersOnline() {
    return gate()
  }

  function apiError(error: unknown) {
    return apiErrorLabel(t, te, error)
  }

  function errorCodeLabel(code: string) {
    return apiErrorCodeLabel(t, te, code)
  }

  async function ensureToken() {
    await initPromise
    if (!(await ensureAuthToken(5))) {
      login()
      throw new ApiError({ code: 'AUTH_UNAUTHENTICATED', status: 401, retryable: false })
    }
  }

  return { requireAdminUsersOnline, apiError, errorCodeLabel, ensureToken }
}
