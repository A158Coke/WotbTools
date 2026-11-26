import Keycloak, { type KeycloakInitOptions } from 'keycloak-js'
import type { AuthProvider } from '../types/auth.js'
import { hasAuthReturn, recordLoginStart, recordReturnFacts } from './authDiagnostics.js'
import { readLocale } from '../i18n/locale-preference.js'

const KEYCLOAK_CONFIG = Object.freeze({
  url: 'https://auth.wotbtools.com',
  realm: 'wotbtools',
  clientId: 'wotbtools-web',
})

export function createBrowserAuthProvider(): AuthProvider {
  let keycloak: Keycloak | null = null
  let accessTokenUsable = true

  function adapter() {
    if (!keycloak) keycloak = new Keycloak(KEYCLOAK_CONFIG)
    return keycloak
  }

  return {
    name: 'web',

    async init({ mode } = {}) {
      recordReturnFacts(hasAuthReturn({ search: '', hash: window.location.hash })
        ? window.location.hash.slice(1) : window.location.search)
      const returning = hasAuthReturn()
      const options: KeycloakInitOptions = mode === 'login-recovery' || returning
        ? {
            pkceMethod: 'S256',
            checkLoginIframe: false,
          }
        : {
            onLoad: 'check-sso',
            pkceMethod: 'S256',
            silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
            checkLoginIframe: false,
          }
      const kc = adapter()
      const login = kc.login
      const guardReturn = returning && mode !== 'login-recovery'
      if (guardReturn) {
        options.onLoad = 'check-sso'
        kc.login = () => {
          throw Object.assign(new Error('AUTH_RETURN_NOT_COMPLETED'), { code: 'AUTH_RETURN_NOT_COMPLETED' })
        }
      }
      try {
        await kc.init(options)
      } finally {
        if (guardReturn) kc.login = login
      }
    },

    get authenticated() {
      return Boolean(keycloak?.authenticated)
    },

    get tokenParsed() {
      return keycloak?.tokenParsed || null
    },

    token() {
      return accessTokenUsable ? (keycloak?.token || '') : ''
    },

    login(redirectUri?: string) {
      recordLoginStart(typeof redirectUri === 'string' ? redirectUri : null)
      return adapter().login({ redirectUri, locale: readLocale() })
    },

    logout(redirectUri?: string) {
      return adapter().logout({ redirectUri })
    },

    async ensureToken(minValidity = 30) {
      const kc = keycloak
      if (!kc || !kc.authenticated) return false
      try {
        await kc.updateToken(minValidity)
        accessTokenUsable = true
        return true
      } catch (error) {
        accessTokenUsable = false
        console.warn('[auth] browser_refresh_failed session=retained token=withheld')
        return false
      }
    },

    onAuthChanged() {
      return () => {}
    },
  }
}
