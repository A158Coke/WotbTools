import { ANDROID_ASSET_BASE, isAndroidRuntime } from '../platform/runtime.js'
// 资产 origin 解析（架构契约 §13）：GLB/地图/坦克静态数据的 remote asset origin。
// WotBTools Playback 拓扑 client-only：生产构建提供默认 remote asset origin；
// ?assets=<remote origin> 仅作为开发/运维 override，并持久化到 localStorage。
// 打包器 export_asset_pack.py 布局：/glb/*、/map/*、/tank/*、/tank_images/*、/data/*。
// 本模块只负责"origin 从哪里读"，不假设具体基础设施。当前生产默认可以指向 COS，
// 后续迁移静态服务器/CDN/其它对象存储时只需更换构建配置，消费方无需改动。
// 解析优先级：URL 参数 > localStorage override > production build default。

const productionDefault = (import.meta.env.VITE_ASSET_BASE_URL ?? '').replace(/\/+$/, '')

let cached = null

export function assetBase() {
  // APK CSP and readiness gate review one production gateway; Web keeps its overrides.
  if (isAndroidRuntime()) return ANDROID_ASSET_BASE
  if (cached !== null) return cached
  const q = new URLSearchParams(location.search).get('assets')
  const override = q ?? localStorage.getItem('wotb_asset_base')
  cached = (override || productionDefault).replace(/\/+$/, '')
  if (q !== null) {
    // 只持久化真正的显式 override。`?assets=`（显式空）是"清除 override"的手段：
    // 若把回落到的生产默认写进 localStorage，后续更换生产 origin 时这些浏览器会被
    // 旧值钉住，永远取不到新的构建默认。
    if (q) localStorage.setItem('wotb_asset_base', cached)
    else localStorage.removeItem('wotb_asset_base')
  }
  return cached
}
