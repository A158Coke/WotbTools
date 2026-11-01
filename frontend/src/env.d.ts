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
}

/** 判断为真时值一定是 number。为假时 TypeScript 也会排除 number，因此已是 number 的值不要在 else 分支继续使用。 */
interface NumberConstructor {
  isFinite(value: unknown): value is number
}
