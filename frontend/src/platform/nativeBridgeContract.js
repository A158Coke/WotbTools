// The JSON contract is authoritative. This is the FE compatibility declaration;
// CI fails if it drifts from contracts/android-native-bridge.json.
//
// Bridge v2 is the native-auth bridge. Bridge v1 (Android 1.4.x, WebView-owned
// auth) is deliberately NOT supported by this frontend: an Android shell that
// reports it must show the upgrade requirement, never silently fall back to
// keycloak-js inside the WebView.
export const SUPPORTED_NATIVE_BRIDGE_VERSIONS = Object.freeze([2])

/** Capability that makes the native OIDC session (not the WebView) the auth owner. */
export const NATIVE_AUTH_CAPABILITY = 'native-auth'

/** Bridge methods the native-auth provider depends on (mirrors the JSON contract). */
export const NATIVE_AUTH_METHODS = Object.freeze({
  getState: 'authGetState',
  login: 'authLogin',
  logout: 'authLogout',
  getAccessToken: 'authGetAccessToken',
})

/** Native → Web auth state change notification (mirrors the JSON contract `events`). */
export const NATIVE_AUTH_CHANGED_GLOBAL = 'wotbtoolsOnAuthChanged'

/**
 * Capability that makes the native connectivity state (Android `ConnectivityManager`,
 * INTERNET + VALIDATED) authoritative instead of `navigator.onLine` in the WebView.
 */
export const NATIVE_CONNECTIVITY_CAPABILITY = 'connectivity'

/** Bridge methods the connectivity platform source depends on (mirrors the JSON contract). */
export const NATIVE_CONNECTIVITY_METHODS = Object.freeze({
  getState: 'connectivityGetState',
})

/** Native → Web connectivity change notification (mirrors the JSON contract `events`). */
export const NATIVE_CONNECTIVITY_CHANGED_GLOBAL = 'wotbtoolsOnConnectivityChanged'

/** Exact Native-owned resource; must never become an arbitrary remote fetch. */
export const NATIVE_REPLAY_RESOURCE_URL =
  'https://appassets.androidplatform.net/__native/replay-pending'
