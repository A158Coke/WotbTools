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
    // 直接构建 URL 跳转，不依赖 keycloak.init
    const kc = ensureKeycloak()
    const redirectUri = window.location.origin + '/?view=profile'
    window.location.href = kc.createLoginUrl({ redirectUri })
  }

  const logout = () => {
    const kc = ensureKeycloak()
    window.location.href = kc.createLogoutUrl({ redirectUri: window.location.origin })
  }

  const isAuthenticated = () => keycloak?.authenticated ?? false
  const userName = () => keycloak?.tokenParsed?.preferred_username || keycloak?.tokenParsed?.name || ''

  return { initPromise, login, logout, isAuthenticated, userName }
}
