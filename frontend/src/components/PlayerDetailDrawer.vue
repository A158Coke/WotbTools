<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PlayerRatingRadar from './PlayerRatingRadar.vue'
import { CW_DIM_KEYS } from '../utils/playerSummaryMerge.js'
import { leagueMaxByKey, ratingTotalText } from '../utils/helpers.js'
import { battleAverage, globalAverage } from '../utils/radarReference.js'
import {
  RADAR_METRIC_DEFS, RADAR_AVAILABLE_KEYS, RADAR_MIN_AXES, RADAR_MAX_AXES,
  loadRadarPreference, saveRadarPreference, resolveRadarMetric,
} from '../utils/radarMetrics.js'
import { formatRadarVisualScore, scaleRadarSeries } from '../utils/radarScale.js'
import {
  RADAR, axisPoint, axisRay, polygonPoints, radarGridPolygons, radarScaleTicks,
  radarScoreLabelLayout,
} from '../utils/radarGeometry.js'
import { sanitizeFilename, downloadBlob } from '../utils/exportReplayPng.js'

/**
 * 选手详情 Side Drawer。
 * - position: fixed 右侧 overlay，不占 Table 布局空间。
 * - 打开时 focus 关闭按钮；Escape / × / backdrop 关闭；关闭后 focus 回到触发行。
 * - selection identity = accountId：排序/刷新后由父组件按 accountId 重新 resolve 数据。
 * - scope 语义：summary = 当前批次（V5 Rating + Observed Median + Rated Battles 头部；
 *   Radar 用 dimensionMeans → Global Average）；battle = 本场表现（V4.1 单场 Rating +
 *   本场七维 dimensionScores → Battle Average；禁止使用 dimensionMeans/Medians）。
 * - Radar：默认七维（仅 League 维度，§8），用户可自定义 3–7 个指标/顺序（presentation-only，
 *   独立于 Table ColumnPicker，独立 localStorage）；axis 缺失 → 整图 unavailable（§24）。
 *   League 几何只使用 raw/reference 相对标尺；resp.league.columns max 仅解释 raw 明细，不参与半径。
 * - 参考多边形（Battle/Global Average）由 utils/radarReference.js 纯函数计算；V5 不影响几何。
 */
const props = defineProps({
  /** 当前选中上下文；null = 关闭。 */
  context: { type: Object, default: null },
  /** Drawer 标题区域数据（父组件已按 context 解析好当前行）。 */
  player: { type: Object, default: null },
  /** League Rating 列满分元数据（resp.league.columns：key → max）。 */
  leagueColumns: { type: Array, default: () => [] },
  /** 当前 scope 的玩家集合（summary=unifiedRows，battle=本场 players），用于参考平均。 */
  scopePlayers: { type: Array, default: () => [] },
  /** 前后导航可用性（父组件按当前可见表格顺序决定，§29/§31）。 */
  hasPrev: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'prev', 'next'])
const { t } = useI18n()

const open = computed(() => !!props.context && !!props.player)
const closeBtn = ref(null)
const isSummary = computed(() => props.context?.scope === 'summary')

// 桌面/平板非模态侧栏，移动端(<768px)保持 modal：复用现有 mobile 断点（max-width: 767px）。
const isMobile = ref(typeof window !== 'undefined' ? window.innerWidth <= 767 : false)
// 仅 Desktop (>=1200px) 提供自由 resize；Tablet/Mobile 保持原有行为。
const isDesktop = ref(typeof window !== 'undefined' ? window.innerWidth >= 1200 : true)
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1440)

// ---- Side Panel 自由 Resize（仅桌面）----
const DRAWER_MIN = 320
const DRAWER_DEFAULT = 380
const DRAWER_MAX_RATIO = 0.45
const DRAWER_WIDTH_KEY = 'radarSidePanelWidth'
const drawerWidth = ref(DRAWER_DEFAULT)
const isResizing = ref(false)
const resizeStartX = ref(0)
const resizeStartWidth = ref(0)
const resizeHandle = ref(null)

/** 动态 max-width：约 45% 视口，且至少 min、绝不超过视口已留边（保证主内容不被完全挤没）。 */
function drawerMaxWidth() {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
  return Math.max(DRAWER_MIN, Math.min(Math.floor(vw * DRAWER_MAX_RATIO), vw - 16))
}
function clampDrawerWidth(w) {
  return Math.max(DRAWER_MIN, Math.min(drawerMaxWidth(), w))
}
function loadDrawerWidth() {
  try {
    const raw = localStorage.getItem(DRAWER_WIDTH_KEY)
    if (raw == null) return DRAWER_DEFAULT
    const n = Number(raw)
    return Number.isFinite(n) ? clampDrawerWidth(n) : DRAWER_DEFAULT
  } catch (_) {
    return DRAWER_DEFAULT
  }
}
function saveDrawerWidth(w) {
  try { localStorage.setItem(DRAWER_WIDTH_KEY, String(w)) } catch (_) { /* 忽略持久化失败 */ }
}
/** 仅更新内存宽度（拖动中高频调用，不写 localStorage）。 */
function applyDrawerWidth(w) {
  drawerWidth.value = clampDrawerWidth(w)
}
function setDrawerWidth(w) {
  applyDrawerWidth(w)
  saveDrawerWidth(drawerWidth.value)
}
const resizerLeftPx = computed(() =>
  isDesktop.value ? Math.max(0, viewportWidth.value - drawerWidth.value - 8) : 0)

