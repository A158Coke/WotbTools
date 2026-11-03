/// <reference types="vite/client" />

declare const __BUILD_COMMIT__: string
declare const __BUILD_TIME__: string

/** GeckoView 内置扩展注入的 Bridge；页面只信任收窄后的回复，成员都可能缺失。 */
interface NativeBridgeTransport {
  postMessage?: (message: string) => void
  addEventListener?: (type: 'message', listener: (event: { data: unknown }) => void) => void
  removeEventListener?: (type: 'message', listener: (event: { data: unknown }) => void) => void
}

interface Window {
  WotbNative?: NativeBridgeTransport
  wotbtoolsOnAuthChanged?: () => unknown
  wotbtoolsOnConnectivityChanged?: () => unknown
  wotbtoolsOnReplay?: () => unknown
  __pbReplaySource?: unknown
  /** 逐图光照调试（?debug；mapLighting.ts 写入） */
  __mapLighting?: { direction?: number[]; color?: unknown; intensity?: unknown; ambient?: unknown }
  /** 逐图曝光调试（?debug；mapLighting.ts 写入） */
  __mapExposure?: number
  /** 场景装配调试计数（?debug；sceneryAssembly.ts 写入） */
  __skyMeshes?: number
  /** 水面海岸线调试（sceneryAssembly.ts 写入） */
  __waterCoast?: { materials?: number }
}
