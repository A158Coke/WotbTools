// 资产基址（架构契约 §13）：GLB/地图/坦克静态数据的部署面。
// WotBTools Playback 拓扑 client-only（评审 P0-3）：经 ?assets=<基址> 或
// localStorage 指向资产平面（打包器 export_asset_pack.py 布局：/glb/*、
// /map/*、/tank/*、/tank_images/*、/data/*）。
// 访问一律经 assetProvider（storage/network 与场景解耦）；基址未配置时
// provider 抛错指导配置——不存在同源 /api/* 服务端回退。
// 解析优先级：URL 参数 > localStorage；URL 参数写入 localStorage（一次配置会话内生效）。

let cached = null

export function assetBase() {
  if (cached !== null) return cached
  const q = new URLSearchParams(location.search).get('assets')
  cached = (q ?? localStorage.getItem('wotb_asset_base') ?? '').replace(/\/+$/, '')
  if (q !== null) localStorage.setItem('wotb_asset_base', cached)
  return cached
}

/** 资产基址前缀化（同源部署面 = 空串恒等）；一般消费方应走 assetProvider */
export function assetUrl(path) {
  return assetBase() + path
}
