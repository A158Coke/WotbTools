import Keycloak from 'keycloak-js'

let keycloak = null
let initPromise = null

export function useAuth() {
  if (!keycloak) {
    keycloak = new Keycloak({
      url: import.meta.env.VITE_KEYCLOAK_URL,
      realm: import.meta.env.VITE_KEYCLOAK_REALM,
      clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
    })
  }

  if (!initPromise) {
    initPromise = keycloak.init({
      onLoad: 'check-sso',
      silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
      pkceMethod: 'S256',
    }).catch(err => {
      console.error('Keycloak init failed', err)
    })
  }

  const login = () => keycloak.login({ redirectUri: window.location.href })
  const logout = () => keycloak.logout({ redirectUri: window.location.origin })
  const isAuthenticated = () => keycloak.authenticated
  const userName = () => keycloak.tokenParsed?.preferred_username || keycloak.tokenParsed?.name || ''

  return { keycloak, initPromise, login, logout, isAuthenticated, userName }
}
