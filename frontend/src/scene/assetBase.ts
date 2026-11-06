import { ANDROID_ASSET_BASE, isAndroidRuntime } from '../platform/runtime.js'
// 资产 origin 解析（见 docs/operations/agent-asset-origin.md）：GLB/地图/坦克静态数据的 remote asset origin。
// WotBTools Playback 拓扑 client-only：生产构建提供默认 remote asset origin；
// ?assets=<remote origin> 仅作为开发/运维 override，并持久化到 localStorage。
// 打包器 export_asset_pack.py 布局：/glb/*、/map/*、/tank/*、/tank_images/*、/data/*。
// 本模块只负责"origin 从哪里读"，不假设具体基础设施。生产构建默认由发布 workflow 配置，
// 后续迁移静态服务器/CDN/其它对象存储时只需更换构建配置，消费方无需改动。
// 解析优先级：URL 参数 > localStorage override > production build default。
//
// 数据版本（dataset）：
//   ?data=<dataset_id> / localStorage `wotb_data_version` 选中一个游戏版本，
//   资产基址变成 <origin>/v/<dataset_id>（Android 为 /agent-assets/v/<id>）。
//   未选中（或选中"默认"）时保持 origin 根路径 = 服务端 current，旧客户端语义不变。
//   `?assets=` 若已是一个带 /v/<id> 的完整基址，则原样使用，不再追加 data 段。

export const DATA_VERSION_QUERY = 'data'
export const DATA_VERSION_STORAGE = 'wotb_data_version'
export const ASSET_BASE_STORAGE = 'wotb_asset_base'
const DATASET_ID_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

const productionDefault = (import.meta.env.VITE_ASSET_BASE_URL ?? '').replace(/\/+$/, '')

let cachedOrigin: string | null = null
// 每个页面只解析一次 dataset：切换走整页重载（useDataVersion.select）。若每次调用都
// 重读共享 localStorage，另一个标签页切换 dataset 后本页会在未重载时突然改用新基址，
// 而模块级缓存（场景/map2d/资源）仍是旧 dataset 的内容（review P2）。
let cachedDataset: string | null | undefined

/** 显式选中的数据版本（页面级固定）；非法/空值视为未选中。 */
export function dataVersionId(): string | null {
  if (cachedDataset !== undefined) return cachedDataset
  cachedDataset = resolveDataVersion()
  return cachedDataset
}

/** 测试专用：清空页面级快照，等价于一次新的页面加载（生产代码不调用）。 */
export function __resetAssetBaseForTests(): void {
  cachedOrigin = null
  cachedDataset = undefined
}

function resolveDataVersion(): string | null {
  const q = searchParams().get(DATA_VERSION_QUERY)
  if (q !== null) {
    // 显式 ?data= 与运行手册一致地持久化：非空写、空/非法清除——否则下次不带
    // 查询参数进入时会静默回到上一次的 dataset，而不是保留本次显式选择/重置。
    const id = DATASET_ID_RE.test(q) ? q : null
    const store = browserStorage()
    if (store) {
      if (id) store.setItem(DATA_VERSION_STORAGE, id)
      else store.removeItem(DATA_VERSION_STORAGE)
    }
    return id
  }
  const stored = browserStorage()?.getItem(DATA_VERSION_STORAGE) ?? null
  return stored && DATASET_ID_RE.test(stored) ? stored : null
}

/** 测试/SSR 环境没有 location/localStorage：按未配置处理，而不是在模块加载期抛错。 */
function searchParams(): URLSearchParams {
  return new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
}

function browserStorage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

/** 去掉 `?assets=` 基址尾部的 `/v/<id>`，让选择器可以改回 origin + ?data=。 */
export function stripDatasetSuffix(origin: string): string {
  return origin.replace(/\/v\/[a-z0-9.-]+\/?$/, '')
}

function withDataset(origin: string): string {
  if (!origin) return ''
  // ?assets= 已经是完整版本基址：escape hatch 优先，不再叠加 ?data=。
  if (/\/v\/[a-z0-9.-]+\/?$/.test(origin)) return origin.replace(/\/+$/, '')
  const id = dataVersionId()
  return id ? `${origin.replace(/\/+$/, '')}/v/${id}` : origin
}

/** 不含 dataset 段的资产 origin（版本目录 versions.json 也从这个 origin 读）。 */
export function assetOrigin(): string {
  // APK CSP and readiness gate review one production gateway; Web keeps its overrides.
  if (isAndroidRuntime()) return ANDROID_ASSET_BASE
  if (cachedOrigin !== null) return cachedOrigin
  const q = searchParams().get('assets')
  const store = browserStorage()
  const override = q ?? store?.getItem(ASSET_BASE_STORAGE) ?? null
  const origin = (override || productionDefault).replace(/\/+$/, '')
  cachedOrigin = origin
  if (q !== null && store) {
    // 只持久化真正的显式 override。`?assets=`（显式空）是"清除 override"的手段：
    // 若把回落到的生产默认写进 localStorage，后续更换生产 origin 时这些浏览器会被
    // 旧值钉住，永远取不到新的构建默认。
    if (q) store.setItem(ASSET_BASE_STORAGE, origin)
    else store.removeItem(ASSET_BASE_STORAGE)
  }
  return origin
}

export function assetBase() {
  return withDataset(assetOrigin())
}

/** Android 本机代理基址（同样带 dataset 段；AgentAssetProxy 会把 /v/<id>/... 透传到 origin）。 */
export function androidAssetBase() {
  return withDataset(ANDROID_ASSET_BASE)
}
