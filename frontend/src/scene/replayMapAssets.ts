// 地图静态路径（logical asset path；打包器 export_asset_pack.py 布局）——自 replaySource.ts
// 出仓（2026-11-21 #LOC 结构拆分：代码与搬移前逐字一致，公共入口仍由 replaySource re-export）。
// 一律经 assetProvider（消费方不拼接任何基础设施域名）；无同源 /api/playback/* 回退（client-only）。
import { assetProvider } from './assetProvider.js'
import type { Map2dIndex, Map2dBounds } from '../data/map2dOverlay.js'

let mapIndexPromise: Promise<{ maps?: Record<string, { key: string }> } | null> | null = null
/** 已点名告警过的索引 miss（按 id 去重）：同一张图反复加载不刷屏 */
const mapIndexMissWarned = new Set<string>()

/** 一次性装载资产源索引（数字 id → key）；未配置 origin 时为空。
 *  **失败不缓存**：index.json 一次瞬时失败（CDN 抖动 / 5xx / 超时）不得把整个页面会话
 *  钉死在"无地图"上——resolvedKey 为 null 时所有地图资产 URL 都是 null，资产阶段照常
 *  走完（缺失按完成计），场景只剩占位地面/网格，用户看到"加载完成却没地图"。
 *  失败即置空 promise 并告警，下一场回放加载时重试（与 tankNamesStatic 同一模式）；
 *  成功结果仍整页缓存（每场 loadMapImage 都要查一次）。 */
export function loadMapIndex() {
  if (!assetProvider.configured()) return Promise.resolve(null)
  if (!mapIndexPromise) {
    mapIndexPromise = assetProvider.json('/index.json').catch((e: unknown) => {
      mapIndexPromise = null
      console.warn('地图资产索引加载失败（本场地图回退占位网格；下次加载重试）:', e)
      return null
    })
  }
  return mapIndexPromise
}

/** 从 mapq（id=..&name=..）解析静态 key；由调用方持有结果，不发布模块级会话状态。
 *  索引 miss（origin 已配置、索引也加载成功，但这张图的 id 不在索引里）是"这张图永远
 *  出不了地图"的一类（资产包过期 / 新图未入库），且 UI 上与"资产源没配 / 索引没拉到"
 *  无法区分——console 里点名 id。索引本身加载失败的情况由 loadMapIndex 的告警覆盖。 */
export async function resolveMapKey(mapq: string) {
  const id = new URLSearchParams(mapq).get('id')
  const idx = assetProvider.configured() ? await loadMapIndex() : null
  const hit = idx && idx.maps && idx.maps[String(id)]
  if (idx && !hit && id && !mapIndexMissWarned.has(String(id))) {
    mapIndexMissWarned.add(String(id))
    console.warn('地图不在资产索引中（资产包过期或缺该地图？）: id=' + id)
  }
  return hit ? hit.key : null
}

/** 测试专用：清空地图索引缓存与 miss 告警去重（模块级状态不得跨用例泄漏） */
export function __resetMapIndexForTest() {
  mapIndexPromise = null
  mapIndexMissWarned.clear()
}

/**
 * 地图预览封面的轻量 URL（HUD 小地图 `mini.webp`，512² / 44–112KB）：仅作 picker
 * 缩略图——帧宽约 620m > ±300 契约框，**不进** 2D 坐标系（那仍是 ground.webp 的职责）。
 * 资产包每张图都有；Android 离线门控可抛（NETWORK_ERROR），调用方兜底。
 */
export function mapCoverUrl(mapKey: string | null | undefined) {
  if (!mapKey || !assetProvider.configured()) return null
  return assetProvider.url(`/cover/${mapKey}.webp`)
}

/**
 * 地图预览 2D 底图（canonical 1254² 战术风格——export_2d_basemaps 产物）。
 * 未收录打包注册表的图在预览 2D 模式用这份（bundled 仍用打包 webp，离线优先）。
 *
 * **必须经 `map2d/index.json` 的几何/完整性契约**（与仓库既有 `data/map2dOverlay.js`
 * 同一判据，不另建 SSOT）：schema + generated 有效、逐图 worldBounds/orientation 与
 * 注册表逐值一致、图片字节 sha256 与索引一致——三者任一不成立即 fail-closed。
 * `/map2d/<key>.webp` 是 mutable URL：上游重裁/改框后仅凭"能加载"就按 ±300 渲染
 * 会整体错位且无报错。
 */
export function map2dCanonicalUrl(mapKey: string | null | undefined) {
  if (!mapKey || !assetProvider.configured()) return null
  return assetProvider.url(`/map2d/${mapKey}.webp`)
}

let map2dIndexPromise: Promise<Map2dIndex | null> | null = null

/** 资产包 `map2d/index.json`（整页缓存；失败置空下轮重试，与 loadMapIndex 同模式）。 */
export function loadMap2dIndex() {
  if (!assetProvider.configured()) return Promise.resolve(null)
  if (!map2dIndexPromise) {
    map2dIndexPromise = assetProvider.json<Map2dIndex>('/map2d/index.json').catch((e) => {
      map2dIndexPromise = null
      console.warn('map2d 索引加载失败（预览 2D 底图 fail-closed）:', e)
      return null
    })
  }
  return map2dIndexPromise
}

/** 测试专用：清空 map2d 索引缓存 */
export function __resetMap2dIndexForTest() {
  map2dIndexPromise = null
}

