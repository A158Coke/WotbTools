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
  if (patch.contactShadows !== undefined) url.searchParams.delete('contactshadows')
  if (patch.armorHighlight !== undefined && url.searchParams.has('armorhl')) {
    url.searchParams.set('armorhl', patch.armorHighlight ? '1' : '0')
  }
  return url
}
