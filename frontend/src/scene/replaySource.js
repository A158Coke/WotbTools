// 回放数据源双通道（架构契约第 6 节）：本地 WASM 解析（文件不出本机）/ 服务端接口。
// 两通道产出同一 PlaybackData JSON 形状 → playbackScene 渲染层无感切换。
//
// WASM 产物由 scripts/build-wasm.ps1 构建到 frontend/public/wasm/（--target web），
// 经动态 import 惰性加载；产物缺失时本地通道拒绝并提示，服务端通道不受影响。

// 资产基址解析（契约 §13 同源/部署面二选一）——此前漏 import，serverMapUrl 内的
// assetUrl 是未声明自由变量：运行时 ReferenceError 被 try/catch 吞成"回退网格"，
// 全画质档地图/地形从此一个请求都不发（构建期无检查，npm run build 不报错）
import { assetBase, assetUrl } from './assetBase.js'

let wasmPromise = null

async function loadWasm() {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      // 运行时 URL：@vite-ignore 阻止构建期解析（产物由 scripts/build-wasm.ps1 生成到 public/wasm/）
      const spec = '/wasm/wotb_replay_wasm.js'
      const mod = await import(/* @vite-ignore */ spec)
      if (mod.default) await mod.default() // target web：初始化 .wasm 实例
      return mod
    })()
  }
  return wasmPromise
}

/** 服务端通道：POST /api/playback/data {file}（与既有行为逐字一致） */
export async function loadFromServer(file) {
  const resp = await fetch('/api/playback/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file }),
  })
  if (!resp.ok) throw new Error(await resp.text())
  return resp.json()
}

/** 本地通道：File/Blob → 浏览器文件接口 → WASM 解析 → 回放切面（契约 §6 纯客户端） */
export async function loadFromLocalFile(fileObject) {
  const mod = await loadWasm()
  const bytes = new Uint8Array(await fileObject.arrayBuffer())
  const envelope = JSON.parse(mod.parseReplayFacets(bytes))
  return envelope.playback
}

/**
 * 统一入口（playbackScene.loadData 委托至此）：
 * source = { kind: 'server', file } | { kind: 'local', file: File/Blob }
 */
export async function loadPlaybackData(source) {
  return source.kind === 'local'
    ? loadFromLocalFile(source.file)
    : loadFromServer(source.file)
}

// ---------- 地图静态路径（契约 §13 纯静态资产面；打包器 scripts/export_asset_pack.py 的布局） ----------
let mapIndexPromise = null
let currentMapKey = null

/** 一次性装载资产面索引（数字 id → key）；仅在配置了资产基址时请求 */
export function loadMapIndex() {
  if (!assetBase()) return Promise.resolve(null)
  if (!mapIndexPromise) {
    mapIndexPromise = fetch(assetUrl('/index.json'))
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
 * key 未解析/同源模式 → null，调用方回退服务端路由。
 * kind ∈ map | map-mini | terrain | terrain-meta | scenery | groundmeta | groundtex
 */
export function mapStaticUrl(kind, layer) {
  if (!currentMapKey || !assetBase()) return null
  const f = (name) => `${assetBase()}/map/${currentMapKey}/${name}`
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

/** 服务端路由 URL（动态镜像/同源回退，既有行为） */
export function serverMapUrl(kind, mapq, qSuffix = '') {
  const route = {
    map: '/api/playback/map',
    terrain: '/api/playback/terrain',
    scenery: '/api/playback/scenery',
    groundmeta: '/api/playback/groundmeta',
    groundtex: '/api/playback/groundtex',
  }[kind]
  return assetUrl(route) + '?' + mapq + qSuffix
}
