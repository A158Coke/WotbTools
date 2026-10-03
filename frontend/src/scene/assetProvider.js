import { isAndroidRuntime } from '../platform/runtime.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
// 资产访问边界（评审 P0-3）：storage/network 与 Three.js 运行时解耦——
// provider 只返回 URL / bytes / JSON，绝不返回 THREE.Object3D；场景内核经此
// 取资产，不感知资产实际托管在哪里。
//
// 边界语义（logical asset path → configured asset origin → bytes / JSON / URL）：
//   assetProvider.bytes('/glb/{tankId}/model.glb')
//   assetProvider.json('/tank/{tankId}.json')
//   assetProvider.url('/tank_images/{tankId}.webp')
// 消费方只依赖这条 logical asset API：更换 remote asset origin（静态服务器 /
// 对象存储 / CDN / 镜像 / 发布附件……）不需要改动 playbackScene / tankViewer /
// armorViewer / agentData 的任何调用点。消费方不拼接任何基础设施域名，也不
// 自行决定 fallback source。
//
// 浏览器 v1 = remote provider：`?assets=` 指向配置的 remote asset origin，
// 传输缓存交给 HTTP 缓存；不做 IndexedDB（评审 non-goals）。
// 接口不阻碍后续演化（例如 App 端 CachedAssetSource：hit → 本地磁盘，miss →
// remote source）——消费方签名不变。
//
// WotBTools Playback 拓扑是 client-only：本地 WASM 解析 + 本 provider。
// 不存在 Agent 自托管 /api/* 回退——asset origin 未配置时抛错而非静默降级
//（错误信息指导配置，而不是让地图/车模静默消失）。
import { assetBase } from './assetBase.js'

function requireBase() {
  if (isAndroidRuntime() && !useFeatureGate().requireFeature(Feature.PLAYBACK_3D)) {
    throw new Error('NETWORK_ERROR')
  }
  const base = assetBase()
  if (!base) {
    throw new Error(
      '资产源未配置：追加 ?assets=<remote-asset-base-url>（坦克数据/GLB/封面/地图资产均来自该 origin）',
    )
  }
  return base
}

export const assetProvider = {
  /** Recheck availability at dispatch, even when a scene resolved its URL earlier. */
  fetch(url, init) {
    requireBase()
    return fetch(url, init)
  },
  /** 资产直连 URL（<img> / TextureLoader 等需要 URL 的消费方）；未配置 origin 抛错 */
  url(path) {
    return requireBase() + path
  },

  /** 资产字节（GLB/二进制）；非 2xx 抛错（含状态码） */
  async bytes(path) {
    const resp = await this.fetch(this.url(path))
    if (!resp.ok) throw new Error(`asset ${path}: HTTP ${resp.status}`)
    return new Uint8Array(await resp.arrayBuffer())
  },

  /** 资产 JSON；非 2xx 抛错 */
  async json(path) {
    const resp = await this.fetch(this.url(path))
    if (!resp.ok) throw new Error(`asset ${path}: HTTP ${resp.status}`)
    return resp.json()
  },

  /** 资产 origin 是否已配置（UI 决定提示 vs 直接尝试） */
  configured() {
    return !!assetBase()
  },
}
