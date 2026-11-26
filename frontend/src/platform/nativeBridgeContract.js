import { ANDROID_APP_ORIGIN } from './runtime.js'

export const SUPPORTED_NATIVE_BRIDGE_VERSIONS = Object.freeze([4])

export const NATIVE_AUTH_CAPABILITY = 'native-auth'

export const NATIVE_AUTH_METHODS = Object.freeze({
  getState: 'authGetState',
  login: 'authLogin',
  logout: 'authLogout',
  getAccessToken: 'authGetAccessToken',
})

export const NATIVE_AUTH_CHANGED_GLOBAL = 'wotbtoolsOnAuthChanged'

export const NATIVE_CONNECTIVITY_CAPABILITY = 'connectivity'

export const NATIVE_CONNECTIVITY_METHODS = Object.freeze({
  getState: 'connectivityGetState',
})

export const NATIVE_CONNECTIVITY_CHANGED_GLOBAL = 'wotbtoolsOnConnectivityChanged'

export const NATIVE_UPDATE_CAPABILITY = 'app-update-status'
export const NATIVE_UPDATE_METHODS = Object.freeze({
  getStatus: 'getUpdateStatus',
  refreshStatus: 'refreshUpdateStatus',
  beginDownload: 'beginUpdateDownload',
  install: 'installUpdate',
  dismiss: 'dismissOptionalUpdate',
})
export const NATIVE_UPDATE_CHANGED_GLOBAL = 'wotbtoolsOnUpdateStatusChanged'

export const NATIVE_REPLAY_GLOBAL = 'wotbtoolsOnReplay'

export const NATIVE_REPLAY_RESOURCE_URL = `${ANDROID_APP_ORIGIN}/__native/replay-pending`

export const NATIVE_REPLAY_FOLDER_CAPABILITY = 'replay-folder-picker'
export const NATIVE_REPLAY_FOLDER_RESOURCE_URL = `${ANDROID_APP_ORIGIN}/__native/replay-folder`

export const NATIVE_SCREEN_FORM_CAPABILITY = 'screen-form'
export const NATIVE_SCREEN_FORM_METHODS = Object.freeze({
  getForm: 'getScreenForm',
  setOrientationLock: 'setOrientationLock',
})

export const NATIVE_HAPTICS_CAPABILITY = 'haptics'
export const NATIVE_HAPTICS_METHODS = Object.freeze({
  haptic: 'haptic',
})
