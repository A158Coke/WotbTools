import { NATIVE_AUTH_CHANGED_GLOBAL, NATIVE_AUTH_METHODS } from './nativeBridgeContract.js'
import { callBridge } from '../composables/usePlatformBridge.js'
import { isRecord } from '../types/primitive-guards.js'
import { readLocale } from '../i18n/locale-preference.js'
import type { AuthClaims, AuthProvider } from '../types/auth.js'
import type { NativeBridgeRequest } from '../api/generated/android-native-bridge.js'

type LoginLocale = NonNullable<NativeBridgeRequest<'authLogin'>['locale']>

const NATIVE_AUTH_TIMEOUT_MS = 20_000

const AUTH_TOKEN_MIN_VALIDITY_SECONDS = 30

const AUTH_RPC_OPTIONS = Object.freeze({ timeoutMs: NATIVE_AUTH_TIMEOUT_MS })

function isAuthenticatedState(state: unknown) {
  return isRecord(state) && state.authenticated === true
}

export function createAndroidAuthProvider(): AuthProvider {
  let authenticated = false
  let claims: AuthClaims | null = null
  let accessToken = ''
  let generation = 0

  function clear() {
    generation += 1
    authenticated = false
    claims = null
    accessToken = ''
    return false
  }

  async function applyTokenReply(rawReply: unknown, expectedGeneration: number) {
    if (generation !== expectedGeneration) return false
    const reply = isRecord(rawReply) ? rawReply : null
    if (reply?.error === 'refresh-failed') {
      accessToken = ''
      const state = await callBridge(NATIVE_AUTH_METHODS.getState, {}, AUTH_RPC_OPTIONS)
      if (generation !== expectedGeneration) return false
      if (!isAuthenticatedState(state)) return clear()
      authenticated = true
      if (isRecord(reply?.claims)) claims = reply.claims as AuthClaims
      return false
    }
    if (reply?.error || typeof reply?.token !== 'string' || !reply.token) return clear()
    authenticated = true
    accessToken = reply.token
    claims = isRecord(reply.claims) ? reply.claims as AuthClaims : null
    return true
  }

  function readAccessToken(minValiditySeconds: number) {
    return callBridge(
      NATIVE_AUTH_METHODS.getAccessToken,
      { minValiditySeconds },
      AUTH_RPC_OPTIONS,
    )
  }

  async function syncFromNative() {
    const expectedGeneration = ++generation
    const state = await callBridge(NATIVE_AUTH_METHODS.getState, {}, AUTH_RPC_OPTIONS)
    if (generation !== expectedGeneration) return false
    if (!isAuthenticatedState(state)) return clear()
    return applyTokenReply(await readAccessToken(AUTH_TOKEN_MIN_VALIDITY_SECONDS), expectedGeneration)
  }

  return {
    name: 'android',

    async init() {
      await syncFromNative()
    },

    get authenticated() {
      return authenticated
    },

    get tokenParsed() {
      return claims
    },

    token() {
      return accessToken
    },

    async login() {
      generation += 1
      return (await callBridge(NATIVE_AUTH_METHODS.login, { locale: readLocale() as LoginLocale }, AUTH_RPC_OPTIONS)) === true
    },

    async logout() {
      clear()
      await callBridge(NATIVE_AUTH_METHODS.logout, {}, AUTH_RPC_OPTIONS)
    },

    async ensureToken(minValidity = AUTH_TOKEN_MIN_VALIDITY_SECONDS) {
      if (!authenticated) return false
      const expectedGeneration = generation
      return applyTokenReply(await readAccessToken(minValidity), expectedGeneration)
    },

    onAuthChanged(cb) {
      if (typeof window === 'undefined') return () => {}
      let subscribed = true
      const handler = async () => {
        await syncFromNative()
        if (subscribed) cb()
      }
      window[NATIVE_AUTH_CHANGED_GLOBAL] = handler
      return () => {
        subscribed = false
        generation += 1
        if (window[NATIVE_AUTH_CHANGED_GLOBAL] === handler) delete window[NATIVE_AUTH_CHANGED_GLOBAL]
      }
    },
  }
}

export function createUnsupportedAuthProvider(reason: string): AuthProvider {
  function unsupportedError() {
    const error: Error & { code?: string; reason?: string } = new Error(`NATIVE_AUTH_UNSUPPORTED: ${reason}`)
    error.name = 'NATIVE_AUTH_UNSUPPORTED'
    error.code = 'NATIVE_AUTH_UNSUPPORTED'
    error.reason = reason
    return error
  }

  return {
    name: 'android-unsupported',

    authenticated: false,
    tokenParsed: null,

    token() {
      return ''
    },

    async init() {
      throw unsupportedError()
    },

    async login() {
      throw unsupportedError()
    },

    async logout() {},

    async ensureToken() {
      return false
    },

    onAuthChanged() {
      return () => {}
    },
  }
}