function onResizeStart(e) {
  if (!isDesktop.value || !open.value) return
  e.preventDefault()
  resizeStartX.value = e.clientX
  resizeStartWidth.value = drawerWidth.value
  isResizing.value = true
  const h = resizeHandle.value
  if (h && typeof h.setPointerCapture === 'function') {
    try { h.setPointerCapture(e.pointerId) } catch (_) { /* happy-dom 无 Pointer Capture */ }
  }
  document.body.style.userSelect = 'none'
  document.body.classList.add('pd-resizing')
}
function onResizeMove(e) {
  if (!isResizing.value) return
  applyDrawerWidth(resizeStartWidth.value + (resizeStartX.value - e.clientX))
}
function onResizeEnd() {
  if (!isResizing.value) return
  isResizing.value = false
  saveDrawerWidth(drawerWidth.value) // 拖动结束才持久化一次
  document.body.style.userSelect = ''
  document.body.classList.remove('pd-resizing')
}
/** 键盘调整：每次 20px。 */
function onResizeKey(delta) {
  if (!isDesktop.value) return
  setDrawerWidth(drawerWidth.value + delta)
}

/** Side Panel 真 reflow：桌面(>=1200px)开启时把抽屉宽度暴露成 CSS 变量，
 * 供 .layout-data-workspace 预留右侧空间，主内容随之收窄/扩展，不再被 fixed overlay 覆盖；
 * tablet/mobile 保持原有 overlay 行为（offset=0px）。 */
const workspaceOffset = computed(() =>
  isDesktop.value && open.value ? (drawerWidth.value + 8) + 'px' : '0px')
watch([isDesktop, open, drawerWidth], () => {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--pd-drawer-offset', workspaceOffset.value)
  }
}, { immediate: true })

function updateViewport() {
  const w = window.innerWidth
  isMobile.value = w <= 767
  isDesktop.value = w >= 1200
  viewportWidth.value = w
  // 屏幕尺寸变化时自动 clamp 当前宽度，不强制写回 localStorage。
  drawerWidth.value = clampDrawerWidth(drawerWidth.value)
}
function bindMobile() { updateViewport(); window.addEventListener('resize', updateViewport) }
function unbindMobile() { window.removeEventListener('resize', updateViewport) }

function num(v) {
  return (v == null || v === '' || !Number.isFinite(Number(v))) ? '--' : String(Math.round(Number(v) * 10) / 10)
}

/** 顶部 Rating 信息：缺失 → '--'；总 Rating 格式化统一走 helpers.ratingTotalText。
 *  rating 语义由父组件按 scope 提供：summary = V5 Batch Player Rating，battle = V4.1 单场。 */
function ratingLine() {
  const p = props.player
  if (!p) return { rating: '--' }
  return { rating: ratingTotalText(p.rating) }
}

// ---- Radar Metric Selection：默认七维，仅 League 维度；Summary/Battle 共用同一配置 ----
const radarOrder = ref(loadRadarPreference())
const showRadarPicker = ref(false)
const radarHint = ref('')

function persistRadarOrder() {
  saveRadarPreference(radarOrder.value)
}

function toggleRadarMetric(key) {
  const cur = [...radarOrder.value]
  const idx = cur.indexOf(key)
  if (idx >= 0) {
    if (cur.length <= RADAR_MIN_AXES) {
      radarHint.value = t('league.drawer.radar_min_hint', { n: RADAR_MIN_AXES })
      return
    }
    cur.splice(idx, 1)
    radarHint.value = ''
  } else {
    if (cur.length >= RADAR_MAX_AXES) {
      radarHint.value = t('league.drawer.radar_max_hint', { n: RADAR_MAX_AXES })
      return
    }
    cur.push(key)
    radarHint.value = ''
  }
  radarOrder.value = cur
  persistRadarOrder()
}

function moveRadarMetric(key, dir) {
  const cur = [...radarOrder.value]
  const idx = cur.indexOf(key)
  const to = idx + dir
  if (idx < 0 || to < 0 || to >= cur.length) return
  const [moved] = cur.splice(idx, 1)
  cur.splice(to, 0, moved)
  radarOrder.value = cur
  persistRadarOrder()
}

const maxByKey = computed(() => leagueMaxByKey(props.leagueColumns))

/** player 雷达原始轴（顺序 = 用户偏好；league 维度按 scope 取数：
 *  summary → dimensionMeans[i]（rated-battle 算术平均），battle → dimensionScores[i]
 *  （本场七维）；score/max 仅保留解释值，最终几何由 radarScale 相对 reference 生成。禁止 battle 复用跨场聚合字段、
 *  禁止 summary 用 median 冒充 mean。 */
const rawRadarMetrics = computed(() => {
  const p = props.player
  if (!p) return []
  return radarOrder.value
    .map((key) => {
      const def = RADAR_METRIC_DEFS[key]
      if (!def) return null
      const idx = CW_DIM_KEYS.indexOf(key)
      const raw = isSummary.value ? p.dimensionMeans?.[idx] : p.dimensionScores?.[idx]
      const resolved = resolveRadarMetric(key, raw, maxByKey.value)
      return { ...resolved, label: t(resolved.label), tip: def.tipKey ? t(def.tipKey) : '' }
    })
    .filter(Boolean)
})

/** 参考多边形（Battle/Global Average）：不依赖选中玩家，只依赖 scope（§61）。 */
const rawReferenceSeries = computed(() => {
  const ref = isSummary.value
    ? globalAverage(props.scopePlayers, { dimKeys: radarOrder.value })
    : battleAverage(props.scopePlayers, { dimKeys: radarOrder.value })
  return ref.axes.map((a) => {
    const r = resolveRadarMetric(a.key, a.rawValue, maxByKey.value)
    const def = RADAR_METRIC_DEFS[a.key]
    return { ...r, label: t(r.label), tip: def.tipKey ? t(def.tipKey) : '' }
  })
})

const scaledRadarSeries = computed(() =>
  scaleRadarSeries(rawRadarMetrics.value, rawReferenceSeries.value))

const radarMetrics = computed(() => scaledRadarSeries.value.metrics)
const referenceSeries = computed(() => scaledRadarSeries.value.reference)

const referenceLabel = computed(() =>
  isSummary.value ? t('league.drawer.global_average') : t('league.drawer.battle_average'))

/** D2 缺维契约：player 缺任一所选维 → 整图 unavailable（§24）。 */
const playerUnavailable = computed(() =>
  radarMetrics.value.length > 0 && radarMetrics.value.some(m => !m.available))