async function sha256Hex(buffer: ArrayBuffer) {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('crypto.subtle 不可用（需要安全上下文）')
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 解析预览 2D 底图：按 `map2d/index.json` 校验几何 + 完整性后返回
 * `{ url, bytes, sha256, width, height, worldBounds, orientation }`；任一判据不成立
 * 返回 `{ error: 'index'|'entry'|'geometry'|'integrity'|'offline', detail? }`。
 *
 * `expectedBounds`：注册表世界框（`mapImages[key].coordinateBounds` 或 ±300 派生）——
 * 索引声明必须与之逐值一致（几何契约的比对面）。
 */
export async function resolveMap2dBasemap(
  mapKey: string | null | undefined,
  expectedBounds: Map2dBounds | null | undefined,
  fetchImpl: ((url: string) => Promise<Response>) | null = null,
) {
  const key = String(mapKey || '')
  if (!key) return { error: 'entry' }
  const url = map2dCanonicalUrl(key)
  if (!url) return { error: 'offline' }
  // map2d/index.json 条目形状（runtime guard：isValidIndex 验 schema/timestamp，
  // geometryMatches 验 geometry 与注册表逐值相等——sha256/width/height/worldBounds 只在
  // 通过这两个 guard 的条目上读取，与 JS 时代同一信任结构）
  const index = await loadMap2dIndex()
  // 延迟导入避免 replaySource ← map2dOverlay 的循环（map2dOverlay 只依赖本地常量）
  const { isValidIndex, geometryMatches } = await import('../data/map2dOverlay.js')
  if (!isValidIndex(index)) return { error: 'index' }
  const entry = index?.maps?.[String(key)]
  if (!entry) return { error: 'entry' }
  if (!geometryMatches(entry, expectedBounds)) return { error: 'geometry' }
  const doFetch = fetchImpl || ((u: string) => assetProvider.fetch(u))
  let buffer: ArrayBuffer
  try {
    const resp = await doFetch(url)
    if (!resp || !resp.ok) return { error: 'integrity', detail: `http ${resp && resp.status}` }
    buffer = await resp.arrayBuffer()
  } catch (e) {
    return { error: 'integrity', detail: String(e && (e as Error).message || e) }
  }
  let sha
  try {
    sha = await sha256Hex(buffer)
  } catch (e) {
    return { error: 'integrity', detail: String(e && (e as Error).message || e) }
  }
  if (sha !== entry.sha256) return { error: 'integrity', detail: 'sha256 mismatch' }
  return {
    bytes: buffer,
    sha256: sha,
    width: entry.width,
    height: entry.height,
    // 世界框取自**索引声明**（不硬编码）：geometryMatches 已保证它与注册表逐值相等
    worldBounds: entry.worldBounds,
    orientation: entry.orientation,
  }
}

/**
 * 静态模式 URL（已配置 origin 且 index 命中 → 打包器物化路径）；
 * mapKey 由当前会话显式传入；未解析/未配置 origin → null，调用方跳过该资产（无服务端回退）。
 * kind ∈ map | terrain | terrain-meta | scenery | groundmeta | groundtex
 * （客户端 HUD 小地图 `minimap` res=mini **不再被消费**：它覆盖约 620 m > ±300 契约框，见
 *  playbackScene.loadMapImage 的说明与 Agent 仓 docs/game-data-sources.md §5.7）
 */
export function mapStaticUrl(kind: string, layer: string | null | undefined, mapKey: string | null | undefined) {
  if (!mapKey || !assetProvider.configured()) return null
  const f = (name: string) => assetProvider.url(`/map/${mapKey}/${name}`)
  switch (kind) {
    case 'map': return f('ground.webp')
    case 'terrain': return f('terrain.u16.bin')
    case 'terrain-meta': return f('terrain.json')
    case 'scenery': return f('scenery.glb')
    // 逐图光照参数（上游 tools/export_map_lighting.py：太阳方向/色/强度 + 环境色 + 雾 + IBL）。
    // 缺失（旧包）→ 3D 侧保留硬编码灯光，不阻断加载。
    case 'lighting': return f('lighting.json')
    // 逐图 IBL 环境贴图（上游 tools/export_map_ibl.py：等距柱状投影，喂 scene.environment）。
    // 缺失（旧包）→ 不设环境贴图（坦克仍按 neutralizeDefaultMetalness 的金属度归零口径渲染）
    case 'ibl': return f('ibl.webp')
    // 可破坏物清单（逆向总集 §5.4 的 (cell,slot) 联表；缺失时 3D 侧静默禁用该特性）
    case 'destructibles': return f('destructibles.json')
    // 投影贴花（上游 tools/export_map_glb.py 的 decals.json + 图集；2026-11-17 审计 B9。
    // 当前内容仅 plant 有；缺失（其余图/旧包）→ 无贴花层，不阻断加载）
    case 'decals': return f('decals.json')
    // 草层（上游 grass.json / grass.bin / grass.glb；2026-11-17 审计 H1。
    // 缺失（旧包/无草图）→ 不画草层，不阻断）
    case 'grass': return f('grass.json')
    case 'grassbin': return f('grass.bin')
    case 'grassproto': return f('grass.glb')
    case 'groundmeta': return f('ground.layers.json')
    case 'groundtex': return f(`ground/${layer}.webp`)
  }
  return null
}
