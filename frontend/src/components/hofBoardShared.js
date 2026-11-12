// HoFPage 三个榜单（单场 / 百场 / 三环）共用的纯函数与无状态 composable。
// 只服务 HoFPage 及其 Hof* 子组件；管理页有自己的实现，不在此共用。
import { computed, nextTick, watch } from 'vue'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useAuth } from '../composables/useAuth.js'
import { replayValueLabel } from '../utils/display.js'

/** 名人堂联网门禁 + 登录门禁（包装既有 useFeatureGate / useAuth，不持有状态）。 */
export function useHofAccess() {
  const { isAuthenticated, login } = useAuth()
  const { availability, requireFeature } = useFeatureGate()
  const hofAvailability = computed(() => availability(Feature.HALL_OF_FAME))
  function requireHofOnline() { return requireFeature(Feature.HALL_OF_FAME) }
  function requireLogin() {
    if (!requireHofOnline()) return false
    if (isAuthenticated()) return true
    login('hof')
    return false
  }
  return { hofAvailability, isAuthenticated, requireHofOnline, requireLogin }
}

/**
 * 失联纪元：名人堂变为不可用时自增，在途请求据此丢弃结果；`onLost` 由状态 owner 复位自己的 loading / generation。
 * 恢复后的重新加载由 HoFPage 统一编排（只有它知道当前 URL 与 tab）。
 */
export function useHofEpoch(hofAvailability, onLost) {
  let epoch = 0
  watch(() => hofAvailability.value.available, (available) => {
    if (available) return
    epoch++
    onLost()
  })
  return () => epoch
}

export function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort()
}

export function vehicleHint(...parts) {
  return parts.filter(Boolean).join(' · ')
}

export function vehicleValueLabel(t, te, value) {
  return value ? replayValueLabel(t, te, value) : ''
}

/** 百场 / 三环车辆选项：全部是 Tier X，提示里只放国家 / 车种。 */
export function tierXPickerOption(t, te, vehicle) {
  return {
    id: vehicle.id,
    label: vehicle.name,
    hint: vehicleHint(vehicleValueLabel(t, te, vehicle.nation), vehicleValueLabel(t, te, vehicle.vehicleType)),
  }
}

/** 手机筛选 chip：国家 / 车种 / 车辆。 */
export function vehicleChips(t, te, nation, type, vehicleName) {
  return [
    nation && { key: 'nation', label: vehicleValueLabel(t, te, nation) },
    type && { key: 'type', label: vehicleValueLabel(t, te, type) },
    vehicleName && { key: 'vehicle', label: vehicleName },
  ].filter(Boolean)
}

/** 按车辆 id 在个人状态列表（pending / current）里找对应条目。 */
export function findVehicleStatus(items, vehicleId) {
  if (!vehicleId) return null
  return (items || []).find(item => Number(item.vehicleId) === Number(vehicleId)) || null
}

/** 接口返回 totalItems 时显示总数；缺失时只显示页码。 */
export function pageTotalItems(res) {
  return Number.isInteger(res?.totalItems) ? res.totalItems : null
}

export function rankClass(rank) {
  return rank === 1 ? 'rk-gold' : rank === 2 ? 'rk-silver' : rank === 3 ? 'rk-bronze' : ''
}

export function formatHofNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString() : '—'
}

export function formatHofWinRate(value) {
  const number = Number(value)
  return Number.isFinite(number)
    ? `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
    : '—'
}

export function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 翻页后回到当前榜单的表格顶部（审计 PG-07）。表格容器自身也会纵向滚动（PG-06 表头吸顶），一并复位。
 * 表格顶部已在吸顶 Tab 下方可见时不滚动页面；偏移量读表格的 scroll-margin-top（与吸顶 Tab 同一 CSS 变量）。
 */
export function scrollBoardIntoView(paneRef) {
  nextTick(() => {
    const board = paneRef.value?.querySelector?.('[data-hof-board]')
    if (!board || typeof board.getBoundingClientRect !== 'function') return
    board.scrollTop = 0
    const offset = parseFloat(window.getComputedStyle?.(board).scrollMarginTop) || 0
    if (board.getBoundingClientRect().top < offset) board.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  })
}

export function replayFileKey(file) {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`
}

export const REPLAY_EVIDENCE_COUNT = 5

/**
 * 百场 / 三环回放证据的多选合并：只收 .wotbreplay、按文件身份去重、总数不超过 5。
 * 返回 `error`（'type' | 'limit' | null）；出错时 additions 为空，调用方不改动已有列表。
 */
export function mergeReplayFiles(existing, files) {
  if (files.some(file => !file.name.toLowerCase().endsWith('.wotbreplay'))) {
    return { error: 'type', additions: [], duplicateCount: 0 }
  }
  const knownKeys = new Set(existing.map(replayFileKey))
  const additions = []
  let duplicateCount = 0
  for (const file of files) {
    const key = replayFileKey(file)
    if (knownKeys.has(key)) {
      duplicateCount++
      continue
    }
    knownKeys.add(key)
    additions.push(file)
  }
  if (existing.length + additions.length > REPLAY_EVIDENCE_COUNT) {
    return { error: 'limit', additions: [], duplicateCount }
  }
  return { error: null, additions, duplicateCount }
}