// ---- 表现指标（Performance Metrics；独立区域，不是 Rating）----
const perfFacts = computed(() => {
  const p = props.player
  if (!p) return []
  return ['contribution', 'kast', 'impact'].map((key) => {
    const v = p.cells?.[key]
    const display = (v == null || v === '' || !Number.isFinite(Number(v)))
      ? '--'
      : (Math.round(Number(v) * 10) / 10) + '%'
    return [t('player_labels.' + key), display]
  })
})

// ---- 比赛事实（scope 语义）；Raw Median / Rated Battles 已移入头部（§6），不在此重复 ----
const facts = computed(() => {
  const p = props.player
  if (!p) return []
  const rows = []
  if (isSummary.value) {
    rows.push([t('league.drawer.battles'), p.cells?.battles ?? '--'])
    rows.push([t('league.drawer.wins'), p.cells?.wins ?? '--'])
    if (p.cells?.win_rate != null) rows.push([t('league.drawer.win_rate'), num(p.cells.win_rate) + '%'])
    if (p.mvpCount != null) rows.push([t('league.drawer.mvp'), p.mvpCount])
    rows.push([t('league.drawer.damage_avg'), num(p.cells?.damage_avg)])
    rows.push([t('league.drawer.assist_avg'), num(p.cells?.assisted_avg)])
    rows.push([t('league.drawer.kills_avg'), num(p.cells?.kills_avg)])
    rows.push([t('league.drawer.earned_avg'), num(p.cells?.earned_avg)])
  } else {
    rows.push([t('league.drawer.damage'), num(p.cells?.damage_dealt)])
    rows.push([t('league.drawer.assist'), num(p.cells?.damage_assisted)])
    rows.push([t('league.drawer.kills'), p.cells?.kills ?? '--'])
    rows.push([t('league.drawer.blocked'), num(p.cells?.damage_blocked)])
    rows.push([t('league.drawer.shots'), p.cells?.n_shots ?? '--'])
    rows.push([t('league.drawer.hits'), p.cells?.n_hits_dealt ?? '--'])
    rows.push([t('league.drawer.pens'), p.cells?.n_penetrations_dealt ?? '--'])
    rows.push([t('league.drawer.survived'),
      p.cells?.survived_label === 'SURVIVED' ? t('survived.alive')
        : p.cells?.survived_label === 'DESTROYED' ? t('survived.dead') : '--'])
    rows.push([t('league.drawer.points_earned'), p.cells?.victory_points_earned ?? '--'])
  }
  return rows
})

// ---- 坦克展示（Summary=当前批次最常使用；Battle=本场坦克）----
// 可靠坦克名：非空、非占位名（Tankopedia 对未知 ID 返回 "#<tankId>"）；不满足则视为无可靠车辆。
const isReliableTankName = (name) => {
  const s = (name || '').trim()
  return !!s && !s.startsWith('#')
}
const vehicle = computed(() => {
  const p = props.player
  if (!p) return null
  if (isSummary.value) {
    const muv = p.mostUsedVehicle
    if (!muv || muv.tankId == null || !isReliableTankName(muv.tankName)) return null
    const rate = (p.ratedBattles && p.ratedBattles > 0) ? (muv.battles / p.ratedBattles) : null
    return {
      label: t('league.drawer.most_used_vehicle'),
      tankName: (muv.tankName || '').trim(),
      battleText: t('league.drawer.vehicle_battles', { n: muv.battles }),
      rateText: rate != null ? (Math.round(rate * 1000) / 10) + '%' : '',
      tankId: muv.tankId,
    }
  }
  const tankId = Number(p.tankId)
  if (!Number.isFinite(tankId) || tankId <= 0 || !isReliableTankName(p.tankName)) return null
  return {
    label: t('league.drawer.battle_vehicle'),
    tankName: (p.tankName || '').trim(),
    battleText: '',
    rateText: '',
    tankId,
  }
})

// 懒加载坦克贴图：动态 import 保持 vehicle-portraits/runtime.js 独立 lazy chunk；
// token 防止快速切换选手时旧异步结果覆盖新选手。
const vehiclePortrait = ref(null)
const vehiclePortraitToken = ref(0)
let portraitRuntimePromise = null
function loadPortrait(tankId) {
  if (tankId == null) return Promise.resolve(null)
  if (!portraitRuntimePromise) {
    portraitRuntimePromise = import('../vehicle-portraits/runtime.js')
  }
  return portraitRuntimePromise
    .then((m) => m.loadVehiclePortrait(tankId))
    .catch(() => null)
}
watch(vehicle, async (v) => {
  const token = ++vehiclePortraitToken.value
  vehiclePortrait.value = null
  if (!v || v.tankId == null) return
  const url = await loadPortrait(v.tankId)
  if (token !== vehiclePortraitToken.value) return
  vehiclePortrait.value = url
}, { immediate: true })

// ---- 前后导航（方向驱动切换动画）----
const navDir = ref('next')
function onPrev() { navDir.value = 'prev'; emit('prev') }
function onNext() { navDir.value = 'next'; emit('next') }

// ---- 关闭 slide-out（§34）----
const closing = ref(false)
function requestClose() {
  if (closing.value) return
  closing.value = true
  setTimeout(() => { closing.value = false; emit('close') }, 170)
}

// ---- 键盘导航（§32）：Esc 关闭；←/→ 切玩家；避开输入控件 ----
function isEditable(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}
function onKeydown(e) {
  if (!open.value) return
  if (e.key === 'Escape') {
    if (!isEditable(e.target)) requestClose()
  } else if (e.key === 'ArrowLeft' && !isEditable(e.target)) {
    onPrev()
  } else if (e.key === 'ArrowRight' && !isEditable(e.target)) {
    onNext()
  }
}

watch(open, (v) => {
  if (v) nextTick(() => closeBtn.value?.focus?.())
})

