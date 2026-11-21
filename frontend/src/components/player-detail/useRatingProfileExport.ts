/**
 * PlayerDetailDrawer —— 导出 Rating Profile PNG（§41-48；拆分自 PlayerDetailDrawer.vue，行为原样）。
 * 专用卡片（非 Drawer 截图）：导出前捕获不可变快照，offscreen 卡只消费快照——
 * 导出期间切换玩家不产生「新玩家数据 + 旧坦克图」混合 PNG。
 */
import { computed, nextTick, ref } from 'vue'
import type { ComputedRef } from 'vue'
import { downloadBlob, sanitizeFilename } from '../../utils/exportReplayPng.js'
import {
  RADAR, axisPoint, axisRay, polygonPoints, radarGridPolygons, radarScaleTicks,
  radarScoreLabelLayout,
} from '../../utils/radarGeometry.js'
import { formatRadarVisualScore } from '../../utils/radarScale.js'

type Metric = { normalized: number; available: boolean; label: string; tip?: string; [key: string]: unknown }
type Vehicle = { tankId: number; label: string; tankName: string; battleText: string; rateText: string }
type ExportContext = {
  props: { player: { nickname: string; observedMean?: number | null; cells?: Record<string, unknown> } | null }
  vehicle: ComputedRef<Vehicle | null>; radarMetrics: ComputedRef<Metric[]>; referenceSeries: ComputedRef<Metric[]>
  referenceLabel: ComputedRef<string>; isSummary: ComputedRef<boolean>; ratingLine: () => { rating: string }
  loadPortrait: (tankId: number) => Promise<string | null>
}

/** @param {{
 *  props: object,
 *  vehicle: import('vue').ComputedRef<object|null>,
 *  radarMetrics: import('vue').ComputedRef<Array<object>>,
 *  referenceSeries: import('vue').ComputedRef<Array<object>>,
 *  referenceLabel: import('vue').ComputedRef<string>,
 *  isSummary: import('vue').ComputedRef<boolean>,
 *  ratingLine: () => object,
 *  loadPortrait: (tankId: number) => Promise<string|null>,
 * }} ctx */
export function useRatingProfileExport({ props, vehicle, radarMetrics, referenceSeries, referenceLabel, isSummary, ratingLine, loadPortrait }: ExportContext) {
  const exportingProfile = ref(false)
  const exportCardRef = ref<HTMLElement | null>(null)
  const exportPortrait = ref<string | null>(null)
  const exportSnapshot = ref<ReturnType<typeof buildExportSnapshot> | null>(null)

  // 出口卡只消费 exportSnapshot（快照未建时为空/占位），禁止再读实时 props/vehicle/radarMetrics/referenceSeries。
  const snapIsSummary = computed(() => !!exportSnapshot.value?.isSummary)
  const snapNickname = computed(() => exportSnapshot.value?.nickname || '--')
  const snapRating = computed(() => exportSnapshot.value?.rating || '--')
  const snapObservedMean = computed(() => exportSnapshot.value?.observedMean ?? null)
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
    if (!p) throw new Error('Cannot export without a player')
    const v = vehicle.value
    const metrics = radarMetrics.value.map(m => ({ ...m }))
    const refs = referenceSeries.value.map(m => ({ ...m }))
    return {
      isSummary: isSummary.value,
      nickname: p.nickname,
      rating: ratingLine().rating,
      observedMean: p.observedMean,
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
      if (!exportCardRef.value || !exportSnapshot.value) throw new Error('Export card unavailable')
      const html2canvas = (await import('html2canvas')).default
      // 画布底色取导出卡自身的语义 token 底色（随主题），不再写死深色
      const cardEl = exportCardRef.value.querySelector('.rp-card') || exportCardRef.value
      const canvas = await html2canvas(exportCardRef.value, {
        scale: 2, useCORS: true, backgroundColor: getComputedStyle(cardEl).backgroundColor || null,
      })
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
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

  function ensureImageLoaded(url: string) {
    return new Promise<string | null>((resolve) => {
      const img = new Image()
      img.onload = () => resolve(url)
      img.onerror = () => resolve(null)
      img.src = url
    })
  }

  return {
    exportingProfile, exportCardRef, exportPortrait, exportSnapshot,
    snapIsSummary, snapNickname, snapRating, snapObservedMean, snapRatedBattles,
    snapReferenceLabel, snapVehicle, snapMetrics, snapRefs,
    snapPlayerPoints, snapRefPoints, snapGrids, snapAxes, snapLabels,
    snapScoreLabels, snapScaleTicks, snapDetailRows,
    exportProfile,
  }
}
