import Keycloak from 'keycloak-js'
import { computed, ref } from 'vue'

let keycloak = null
let initPromise = null

const initialized = ref(false)
const authenticated = ref(false)
const tokenParsed = ref(null)
const initError = ref(null)

function ensureKeycloak() {
  if (!keycloak) {
    keycloak = new Keycloak({
      url: 'https://auth.wotbtools.com',
      realm: 'wotbtools',
      clientId: 'wotbtools-web',
    })
  }
  return keycloak
}

function profileRedirectUri() {
  const url = new URL(window.location.origin + window.location.pathname)
  url.searchParams.set('view', 'profile')
  return url.toString()
}

async function initAuth() {
  const kc = ensureKeycloak()

  if (!initPromise) {
    initPromise = kc.init({
      onLoad: 'check-sso',
      pkceMethod: 'S256',
      checkLoginIframe: false,
    }).then(isLoggedIn => {
      authenticated.value = Boolean(isLoggedIn && kc.authenticated)
      tokenParsed.value = kc.tokenParsed || null
      initialized.value = true
      initError.value = null
      return authenticated.value
    }).catch(err => {
      console.error('Keycloak init failed', err)
      authenticated.value = false
      tokenParsed.value = null
      initialized.value = true
      initError.value = err
      return false
    })
  }

  return initPromise
}

async function login() {
  const kc = ensureKeycloak()
  await initAuth()
  return kc.login({ redirectUri: profileRedirectUri() })
}

async function logout() {
  const kc = ensureKeycloak()
  return kc.logout({ redirectUri: window.location.origin + window.location.pathname })
}

function isAuthenticated() {
  return authenticated.value
}

function userName() {
  return tokenParsed.value?.preferred_username
    || tokenParsed.value?.name
    || tokenParsed.value?.email
    || ''
}

function token() {
  return keycloak?.token || ''
}

/** 确保 token 还有至少 minValidity 秒有效，不足则静默刷新。 */
async function ensureToken(minValidity = 30) {
  const kc = ensureKeycloak()
  if (!kc.authenticated) return false
  try {
    const refreshed = await kc.updateToken(minValidity)
    if (refreshed) {
      tokenParsed.value = kc.tokenParsed
    }
    return true
  } catch {
    authenticated.value = false
    tokenParsed.value = null
    return false
  }
}

export function useAuth() {
  return {
    keycloak: ensureKeycloak(),
    initAuth,
    initPromise: initAuth(),
    login,
    logout,
    isAuthenticated,
    userName,
    token,
    ensureToken,
    initialized,
    authenticated,
    tokenParsed,
    initError,
    displayName: computed(() => userName()),
  }
}
