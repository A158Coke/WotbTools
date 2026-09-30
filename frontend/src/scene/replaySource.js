// 回放数据源（契约 v2）：**client-only**——本地 WASM 解析（文件不出本机），
// 无服务端通道。WotBTools Playback 拓扑不含 Business API / Agent 自托管服务端
//（评审 P0-3）；地图/地形/场景等渲染资产经 assetProvider 走 ?assets= 资产平面。
//
// WASM 产物由 CI 依据 deploy/agent/source.json 锁定的上游 Release 产物直取
//（fetch-agent-wasm.sh，sha256 校验）到 common/assets/wasm/，经 publicDir 进
// dist 伺服 /wasm/；产物缺失时本地通道拒绝并提示。

let wasmPromise = null

async function loadWasm() {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      // 运行时 URL：@vite-ignore 阻止构建期解析（产物由 CI fetch 步骤落位 publicDir）
      const spec = '/wasm/wotb_replay_wasm.js'
      const mod = await import(/* @vite-ignore */ spec)
      if (mod.default) await mod.default() // target web：初始化 .wasm 实例
      return mod
    })()
    wasmPromise.catch(() => {
      wasmPromise = null // 失败可重试
    })
  }
  return wasmPromise
}

/**
 * 本地通道（唯一通道）：File/Blob → 浏览器文件接口 → WASM parsePlayback →
 * PlaybackData（契约 v2 时序能力）。
 */
export async function loadFromLocalFile(fileObject) {
  const mod = await loadWasm()
  if (typeof mod.parsePlayback !== 'function') {
    throw new Error('agent wasm: parsePlayback 缺失（产物版本早于契约 v2）')
  }
  const bytes = new Uint8Array(await fileObject.arrayBuffer())
  return JSON.parse(mod.parsePlayback(bytes))
}

/**
 * 统一入口（playbackScene.loadData 委托至此）。
 * 仅接受 { kind:'local', file }；server 形态在 client-only 拓扑下不存在——
 * 显式拒绝而非静默吞掉，防止调用方误以为有服务端通道。
 */
export async function loadPlaybackData(source) {
  if (source && source.kind === 'local' && source.file) {
    return loadFromLocalFile(source.file)
  }
  throw new Error('回放数据源仅支持本地文件（client-only 拓扑，无服务端通道）')
}

// ---------- 地图静态路径（契约 §13 纯静态资产面；打包器 export_asset_pack.py 布局） ----------
// 全部经资产平面（?assets= 基址）；无同源 /api/playback/* 回退（client-only）。
import { assetBase } from './assetBase.js'

let mapIndexPromise = null
let currentMapKey = null

/** 一次性装载资产面索引（数字 id → key）；仅在配置了资产基址时请求 */
export function loadMapIndex() {
  if (!assetBase()) return Promise.resolve(null)
  if (!mapIndexPromise) {
    mapIndexPromise = fetch(assetBase() + '/index.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
  }
  return mapIndexPromise
}

/** 从 mapq（id=..&name=..）解析当前地图的静态 key；结果缓存供同步取用 */
export async function resolveMapKey(mapq) {
  const id = new URLSearchParams(mapq).get('id')
  const idx = assetBase() ? await loadMapIndex() : null
  currentMapKey = (idx && idx.maps && idx.maps[String(id)]) ? idx.maps[String(id)].key : null
  return currentMapKey
}

/**
 * 静态模式 URL（已配置基址且 index 命中 → 打包器物化路径）；
 * key 未解析/未配置基址 → null，调用方跳过该资产（无服务端回退）。
 * kind ∈ map | map-mini | terrain | terrain-meta | scenery | groundmeta | groundtex
 */
export function mapStaticUrl(kind, layer) {
  const base = assetBase()
  if (!currentMapKey || !base) return null
  const f = (name) => `${base}/map/${currentMapKey}/${name}`
  switch (kind) {
    case 'map': return f('ground.webp')
    case 'map-mini': return f('mini.webp')
    case 'terrain': return f('terrain.u16.bin')
    case 'terrain-meta': return f('terrain.json')
    case 'scenery': return f('scenery.glb')
    case 'groundmeta': return f('ground.layers.json')
    case 'groundtex': return f(`ground/${layer}.webp`)
  }
  return null
}
