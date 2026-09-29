// 资产基址（架构契约 §13）：GLB/地图/坦克静态数据的部署面。
// - Agent 自托管（默认）：空串 = 同源相对路径，行为与历史版本逐字节一致；
// - WotBTools 部署：经 ?assets=<基址> 或 localStorage 指向其资产平面
//  （镜像同布局路由：/glb/*、/api/playback/map|terrain|scenery|groundmeta|groundtex、/api/tank/*）。
// 解析优先级：URL 参数 > localStorage > 同源；URL 参数写入 localStorage（一次配置会话内生效）。

let cached = null

export function assetBase() {
  if (cached !== null) return cached
  const q = new URLSearchParams(location.search).get('assets')
  cached = (q ?? localStorage.getItem('wotb_asset_base') ?? '').replace(/\/+$/, '')
  if (q !== null) localStorage.setItem('wotb_asset_base', cached)
  return cached
}

/** 同源基址下恒等（历史行为不变）；配置基址后前缀化指向资产平面 */
export function assetUrl(path) {
  return assetBase() + path
}
