// 资产平面访问边界（评审 P0-3）：storage/network 与 Three.js 运行时解耦——
// provider 只返回 URL / bytes / JSON，绝不返回 THREE.Object3D；场景内核经此
// 取资产，不感知资产存放位置。
//
// 浏览器 v1 = remote provider：`?assets=` 指向 COS/CDN 资产平面（契约 §13），
// 传输缓存交给 HTTP 缓存；不做 IndexedDB（评审 non-goals）。
// 接口不阻碍 App 端磁盘缓存：未来 App 实现可将 bytes() 切到本地磁盘命中、
// miss 再走网络——消费方签名不变。
//
// WotBTools Playback 拓扑是 client-only：本地 WASM 解析 + 本 provider。
// 不存在 Agent 自托管 /api/* 回退——资产基址未配置时抛错而非静默降级
//（错误信息指导配置，而不是让地图/车模静默消失）。
import { assetBase } from './assetBase.js'

function requireBase() {
  const base = assetBase()
  if (!base) {
    throw new Error(
      '资产平面未配置：追加 ?assets=<COS/CDN 基址>（坦克数据/GLB/封面/地图资产均来自该平面）',
    )
  }
  return base
}

export const assetProvider = {
  /** 资产直连 URL（<img> / TextureLoader 等需要 URL 的消费方）；未配置基址抛错 */
  url(path) {
    return requireBase() + path
  },

  /** 资产字节（GLB/二进制）；非 2xx 抛错（含状态码） */
  async bytes(path) {
    const resp = await fetch(this.url(path))
    if (!resp.ok) throw new Error(`asset ${path}: HTTP ${resp.status}`)
    return new Uint8Array(await resp.arrayBuffer())
  },

  /** 资产 JSON；非 2xx 抛错 */
  async json(path) {
    const resp = await fetch(this.url(path))
    if (!resp.ok) throw new Error(`asset ${path}: HTTP ${resp.status}`)
    return resp.json()
  },

  /** 资产基址是否已配置（UI 决定提示 vs 直接尝试） */
  configured() {
    return !!assetBase()
  },
}
