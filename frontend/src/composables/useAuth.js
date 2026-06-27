import Keycloak from 'keycloak-js'

let keycloak = null
let initPromise = null

function ensureKeycloak() {
  if (!keycloak) {
    keycloak = new Keycloak({
      url: import.meta.env.VITE_KEYCLOAK_URL,
      realm: import.meta.env.VITE_KEYCLOAK_REALM,
      clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
    })
  }
  return keycloak
}

export function useAuth() {
  const kc = ensureKeycloak()

  if (!initPromise) {
    initPromise = kc.init({
      onLoad: 'check-sso',
      silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
      pkceMethod: 'S256',
    }).catch(err => {
      console.warn('Keycloak init failed, login will still work', err)
    })
  }

  const login = () => {
    try {
      ensureKeycloak().login({ redirectUri: window.location.href })
    } catch (e) {
      console.error('Keycloak login error', e)
      // 回退：直接跳转 KC 登录页
      const kc = ensureKeycloak()
      const url = kc.createLoginUrl({ redirectUri: window.location.href })
      if (url) window.location.href = url
    }
  }

  const logout = () => {
    try {
      ensureKeycloak().logout({ redirectUri: window.location.origin })
    } catch (e) {
      console.error('Keycloak logout error', e)
    }
  }

  const isAuthenticated = () => keycloak?.authenticated ?? false
  const userName = () => keycloak?.tokenParsed?.preferred_username || keycloak?.tokenParsed?.name || ''

  return { initPromise, login, logout, isAuthenticated, userName }
}
