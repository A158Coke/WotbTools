import { ANDROID_APP_ORIGIN } from './runtime.js'

// The JSON contract is authoritative. This is the FE compatibility declaration;
// CI fails if it drifts from contracts/android-native-bridge.json.
//
// Bridge v3 = Android 3.0 GeckoView runtime（本机 loopback origin + 内置扩展 transport），
// RPC 方法与 v2 完全相同。这份前端随 APK 打包、与 Native 同版本发布，因此只声明 [3]；
// 旧 v2 客户端由 publish 的 minSupportedVersionCode 强制更新（guard_bridge_covered），
// 绝不在页面里静默回退到 keycloak-js。
export const SUPPORTED_NATIVE_BRIDGE_VERSIONS = Object.freeze([3])

/** Capability that makes the native OIDC session (not the page) the auth owner. */
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
 * INTERNET + VALIDATED) authoritative instead of `navigator.onLine` in the page.
 */
export const NATIVE_CONNECTIVITY_CAPABILITY = 'connectivity'

/** Bridge methods the connectivity platform source depends on (mirrors the JSON contract). */
export const NATIVE_CONNECTIVITY_METHODS = Object.freeze({
  getState: 'connectivityGetState',
})

/** Native → Web connectivity change notification (mirrors the JSON contract `events`). */
export const NATIVE_CONNECTIVITY_CHANGED_GLOBAL = 'wotbtoolsOnConnectivityChanged'

/** Native → Web: pending replay arrived while the replay workspace is loaded (mirrors the JSON contract `events`). */
export const NATIVE_REPLAY_GLOBAL = 'wotbtoolsOnReplay'

/** Exact Native-owned resource; must never become an arbitrary remote fetch. */
export const NATIVE_REPLAY_RESOURCE_URL = `${ANDROID_APP_ORIGIN}/__native/replay-pending`

/** Optional v2 capability: manual SAF directory selection, independent of external replay pending. */
export const NATIVE_REPLAY_FOLDER_CAPABILITY = 'replay-folder-picker'
export const NATIVE_REPLAY_FOLDER_RESOURCE_URL = `${ANDROID_APP_ORIGIN}/__native/replay-folder`
