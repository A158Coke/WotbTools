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
  if (cached !== null) return cached
  const q = new URLSearchParams(location.search).get('assets')
  const override = q ?? localStorage.getItem('wotb_asset_base')
  cached = (override || productionDefault).replace(/\/+$/, '')
  if (q !== null) {
    if (cached) localStorage.setItem('wotb_asset_base', cached)
    else localStorage.removeItem('wotb_asset_base')
  }
  return cached
}