onMounted(() => { window.addEventListener('keydown', onKeydown); drawerWidth.value = loadDrawerWidth(); bindMobile() })
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  unbindMobile()
  document.body.style.userSelect = ''
  document.body.classList.remove('pd-resizing')
  if (typeof document !== 'undefined') document.documentElement.style.removeProperty('--pd-drawer-offset')
})

// ---- 导出 Rating Profile PNG（§41-48）：专用卡片（非 Drawer 截图）----
// 导出前捕获不可变快照，offscreen 卡只消费快照——导出期间切换玩家不产生“新玩家数据 + 旧坦克图”混合 PNG。
const exportingProfile = ref(false)
const exportCardRef = ref(null)
const exportPortrait = ref(null)
const exportSnapshot = ref(null)

// 出口卡只消费 exportSnapshot（快照未建时为空/占位），禁止再读实时 props/vehicle/radarMetrics/referenceSeries。
const snapIsSummary = computed(() => !!exportSnapshot.value?.isSummary)
const snapNickname = computed(() => exportSnapshot.value?.nickname || '--')
const snapRating = computed(() => exportSnapshot.value?.rating || '--')
const snapRawMedian = computed(() => exportSnapshot.value?.rawMedian ?? null)
const snapRatedBattles = computed(() => exportSnapshot.value?.ratedBattles ?? null)
const snapReferenceLabel = computed(() => exportSnapshot.value?.referenceLabel || '')
const snapVehicle = computed(() => exportSnapshot.value?.vehicle || null)
const snapMetrics = computed(() => exportSnapshot.value?.metrics || [])
const snapRefs = computed(() => exportSnapshot.value?.refs || [])
const snapPlayerPoints = computed(() => exportSnapshot.value?.playerPoints || [])
const snapRefPoints = computed(() => exportSnapshot.value?.refPoints || [])
const snapGrids = computed(() => exportSnapshot.value?.grids || [])
const snapAxes = computed(() => exportSnapshot.value?.axes || [])
const snapLabels = computed(() => exportSnapshot.value?.labels || [])
const snapScoreLabels = computed(() => exportSnapshot.value?.scoreLabels || [])
const snapScaleTicks = computed(() => exportSnapshot.value?.scaleTicks || [])
const snapDetailRows = computed(() => exportSnapshot.value?.detailRows || [])

/** 从当前实时状态构建导出所需数据的一次性不可变快照（在任何 await 之前调用）。 */
function buildExportSnapshot() {
  const p = props.player
  const v = vehicle.value
  const metrics = radarMetrics.value.map(m => ({ ...m }))
  const refs = referenceSeries.value.map(m => ({ ...m }))
  return {
    isSummary: isSummary.value,
    nickname: p.nickname,
    rating: ratingLine().rating,
    rawMedian: p.rawMedian,
    ratedBattles: p.cells?.rated_battles ?? null,
    referenceLabel: referenceLabel.value,
    vehicle: v ? { ...v } : null,
    metrics,
    refs,
    playerPoints: polygonPoints(metrics.map(m => m.normalized), metrics.length),
    refPoints: polygonPoints(refs.map(m => m.normalized), refs.length),
    grids: radarGridPolygons(metrics.length),
    axes: Array.from({ length: metrics.length }, (_, i) => axisRay(i, metrics.length)),
    scaleTicks: radarScaleTicks(metrics.length),
    labels: Array.from({ length: metrics.length }, (_, i) => {
      const [x, y] = axisPoint(i, metrics.length, RADAR.LABEL_RADIUS, RADAR)
      const m = metrics[i]
      return { x, y, label: m?.label || '', tip: m?.tip || '' }
    }),
    scoreLabels: radarScoreLabelLayout(
      metrics.map(m => m.available ? m.normalized : null),
      metrics.map(m => formatRadarVisualScore(m))),
    detailRows: metrics.map((m, i) => {
      const ref = refs[i]
      return {
        label: m.label, tip: m.tip || '',
        player: formatRadarVisualScore(m),
        reference: formatRadarVisualScore(ref),
      }
    }),
  }
}

async function exportProfile() {
  if (exportingProfile.value || !props.player) return
  exportingProfile.value = true
  // 任何 await 之前固定快照：导出卡/图片/文件名全部来自它，抵御导出期间父组件 props / Tab / selection 变化。
  exportSnapshot.value = buildExportSnapshot()
  exportPortrait.value = null
  try {
    await nextTick()
    await ensureVehiclePortraitForExport()
    await nextTick()
    const html2canvas = (await import('html2canvas')).default
    const canvas = await html2canvas(exportCardRef.value, {
      scale: 2, useCORS: true, backgroundColor: '#14161a',
    })
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('toBlob returned null')
    const base = 'wotbtools-rating-profile-' + sanitizeFilename(exportSnapshot.value.nickname || 'player')
    await downloadBlob(blob, base + '.png')
  } catch (e) {
    console.error(e)
  } finally {
    exportSnapshot.value = null
    exportPortrait.value = null
    exportingProfile.value = false
  }
}

/** 导出卡坦克图：先懒加载 URL，再确认图片已解码；失败/缺图返回 null（文字版导出，不阻塞 PNG）。
 * 只消费导出快照中的 vehicle，避免异步恢复后读到已切换选手的车辆。 */
async function ensureVehiclePortraitForExport() {
  const v = exportSnapshot.value?.vehicle
  if (!v || v.tankId == null) {
    exportPortrait.value = null
    return
  }
  const url = await loadPortrait(v.tankId)
  exportPortrait.value = url ? await ensureImageLoaded(url) : null
}

