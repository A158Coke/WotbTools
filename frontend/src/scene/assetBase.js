// 资产 origin 解析（架构契约 §13）：GLB/地图/坦克静态数据的 remote asset origin。
// WotBTools Playback 拓扑 client-only（评审 P0-3）：经 ?assets=<remote origin> 或
// localStorage 指向配置的资产源（打包器 export_asset_pack.py 布局：/glb/*、
// /map/*、/tank/*、/tank_images/*、/data/*）。
// 本模块只负责"origin 从哪里读"，不假设任何基础设施（静态服务器 / 对象存储 /
// CDN / 镜像皆等价）。消费方一律经 assetProvider 访问（storage/network 与场景
// 解耦）；origin 未配置时 provider 抛错指导配置——不存在同源 /api/* 服务端回退。
// 解析优先级：URL 参数 > localStorage；URL 参数写入 localStorage（一次配置会话内生效）。

let cached = null

export function assetBase() {
  if (cached !== null) return cached
  const q = new URLSearchParams(location.search).get('assets')
  cached = (q ?? localStorage.getItem('wotb_asset_base') ?? '').replace(/\/+$/, '')
  if (q !== null) localStorage.setItem('wotb_asset_base', cached)
  return cached
}
