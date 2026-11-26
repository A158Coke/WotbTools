// 3D 回放设置面板的 Draft / 保存差异（纯函数，无 Vue、无 DOM 依赖）。
// 面板只改 Draft；Save 时才用这里算出的差异调用场景：
//   · render = 画质 / Log Depth / 动态分辨率 / 接地阴影 —— 都会改变渲染上下文，已开播时
//     统一整页重载（接地阴影需要 stencil；不做热切换）；
//   · live   = 装甲高亮 / 炮声 —— 可在当前会话立即生效，绝不触发重载。
// 一份差异只携带一个 render patch，因此一次 Save 最多重载一次（计划里的显式约束）。
import type { QualityKey } from './quality.js'

export interface Replay3DSettings {
  qualityKey: QualityKey
  logdepth: boolean
  dynres: boolean
  armorHighlight: boolean
  contactShadows: boolean
  battleSound: boolean
}

export interface RenderSettingsPatch {
  qualityKey?: QualityKey
  logdepth?: boolean
  dynres?: boolean
  contactShadows?: boolean
  /** 仅用于同步 URL 已显式携带的 ?armorhl=；装甲高亮本身仍是 live 项。 */
  armorHighlight?: boolean
}

export interface ReplaySettingsLive {
  armorHighlight?: boolean
  battleSound?: boolean
}

export interface ReplaySettingsDiff {
  changed: boolean
  live: ReplaySettingsLive
  render: RenderSettingsPatch | null
}

/** Draft 与当前生效配置的差异；无实际修改时 changed=false、render=null。 */
export function replaySettingsDiff(draft: Replay3DSettings, current: Replay3DSettings): ReplaySettingsDiff {
  const render: RenderSettingsPatch = {}
  if (draft.qualityKey !== current.qualityKey) render.qualityKey = draft.qualityKey
  if (draft.logdepth !== current.logdepth) render.logdepth = draft.logdepth
  if (draft.dynres !== current.dynres) render.dynres = draft.dynres
  if (draft.contactShadows !== current.contactShadows) render.contactShadows = draft.contactShadows

  const live: ReplaySettingsLive = {}
  if (draft.armorHighlight !== current.armorHighlight) live.armorHighlight = draft.armorHighlight
  if (draft.battleSound !== current.battleSound) live.battleSound = draft.battleSound

  const renderChanged = render.qualityKey !== undefined || render.logdepth !== undefined
    || render.dynres !== undefined || render.contactShadows !== undefined
  return {
    changed: renderChanged || live.armorHighlight !== undefined || live.battleSound !== undefined,
    live,
    render: renderChanged ? render : null,
  }
}

/**
 * 重载 URL：URL 参数优先于 localStorage（preferences.boolPref），所以偏好若已由 URL 显式
 * 携带，重载前必须同步改写；URL 没写的参数保持不写（不把一次面板操作变成永久 URL 覆盖）。
 * q 同理：只有画质真的变了才写，避免给原本没有 ?q= 的地址钉上画质。
 * 接地阴影目标随 IndexedDB 暂存记录绑定 reloadId / File；这里只清掉旧 ?shadows=。
 * 装甲高亮是 live 项（写 localStorage），但 URL 已显式携带 ?armorhl= 时 URL 优先：
 * 重载前必须把刚写入的 live 值同步进 URL，否则重载会回到旧的 URL 值。
 * 原 URL 没有 ?armorhl= 时不新增，避免一次面板操作变成永久 URL 覆盖。
 */
export function buildRenderSettingsReloadUrl(href: string, patch: RenderSettingsPatch): URL {
  const url = new URL(href)
  if (patch.qualityKey !== undefined) url.searchParams.set('q', patch.qualityKey)
  if (patch.logdepth !== undefined && url.searchParams.has('logdepth')) {
    url.searchParams.set('logdepth', patch.logdepth ? '1' : '0')
  }
  if (patch.dynres !== undefined && url.searchParams.has('dynres')) {
    url.searchParams.set('dynres', patch.dynres ? '1' : '0')
  }
  url.searchParams.delete('shadows')
  if (patch.armorHighlight !== undefined && url.searchParams.has('armorhl')) {
    url.searchParams.set('armorhl', patch.armorHighlight ? '1' : '0')
  }
  return url
}