function ensureImageLoaded(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(url)
    img.onerror = () => resolve(null)
    img.src = url
  })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open || closing" class="drawer-backdrop" :class="{ 'pd-modal': isMobile }" @click.self="isMobile ? requestClose() : null">
      <aside class="player-drawer" :class="{ 'pd-closing': closing }" role="dialog" :aria-modal="isMobile ? 'true' : undefined"
             :aria-labelledby="'pd-title-' + (player?.accountId ?? 'x')"
             :style="{ width: isDesktop ? drawerWidth + 'px' : undefined }">
        <button ref="closeBtn" class="pd-close pd-close-abs" :aria-label="t('league.drawer.close')"
                @click="requestClose">✕</button>

        <Transition :name="'pd-dir-' + navDir" mode="out-in">
          <div :key="(player?.accountId ?? 'none') + (isSummary ? '-s' : '-b')" class="pd-content">
            <div class="pd-head">
              <div>
                <div class="pd-title" :id="'pd-title-' + (player?.accountId ?? 'x')">{{ player?.nickname || '--' }}</div>
                <div class="pd-sub">{{ player?.clan || t('league.drawer.no_clan') }}
                  <span class="pd-scope">{{ isSummary ? t('league.drawer.scope_summary') : t('league.drawer.scope_battle') }}</span>
                </div>
              </div>
            </div>

            <div class="pd-nav">
              <button class="pd-nav-btn" :disabled="!hasPrev" :aria-label="t('league.drawer.prev_player')"
                      data-testid="drawer-prev" @click="onPrev">←</button>
              <button class="pd-nav-btn" :disabled="!hasNext" :aria-label="t('league.drawer.next_player')"
                      data-testid="drawer-next" @click="onNext">→</button>
            </div>

            <div class="pd-rating">
              <span class="pd-rating-label">{{ t('league.drawer.rating_label') }}</span>
              <span class="pd-rating-value" data-testid="drawer-rating">{{ ratingLine().rating }}</span>
            </div>
            <div v-if="isSummary" class="pd-rating-extra">
              <span class="pd-extra">{{ t('league.drawer.observed_median') }}: <b>{{ num(player?.rawMedian) }}</b></span>
              <span class="pd-extra">{{ t('league.drawer.rated_battles') }}: <b>{{ player?.cells?.rated_battles ?? '--' }}</b></span>
            </div>

            <!-- 坦克展示（Summary=最常使用；Battle=本场坦克；缺图时仅文字降级） -->
            <div v-if="vehicle" class="pd-vehicle" data-testid="player-vehicle">
              <div class="pd-vehicle-label">{{ vehicle.label }}</div>
              <div class="pd-vehicle-body">
                <img v-if="vehiclePortrait" :src="vehiclePortrait" :alt="vehicle.tankName"
                     class="pd-vehicle-img" :title="vehicle.tankName" data-testid="player-vehicle-img" />
                <div class="pd-vehicle-meta">
                  <div class="pd-vehicle-name" :title="vehicle.tankName">{{ vehicle.tankName }}</div>
                  <div v-if="vehicle.battleText || vehicle.rateText" class="pd-vehicle-stats">
                    <span v-if="vehicle.battleText" data-testid="player-vehicle-battles">{{ vehicle.battleText }}</span>
                    <span v-if="vehicle.rateText" data-testid="player-vehicle-rate"
                          :aria-label="t('league.drawer.vehicle_usage_rate') + ': ' + vehicle.rateText">{{ vehicle.rateText }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 七维 / 自定义 Radar -->
            <div class="pd-section-row">
              <div class="pd-section">{{ isSummary ? t('league.drawer.radar_title_summary') : t('league.drawer.radar_title_battle') }}</div>
              <div class="pd-section-actions">
                <button class="pd-linkbtn" data-testid="radar-settings" @click="showRadarPicker = !showRadarPicker">
                  {{ showRadarPicker ? t('league.drawer.radar_done') : t('league.drawer.radar_settings') }}
                </button>
                <button class="pd-linkbtn" data-testid="export-profile" :disabled="playerUnavailable" @click="exportProfile">
                  {{ t('league.drawer.export_profile') }}
                </button>
              </div>
            </div>
            <div v-if="showRadarPicker" class="radar-picker" data-testid="radar-picker">
              <p v-if="radarHint" class="radar-hint">{{ radarHint }}</p>
              <ul class="radar-picker-list">
                <li v-for="key in RADAR_AVAILABLE_KEYS" :key="key"
                    :class="{ checked: radarOrder.includes(key) }">
                  <label class="rp-item">
                    <input type="checkbox" :checked="radarOrder.includes(key)"
                           @change="toggleRadarMetric(key)" />
                    {{ t(RADAR_METRIC_DEFS[key].labelKey) }}
                  </label>
                  <span class="rp-arrows">
                    <button class="rp-arrow" :disabled="!radarOrder.includes(key) || radarOrder.indexOf(key) === 0"
                            :aria-label="t('league.drawer.radar_move_up')" @click="moveRadarMetric(key, -1)">↑</button>
                    <button class="rp-arrow" :disabled="!radarOrder.includes(key) || radarOrder.indexOf(key) === radarOrder.length - 1"
                            :aria-label="t('league.drawer.radar_move_down')" @click="moveRadarMetric(key, 1)">↓</button>
                  </span>
                </li>
              </ul>
            </div>

            <p v-if="playerUnavailable" class="radar-empty" data-testid="radar-unavailable">
              {{ t('league.drawer.radar_dim_unavailable') }}
            </p>
            <PlayerRatingRadar v-else-if="radarMetrics.length" :metrics="radarMetrics" :reference="referenceSeries"
                               :reference-label="referenceLabel" :player-label="player?.nickname || ''" />

            <!-- 表现指标（Contribution/KAST/Impact 独立区域，不是 Rating） -->
            <div class="pd-section">{{ t('league.drawer.perf_title') }}</div>
            <dl class="pd-facts" data-testid="perf-facts">
              <template v-for="(f, i) in perfFacts" :key="'p' + i">
                <dt>{{ f[0] }}</dt>
                <dd>{{ f[1] }}</dd>
              </template>
            </dl>

            <!-- 比赛事实（scope 语义） -->
            <div class="pd-section">{{ isSummary ? t('league.drawer.facts_title_summary') : t('league.drawer.facts_title_battle') }}</div>
            <dl class="pd-facts" data-testid="player-facts">
              <template v-for="(f, i) in facts" :key="i">
                <dt>{{ f[0] }}</dt>
                <dd>{{ f[1] }}</dd>
              </template>
            </dl>
          </div>
        </Transition>
      </aside>
      <div v-if="isDesktop && open" class="pd-resizer" role="separator" aria-orientation="vertical"
           tabindex="0" data-testid="drawer-resizer"
           :aria-label="t('league.drawer.resize_panel')"
           :aria-valuenow="Math.round(drawerWidth)" :aria-valuemin="DRAWER_MIN"
           :aria-valuemax="Math.round(drawerMaxWidth())"
           :style="{ left: resizerLeftPx + 'px' }"
           ref="resizeHandle"
           @pointerdown="onResizeStart" @pointermove="onResizeMove" @pointerup="onResizeEnd"
           @pointercancel="onResizeEnd"
           @keydown.left.stop.prevent="onResizeKey(-20)" @keydown.right.stop.prevent="onResizeKey(20)">
        <span class="pd-resizer-line"></span>
      </div>
    </div>
  </Teleport>

  <!-- 导出专用 Rating Profile 卡（offscreen 不可变快照；实色 token 规避 color-mix 兼容） -->
  <Teleport to="body">
    <div v-if="exportingProfile" class="rp-export" ref="exportCardRef">
      <div class="rp-card">
        <div class="rp-brand">WotBTools · League Rating{{ snapIsSummary ? ' V5' : '' }}</div>
        <div class="rp-player">{{ snapNickname }}<span class="rp-scope">{{ snapReferenceLabel }}</span></div>
        <div class="rp-headline">
          <div class="rp-rating">
            <span class="rp-rating-label">{{ t('league.drawer.rating_label') }}</span>
            <span class="rp-rating-value">{{ snapRating }}</span>
          </div>
          <div v-if="snapIsSummary" class="rp-headline-extra">
            <span class="rp-extra">{{ t('league.drawer.observed_median') }}: <b>{{ num(snapRawMedian) }}</b></span>
            <span class="rp-extra">{{ t('league.drawer.rated_battles') }}: <b>{{ snapRatedBattles ?? '--' }}</b></span>
          </div>
        </div>
        <!-- 导出卡坦克区（消费快照；缺图时文字版，不阻塞 PNG） -->
        <div v-if="snapVehicle" class="rp-vehicle">
          <div class="rp-vehicle-label">{{ snapVehicle.label }}</div>
          <div class="rp-vehicle-body">
            <img v-if="exportPortrait" :src="exportPortrait" :alt="snapVehicle.tankName" class="rp-vehicle-img" />
            <div class="rp-vehicle-meta">
              <div class="rp-vehicle-name">{{ snapVehicle.tankName }}</div>
              <div v-if="snapVehicle.battleText || snapVehicle.rateText" class="rp-vehicle-stats">
                <span v-if="snapVehicle.battleText">{{ snapVehicle.battleText }}</span>
                <span v-if="snapVehicle.rateText">{{ snapVehicle.rateText }}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="rp-radar">
          <svg :viewBox="'0 0 340 340'" class="rp-radar-svg">
            <polygon v-for="g in snapGrids" :key="'g' + g.value" :points="g.points" class="rp-grid" :class="{ 'rp-grid-strong': g.value === RADAR.STRONG_VALUE }" />
            <line v-for="(r, i) in snapAxes" :key="'a' + i" :x1="RADAR.CENTER" :y1="RADAR.CENTER" :x2="r.x" :y2="r.y" class="rp-axis" />
            <text v-for="t in snapScaleTicks" :key="'t' + t.value" :x="t.p.x" :y="t.p.y" text-anchor="middle" dominant-baseline="middle" class="rp-scale">{{ t.value }}</text>
            <polygon v-if="snapRefs.length" :points="snapRefPoints" class="rp-ref" />
            <polygon :points="snapPlayerPoints" class="rp-data" />
            <template v-for="(m, i) in snapMetrics" :key="'d' + i">
              <circle v-if="m?.available"
                      :cx="axisPoint(i, snapMetrics.length, m.normalized)[0]"
                      :cy="axisPoint(i, snapMetrics.length, m.normalized)[1]" r="3" class="rp-dot" />
            </template>
            <template v-for="(score, i) in snapScoreLabels" :key="'s' + i">
              <g v-if="score" class="rp-score-badge">
                <rect :x="score.x - score.width / 2" :y="score.y - RADAR.SCORE_BADGE_HEIGHT / 2"
                      :width="score.width" :height="RADAR.SCORE_BADGE_HEIGHT" :rx="RADAR.SCORE_BADGE_RADIUS"
                      class="rp-score-bg" />
                <text :x="score.x" :y="score.y" text-anchor="middle" dominant-baseline="middle"
                      class="rp-score">{{ score.value }}</text>
              </g>
            </template>
            <text v-for="(p, i) in snapLabels" :key="'l' + i" :x="p.x" :y="p.y" text-anchor="middle" dominant-baseline="middle" class="rp-label">{{ p.label }}</text>
          </svg>
          <div class="rp-scale-legend">
            <span>{{ t('radarScale.average', { label: snapReferenceLabel }) }}</span>
            <span>{{ t('radarScale.strong') }}</span>
          </div>
          <div class="rp-scale-note">{{ t('radarScale.overflow') }}</div>
        </div>
        <table class="rp-detail">
          <thead><tr><th>{{ t('radar_lbl.dimension') }}</th><th>{{ t('radarScale.playerScore') }}</th><th>{{ t('radarScale.averageScore') }}</th></tr></thead>
          <tbody>
            <tr v-for="(row, i) in snapDetailRows" :key="i">
              <td>{{ row.label }}</td><td>{{ row.player }}</td><td>{{ row.reference }}</td>
            </tr>
          </tbody>
        </table>
        <div class="rp-footer">wotbtools.com</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 非模态侧栏：桌面/平板 backdrop 不拦截 Grid 点击（pointer-events:none），
   Drawer 自身恢复可交互；移动端(<768px)再切回 modal veil（.pd-modal）。 */
.drawer-backdrop {
  position: fixed; inset: 0; z-index: 60;
  pointer-events: none;
  background: none;
}
.drawer-backdrop.pd-modal {
  pointer-events: auto;
  background: color-mix(in srgb, var(--text-heading) 35%, transparent);
}
.player-drawer {
  position: fixed; top: calc(var(--topbar-h) + 8px); right: 8px; bottom: 8px; width: min(380px, calc(100vw - 16px));
  background: var(--bg-card2); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: var(--surface-shadow); overflow-y: auto; padding: 16px;
  animation: pd-slide-in .22s ease-out;
  pointer-events: auto;
}
.player-drawer.pd-closing { animation: pd-slide-out .17s ease-in forwards; }
@keyframes pd-slide-in { from { transform: translateX(30px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes pd-slide-out { from { transform: translateX(0); opacity: 1; } to { transform: translateX(30px); opacity: 0; } }

/* Side Panel resize handle（桌面）：视觉 2px 线，实际 12px hit 区；默认不显，hover/拖动时高亮。 */
.pd-resizer {
  position: absolute;
  top: calc(var(--topbar-h) + 8px);
  bottom: 8px;
  width: 12px;
  margin-left: -5px;
  z-index: 2;
  cursor: col-resize;
  touch-action: none;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity .15s ease;
}
.pd-resizer:hover,
body.pd-resizing .pd-resizer { opacity: 1; }
.pd-resizer:focus-visible { opacity: 1; }
.pd-resizer-line {
  width: 2px;
  height: 52px;
  border-radius: 2px;
  background: var(--border);
  transition: background .15s ease, height .15s ease;
}
.pd-resizer:hover .pd-resizer-line,
body.pd-resizing .pd-resizer-line,
.pd-resizer:focus-visible .pd-resizer-line { background: var(--accent); height: 72px; }
@media (max-width: 1199px) { .pd-resizer { display: none; } }
@media (max-width: 1080px) {
  .drawer-backdrop { z-index: var(--z-modal); }
  .player-drawer { top: 8px; }
}
.pd-close-abs { position: absolute; top: 12px; right: 12px; }
.pd-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; padding-right: 40px; }
.pd-title { font-size: 1.1rem; font-weight: 800; color: var(--text-heading); }
.pd-sub { font-size: .8rem; color: var(--text-sub); margin-top: 2px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pd-scope { font-size: .68rem; font-weight: 700; color: var(--accent-dark); background: var(--bg-blue-light); border-radius: 8px; padding: 2px 8px; }
.pd-close {
  border: 1px solid var(--border); background: transparent; color: var(--text-sub);
  width: 30px; height: 30px; border-radius: 7px; cursor: pointer; font-size: .9rem; flex: none;
}
.pd-close:hover { color: var(--text-heading); border-color: var(--accent); }
.pd-nav { display: inline-flex; gap: 6px; margin: 10px 0 0; }
.pd-nav-btn {
  width: 30px; height: 26px; border: 1px solid var(--border-light); background: transparent;
  color: var(--text-sub); border-radius: 6px; font-size: .85rem; cursor: pointer; font-family: inherit;
}
.pd-nav-btn:disabled { opacity: .35; cursor: default; }
.pd-nav-btn:not(:disabled):hover { color: var(--accent-dark); border-color: var(--accent); }
.pd-rating { display: flex; align-items: baseline; gap: 8px; margin: 12px 0 2px; }
.pd-rating-label { font-size: .72rem; font-weight: 800; color: var(--text-sub); text-transform: uppercase; letter-spacing: .04em; }
.pd-rating-value { font-size: 1.6rem; font-weight: 800; color: var(--accent-dark); font-variant-numeric: tabular-nums; }
.pd-rating-extra { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 2px; }
.pd-extra { font-size: .74rem; color: var(--text-sub); }
.pd-extra b { color: var(--text-heading); font-variant-numeric: tabular-nums; }
.pd-section { margin: 14px 0 8px; font-size: .8rem; font-weight: 800; color: var(--text-sub); letter-spacing: .02em; }
.pd-section-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 14px 0 8px; }
.pd-section-row .pd-section { margin: 0; }
.pd-section-actions { display: flex; gap: 6px; }
.pd-linkbtn {
  border: 1px solid var(--border-light); background: transparent; color: var(--text-sub);
  font-size: .72rem; font-weight: 700; border-radius: 6px; padding: 3px 10px; cursor: pointer; font-family: inherit;
}
.pd-linkbtn:hover { color: var(--accent-dark); border-color: var(--accent); }
.pd-linkbtn:disabled { opacity: .4; cursor: default; }
.radar-picker { margin: 4px 0 8px; padding: 8px 10px; border: 1px solid var(--border-light); border-radius: 8px; }
.radar-hint { margin: 0 0 6px; font-size: .72rem; color: var(--warn-text); }
.radar-picker-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; max-height: 240px; overflow-y: auto; }
.radar-picker-list li { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: .78rem; }
.rp-item { display: flex; align-items: center; gap: 6px; color: var(--text-label); cursor: pointer; }
.rp-item input { accent-color: var(--accent); }
.rp-arrows { display: inline-flex; gap: 2px; }
.rp-arrow {
  width: 22px; height: 20px; border: 1px solid var(--border-light); background: transparent;
  color: var(--text-sub); border-radius: 5px; font-size: .7rem; cursor: pointer; font-family: inherit;
}
.rp-arrow:disabled { opacity: .35; cursor: default; }
.rp-arrow:not(:disabled):hover { color: var(--accent-dark); border-color: var(--accent); }
.radar-empty { margin: 10px 0; padding: 14px; text-align: center; color: var(--text-muted); font-size: .8rem; border: 1px dashed var(--border); border-radius: 8px; }
.pd-facts { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: .82rem; }
.pd-facts dt { color: var(--text-sub); font-weight: 600; }
.pd-facts dd { margin: 0; color: var(--text-heading); font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; }
.pd-vehicle { margin: 12px 0 2px; padding: 10px 12px; border: 1px solid var(--border-light); border-radius: 10px; background: var(--bg-card); }
.pd-vehicle-label { font-size: .72rem; font-weight: 800; color: var(--text-sub); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }
.pd-vehicle-body { display: flex; align-items: center; gap: 12px; }
.pd-vehicle-img { width: 150px; height: auto; border-radius: 6px; flex: none; }
.pd-vehicle-meta { min-width: 0; }
.pd-vehicle-name { font-size: .95rem; font-weight: 800; color: var(--text-heading); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-vehicle-stats { display: flex; gap: 10px; margin-top: 3px; font-size: .78rem; color: var(--text-sub); font-variant-numeric: tabular-nums; }
@media (max-width: 768px) { .pd-vehicle-img { width: 100px; } }

/* 切换动画（§35/§38）：next 旧左出新右入；prev 旧右出新左入；reduced-motion 关闭（§40） */
.pd-dir-next-enter-from { transform: translateX(28px); opacity: 0; }
.pd-dir-next-leave-to { transform: translateX(-28px); opacity: 0; }
.pd-dir-prev-enter-from { transform: translateX(-28px); opacity: 0; }
.pd-dir-prev-leave-to { transform: translateX(28px); opacity: 0; }
.pd-dir-next-enter-active, .pd-dir-next-leave-active,
.pd-dir-prev-enter-active, .pd-dir-prev-leave-active { transition: transform .18s ease, opacity .18s ease; }
@media (prefers-reduced-motion: reduce) {
  .pd-dir-next-enter-from, .pd-dir-next-leave-to,
  .pd-dir-prev-enter-from, .pd-dir-prev-leave-to { transform: none; }
  .pd-dir-next-enter-active, .pd-dir-next-leave-active,
  .pd-dir-prev-enter-active, .pd-dir-prev-leave-active { transition: none; }
  .player-drawer, .player-drawer.pd-closing { animation: none; }
}

/* 导出卡（offscreen，实色 token） */
.rp-export { position: absolute; left: -9999px; top: 0; }
.rp-card { width: 720px; padding: 24px 28px; background: #14161a; color: #e8e8e8; font-family: inherit; }
.rp-brand { font-size: .78rem; font-weight: 800; color: #d4a017; letter-spacing: .06em; }
.rp-player { font-size: 1.5rem; font-weight: 800; color: #fff; margin: 6px 0 2px; }
.rp-scope { font-size: .8rem; font-weight: 600; color: #9aa0a6; margin-left: 8px; }
.rp-rating { display: flex; align-items: baseline; gap: 8px; }
.rp-rating-label { font-size: .72rem; font-weight: 800; color: #9aa0a6; text-transform: uppercase; letter-spacing: .04em; }
.rp-rating-value { font-size: 2rem; font-weight: 800; color: #d4a017; font-variant-numeric: tabular-nums; }
.rp-headline-extra { display: flex; gap: 16px; margin-top: 2px; }
.rp-extra { font-size: .8rem; color: #9aa0a6; }
.rp-extra b { color: #e8e8e8; font-variant-numeric: tabular-nums; }
.rp-vehicle { margin: 10px 0 4px; padding: 10px 12px; border: 1px solid #3a3f45; border-radius: 8px; background: #17191d; }
.rp-vehicle-label { font-size: .72rem; font-weight: 800; color: #9aa0a6; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }
.rp-vehicle-body { display: flex; align-items: center; gap: 12px; }
.rp-vehicle-img { width: 140px; height: auto; border-radius: 6px; flex: none; }
.rp-vehicle-meta { min-width: 0; }
.rp-vehicle-name { font-size: 1.05rem; font-weight: 800; color: #fff; }
.rp-vehicle-stats { display: flex; gap: 12px; margin-top: 3px; font-size: .82rem; color: #9aa0a6; font-variant-numeric: tabular-nums; }
.rp-radar { margin: 10px auto 4px; width: 340px; }
.rp-radar-svg { width: 340px; height: 340px; }
.rp-scale-legend { display: flex; justify-content: center; gap: 16px; color: #9aa0a6; font-size: .7rem; }
.rp-scale-note { margin-top: 3px; color: #9aa0a6; font-size: .66rem; text-align: center; }
.rp-grid { fill: none; stroke: #3a3f45; stroke-width: 1; }
.rp-grid-strong { stroke: #4a4f55; stroke-width: 1.2; }
.rp-axis { stroke: #3a3f45; stroke-width: 1; }
.rp-scale { fill: #9aa0a6; font-size: 9px; font-weight: 600; }
.rp-data { fill: rgba(212, 160, 23, .22); stroke: #d4a017; stroke-width: 2; }
.rp-ref { fill: none; stroke: #9aa0a6; stroke-width: 1.3; stroke-dasharray: 4 3; }
.rp-dot { fill: #d4a017; }
.rp-score-bg { fill: #17191d; stroke: #d4a017; stroke-width: .8; }
.rp-score { fill: #d4a017; font-size: 10px; font-weight: 800; font-variant-numeric: tabular-nums; }
.rp-label { fill: #cfd2d6; font-size: 12px; font-weight: 700; }
.rp-detail { width: 100%; border-collapse: collapse; font-size: .82rem; margin-top: 8px; }
.rp-detail th, .rp-detail td { padding: 5px 8px; text-align: left; }
.rp-detail thead th { color: #9aa0a6; font-weight: 800; border-bottom: 1px solid #3a3f45; }
.rp-detail td { color: #cfd2d6; }
.rp-detail td:not(:first-child) { text-align: right; font-variant-numeric: tabular-nums; }
.rp-detail tbody tr:nth-child(even) td { background: rgba(255, 255, 255, .03); }
.rp-footer { margin-top: 12px; font-size: .72rem; font-weight: 700; color: #9aa0a6; text-align: right; }
</style>
